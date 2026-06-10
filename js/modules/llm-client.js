import { getSetting } from '../db.js';

async function getApiConfig() {
  const [url, key, model, thinkingEnabled, reasoningEffort, temperature] = await Promise.all([
    getSetting('api_url'), getSetting('api_key'), getSetting('api_model'),
    getSetting('thinking_enabled'), getSetting('reasoning_effort'), getSetting('temperature')
  ]);
  if (!url) throw new Error('请先在设置中配置 LLM API 地址');
  if (!key) throw new Error('请先在设置中配置 LLM API Key');
  // 自动补全 URL
  const fullUrl = url.endsWith('/chat/completions') ? url : url.replace(/\/+$/, '') + '/chat/completions';
  return {
    url: fullUrl, key,
    model: model || 'deepseek-v4-flash',
    thinking: thinkingEnabled !== false,
    effort: reasoningEffort || 'high',
    temperature: temperature ?? 0.85
  };
}

function buildBody(config, messages, { stream = false, maxTokens = 2048 } = {}) {
  const body = {
    model: config.model,
    messages,
    stream,
    [isMiMoApi(config.url) ? 'max_completion_tokens' : 'max_tokens']: maxTokens
  };
  if (config.thinking && !isMiMoApi(config.url)) {
    body.thinking = { type: 'enabled', reasoning_effort: config.effort };
  } else {
    body.temperature = config.temperature;
  }
  return body;
}

export async function chat(messages, { onChunk, signal, timeoutMs = 60000, retries } = {}) {
  const config = await getApiConfig();
  const attempts = retries ?? (onChunk ? 0 : 1);
  return requestWithRetry(async attemptSignal => {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: authHeaders(config),
      signal: attemptSignal,
      body: JSON.stringify(buildBody(config, messages, { stream: !!onChunk }))
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 错误 ${res.status}: ${err}`);
    }

    if (onChunk) return streamResponse(res, onChunk);

    const data = await res.json();
    const msg = data.choices[0].message;
    return msg.content || '';
  }, { retries: attempts, signal, timeoutMs });
}

async function requestWithRetry(run, { retries = 0, signal, timeoutMs = 60000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('LLM 请求超时')), timeoutMs);
    const abort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      return await run(controller.signal);
    } catch (err) {
      lastError = err;
      if (controller.signal.aborted || attempt >= retries) throw normalizeRequestError(err);
      await delay(500 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', abort);
    }
  }
  throw normalizeRequestError(lastError);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeRequestError(err) {
  if (err?.name === 'AbortError') return new Error('LLM 请求已取消或超时');
  return err instanceof Error ? err : new Error(String(err));
}

async function streamResponse(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let reasoning = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6);
      if (json === '[DONE]') break;
      try {
        const d = JSON.parse(json);
        const delta = d.choices?.[0]?.delta;
        // 思考模式：reasoning_content 是思考过程，content 是最终输出
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
        }
        if (delta?.content) {
          full += delta.content;
          onChunk(full, reasoning);
        }
      } catch {}
    }
  }
  return full;
}

export async function summarize(messages, { signal, timeoutMs = 30000, retries = 1 } = {}) {
  const config = await getApiConfig();
  return requestWithRetry(async attemptSignal => {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: authHeaders(config),
      signal: attemptSignal,
      body: JSON.stringify(buildBody(config, [
        { role: 'system', content: '你是一个对话摘要助手。将以下对话压缩为1-2句话的摘要，包含关键事实、情感变化和数值变化趋势。只输出摘要，不要解释。' },
        ...messages
      ], { maxTokens: 200 }))
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 错误 ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }, { retries, signal, timeoutMs });
}

function authHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (isMiMoApi(config.url)) headers['api-key'] = config.key;
  else headers.Authorization = `Bearer ${config.key}`;
  return headers;
}

function isMiMoApi(url) {
  return String(url || '').includes('xiaomimimo.com');
}

# 剧本模拟器 Script Simulator

> LLM 驱动的交互式剧本模拟工具 — 编写规则，AI 演绎故事。

🌐 **在线访问**  
- [script-simulator.pages.dev](https://script-simulator.pages.dev)（Cloudflare Pages）  
- [kingdevatil.github.io/Script-Simulator](https://kingdevatil.github.io/Script-Simulator/)（GitHub Pages）

---

## 什么是剧本模拟器

Script Simulator 是一个**纯前端静态网页应用**。你可以导入或编写一份剧本 JSON（定义角色、数值维度、事件、阶段、结局等规则），然后接入你自己的大语言模型（LLM）API，让 AI 根据剧本规则实时生成剧情、选项和数值变化。

它更像是「给 AI 一套游戏规则，让 AI 当 DM（地下城城主）来跑团」，而不是传统的分支叙事引擎或聊天机器人。

---

## 数据隐私

**所有数据完全存储在浏览器本地（IndexedDB），不经过任何服务器。**

- 你的 API Key 存在浏览器本地存储中
- 对话记录、剧本数据均保存在你的设备上
- 没有任何远程服务器读取、收集或上传你的数据
- 项目本身是一个静态 HTML 文件，部署只是让它能被访问

---

## 编写剧本

如果你想自己写剧本，请阅读 →

📖 **[剧本编写指南](https://github.com/KingDevatil/Script-Simulator/blob/main/docs/script-guide.md)**

---

## 用 AI 辅助编写剧本

最好的方式是「把剧本编写指南喂给 AI，让它按规范生成 JSON」。以下是推荐流程：

### 1. 给 AI 提供规范

将 [剧本编写指南](https://github.com/KingDevatil/Script-Simulator/blob/main/docs/script-guide.md) 的内容作为上下文发给任意 LLM（ChatGPT、Claude、DeepSeek 等）。

### 2. 描述你的剧本创意

告诉 AI 你想做什么类型的剧本，尽量包含：

- **题材**：悬疑 / 恋爱 / 科幻 / 权谋 / 校园 / 生存……
- **核心冲突**：玩家面临的主要矛盾
- **角色**：主角和关键 NPC 的身份、性格、立场
- **维度方向**：哪些数值驱动剧情（比如信任、怀疑、压力）
- **阶段节奏**：关系如何一步步升级或恶化

### 3. 让 AI 输出 JSON

要求 AI 严格按照编写指南中的 JSON 格式输出完整剧本。一个实用 prompt 模板：

> 请你按照 Script Simulator 的剧本格式，生成一份 [题材] 剧本的完整 JSON。题材要求：[你的描述]。角色：[列出角色]。关联维度：[列出维度及含义]。设计至少 3 个阶段、2-4 个关键事件、2 个结局。严格按 JSON 格式输出，不要加多余解释。

### 4. 导入并测试

将 AI 生成的 JSON 复制，在剧本模拟器中点击「导入剧本」粘贴，系统会自动校验格式。校验通过后即可开始游玩，边玩边调整参数。

### 常见调优

如果 AI 生成的剧情不稳定，优先检查：

- **维度太多了** — 控制在 5-12 个，太多会分散 LLM 注意力
- **条件太复杂** — 先用简单阈值，跑通再上 AND/OR 组合
- **写作规则互相矛盾** — `writing_style`、`forbidden`、`requirements` 不要自相矛盾

---

## 本地开发

```bash
# 安装依赖
npm install

# 构建（输出到 docs/ 目录）
npm run build

# 代码检查
npm run lint

# 运行测试
npm run test

# 完整检查
npm run check
```

构建产物 `docs/index.html` 是一个自包含的单文件应用，可以直接在浏览器打开。

---

## 技术栈

- 纯静态前端，无服务端依赖
- esbuild 打包
- IndexedDB 本地存储
- PWA 支持（可安装到桌面）
- OpenAI 兼容的 LLM API 接口

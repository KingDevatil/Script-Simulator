import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEventEffects,
  advanceStage,
  checkEnding,
  checkEventTriggers,
  clampValues,
  evaluateCondition,
  initializeValues
} from '../js/modules/script-engine.js';
import { parseLLMTurn } from '../js/modules/llm-output.js';
import { createGameEngine, createSession } from '../js/modules/session.js';
import { substituteMacros } from '../js/modules/prompt-builder.js';

const script = {
  id: 's1',
  name: 'Test',
  dimensions: [
    { id: 'trust', name: '信任', range: [0, 100], initial: [10, 20] },
    { id: 'danger', name: '危险', range: [0, 10], initial: [5, 5] }
  ],
  characters: [
    { id: 'player', name: '玩家', description: '' },
    { id: 'target', name: '对象', description: '' }
  ],
  stages: [
    { name: 'A' },
    { name: 'B', transition: { trust: { min: 30 } } },
    { name: 'C', transition: { danger: { min: 8 } } }
  ],
  endings: [
    { name: 'Done', condition: { danger: { min: 10 } }, description: 'ended' }
  ]
};

test('initial values use deterministic seed for ranges', () => {
  const a = initializeValues(script.dimensions, 1234);
  const b = initializeValues(script.dimensions, 1234);
  assert.deepEqual(a.values, b.values);
  assert.equal(a.seed, 1234);
  assert.equal(a.values.danger, 5);
});

test('clampValues limits updates to dimension ranges', () => {
  const result = clampValues({ trust: 150, danger: -3, unknown: 9 }, script.dimensions);
  assert.deepEqual(result.values, { trust: 100, danger: 0 });
  assert.equal(result.warnings.length, 2);
});

test('evaluateCondition supports old and composed condition forms', () => {
  assert.equal(evaluateCondition({ trust: { min: 50 } }, { trust: 60 }), true);
  assert.equal(evaluateCondition({ op: 'and', conditions: [{ dim: 'trust', min: 50 }, { dim: 'danger', max: 5 }] }, { trust: 60, danger: 4 }), true);
  assert.equal(evaluateCondition({ dim: 'trust', probability: 0.5 }, { trust: 60 }, () => 0.9), false);
});

test('events obey once, cooldown and maxTriggers', () => {
  const event = { name: 'E', once: true, cooldown: 2, trigger: { trust: { min: 10 } } };
  const session = { values: { trust: 20 }, currentStage: 0, activeEffects: [], eventState: {} };
  assert.equal(checkEventTriggers([event], session.values, 0, session.activeEffects, session.eventState).length, 1);
  addEventEffects(session, event);
  assert.equal(checkEventTriggers([event], session.values, 0, session.activeEffects, session.eventState).length, 0);

  const repeat = { name: 'R', maxTriggers: 1, trigger: { trust: { min: 10 } } };
  assert.equal(checkEventTriggers([repeat], session.values, 0, session.activeEffects, session.eventState).length, 1);
  addEventEffects(session, repeat);
  assert.equal(checkEventTriggers([repeat], session.values, 0, session.activeEffects, session.eventState).length, 0);
});

test('events support multiple stages and all stages', () => {
  const multiStage = { name: 'M', stages: [0, 2], trigger: { trust: { min: 10 } } };
  const allStage = { name: 'A', trigger: { trust: { min: 10 } } };
  const values = { trust: 20 };

  assert.equal(checkEventTriggers([multiStage], values, 0, [], {}).length, 1);
  assert.equal(checkEventTriggers([multiStage], values, 1, [], {}).length, 0);
  assert.equal(checkEventTriggers([multiStage], values, 2, [], {}).length, 1);
  assert.equal(checkEventTriggers([allStage], values, 0, [], {}).length, 1);
  assert.equal(checkEventTriggers([allStage], values, 2, [], {}).length, 1);
});

test('stage advancement can cross multiple stages and endings are detected', () => {
  const values = { trust: 50, danger: 10 };
  assert.equal(advanceStage(script.stages, values, 0), 2);
  assert.equal(checkEnding(script.endings, values).name, 'Done');
});

test('LLM turn parser accepts JSON blocks and clamps values', () => {
  const parsed = parseLLMTurn('```json\n{"narrative":"n","options":["go"],"values":{"trust":200},"keyEvent":null,"stageHint":null}\n```', script);
  assert.equal(parsed.status, 'json');
  assert.equal(parsed.turn.values.trust, 100);
  assert.equal(parsed.turn.options[0].text, 'go');
});

test('macro substitution reads characters, stages and dimensions', () => {
  const text = substituteMacros('{{target}} {{stage}} {{dim:trust}}', {
    script,
    values: { trust: 42 },
    currentStage: 1
  });
  assert.equal(text, '对象 B 42');
});

test('session snapshots restore values, messages and event state', () => {
  const session = createSession(script, {}, 99);
  const engine = createGameEngine(session, script);
  engine.addPlayerMessage('a');
  engine.createSnapshot('before');
  engine.updateValues({ trust: 100 });
  session.eventState.E = { count: 2 };
  engine.addAIMessage('b');
  engine.restoreToMessage(1);
  assert.equal(session.messages.length, 1);
  assert.equal(session.values.trust, engine.session.snapshots.at(-1).values.trust);
  assert.deepEqual(session.eventState, {});
});

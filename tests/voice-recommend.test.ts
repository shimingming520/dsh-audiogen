/**
 * voice-recommend 单元测试：纯函数部分（提示构造、JSON 松散解析、
 * voice_id 防幻觉校验）与推荐主流程（注入假 LLM runtime）。
 * 运行：node --test tests/voice-recommend.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseVoiceRecommendations,
  buildRecommendMessages,
  stripFences,
  recommendVoices,
} from '../src/voice-recommend.ts'
import type { VendorVoiceEntry } from '../src/voice-manager.ts'

const candidates: VendorVoiceEntry[] = [
  {
    provider: 'elevenlabs', voice_id: '50lF5fQMqcxbDQOW6qOs', name: 'Sarcastic Nigel', source: 'shared',
    deletable: false, language: 'en', accent: 'british', gender: 'male', age: 'adult',
    use_case: 'characters_animation', description: 'Cynical about everything', preview_url: 'https://x/p.mp3',
  },
  {
    provider: 'elevenlabs', voice_id: 'aBC12', name: 'Bright Alice', source: 'owned',
    deletable: true, language: 'en', accent: 'american', gender: 'female', age: 'young',
    description: 'Sweet and bright teen voice',
  },
  {
    provider: 'minimax', voice_id: 'Chinese (Mandarin)_Mature_Woman', name: '沉稳高管', source: 'system',
    deletable: false, language: 'Chinese (Mandarin)', description: 'Mature woman, executive',
  },
]

test('stripFences 去代码围栏', () => {
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripFences('{"a":1}'), '{"a":1}')
  assert.equal(stripFences(''), '')
})

test('parseVoiceRecommendations 校验 voice_id 属于候选池并给出 reason', () => {
  const content = JSON.stringify({
    recommendations: [
      { voice_id: 'aBC12', reason: '清亮少女音，符合' },
      { voice_id: '50lF5fQMqcxbDQOW6qOs', reason: '英式口音讽刺感' },
    ],
  })
  const result = parseVoiceRecommendations(content, candidates, 5)
  assert.equal(result.length, 2)
  assert.equal(result[0]!.voice_id, 'aBC12')
  assert.equal(result[0]!.reason, '清亮少女音，符合')
  assert.equal(result[0]!.deletable, true)
})

test('parseVoiceRecommendations 丢弃编造的 id（防幻觉）', () => {
  const content = JSON.stringify({
    recommendations: [
      { voice_id: 'aBC12', reason: 'ok' },
      { voice_id: 'HALLUCINATED_ID', reason: '编造的' },
    ],
  })
  const result = parseVoiceRecommendations(content, candidates, 5)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.voice_id, 'aBC12')
})

test('parseVoiceRecommendations 尊重 top_k 且去重', () => {
  const content = JSON.stringify({
    recommendations: [
      { voice_id: 'aBC12', reason: 'a' },
      { voice_id: 'aBC12', reason: '重复' },
      { voice_id: '50lF5fQMqcxbDQOW6qOs', reason: 'c' },
    ],
  })
  const result = parseVoiceRecommendations(content, candidates, 1)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.voice_id, 'aBC12')
})

test('parseVoiceRecommendations 容忍围栏与前后噪声', () => {
  const content = '好的，这是推荐：\n```json\n{"recommendations":[{"voice_id":"50lF5fQMqcxbDQOW6qOs","reason":"英式"}]}\n```'
  const result = parseVoiceRecommendations(content, candidates, 5)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.voice_id, '50lF5fQMqcxbDQOW6qOs')
})

test('parseVoiceRecommendations 对垃圾输入返回空', () => {
  assert.deepEqual(parseVoiceRecommendations('not json at all', candidates, 5), [])
  assert.deepEqual(parseVoiceRecommendations('{"recommendations": "xx"}', candidates, 5), [])
})

test('buildRecommendMessages 截断候选到 MAX_CANDIDATES_IN_PROMPT 并附注释', () => {
  const many: VendorVoiceEntry[] = Array.from({ length: 90 }, (_, index) => ({
    provider: 'minimax',
    voice_id: `voice_${index}`,
    name: `Voice ${index}`,
    source: 'system' as const,
    deletable: false,
    description: 'x'.repeat(500),
  }))
  const messages = buildRecommendMessages('清亮少女音', many, 5)
  assert.ok(messages.system.includes('voice_id'))
  assert.ok(messages.user.includes('共 90 条候选'))
  assert.ok(messages.user.includes('仅展示前 80 条'))
  // long description truncated with …
  assert.ok(messages.user.includes('…'))
})

test('recommendVoices 注入假 LLM runtime 返回校验后的推荐', async () => {
  const stream = async function* () {
    yield { type: 'text-delta', text: '{"recommendations":[{"voice_id":"aBC12","reason":"少女音"}]}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const deps = {
    settings: {
      describe: () => [{ ns: 'agent-default-model', value: { provider: 'test', model: 'test-model' } }],
    },
    llm: () => ({ stream }),
  }
  const result = await recommendVoices(deps, '清亮甜美的少女音', candidates, 5)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.voice_id, 'aBC12')
  assert.equal(result[0]!.reason, '少女音')
})

test('recommendVoices 模型返回编造 id 时报错（防幻觉兜底）', async () => {
  const stream = async function* () {
    yield { type: 'block-end', block: { type: 'text', text: '{"recommendations":[{"voice_id":"fake","reason":"x"}]}' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const deps = {
    settings: {
      describe: () => [{ ns: 'agent-default-model', value: { provider: 'test', model: 'test-model' } }],
    },
    llm: () => ({ stream }),
  }
  await assert.rejects(
    () => recommendVoices(deps, '清亮少女音', candidates, 5),
    (error: Error) => error.message.includes('未能匹配候选池'),
  )
})

test('recommendVoices 空需求/空候选直接报错', async () => {
  await assert.rejects(() => recommendVoices({ settings: { describe: () => [] }, llm: undefined }, '   ', candidates, 5))
  await assert.rejects(
    () => recommendVoices({ settings: { describe: () => [] }, llm: undefined }, '清亮', [], 5),
    (error: Error) => error.message.includes('候选音色池为空'),
  )
})

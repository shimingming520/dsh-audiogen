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

test('parseVoiceRecommendations 支持按 voice_name 匹配（模型返回音色名而非 id）', () => {
  const content = JSON.stringify({
    recommendations: [
      { voice_name: 'Bright Alice', reason: '清亮少女音' },
      { voice_name: 'Sarcastic Nigel', reason: '英式讽刺' },
    ],
  })
  const result = parseVoiceRecommendations(content, candidates, 5)
  assert.equal(result.length, 2)
  assert.equal(result[0]!.voice_id, 'aBC12')
  assert.equal(result[1]!.voice_id, '50lF5fQMqcxbDQOW6qOs')
})

test('parseVoiceRecommendations 纯文本兜底：模型只输出音色名列表', () => {
  const content = '我认为最合适的是 Bright Alice，其次是 Sarcastic Nigel。'
  const result = parseVoiceRecommendations(content, candidates, 5)
  assert.equal(result.length, 2)
  assert.equal(result[0]!.voice_id, 'aBC12')
  assert.equal(result[1]!.voice_id, '50lF5fQMqcxbDQOW6qOs')
})

test('parseVoiceRecommendations 顶级对象/数组形态也能解析', () => {
  const objectForm = JSON.stringify({ voice_id: 'aBC12', reason: '少女音' })
  assert.equal(parseVoiceRecommendations(objectForm, candidates, 5)[0]!.voice_id, 'aBC12')
  const arrayForm = JSON.stringify([{ voice_id: 'aBC12' }, { voice_id: '50lF5fQMqcxbDQOW6qOs' }])
  assert.equal(parseVoiceRecommendations(arrayForm, candidates, 5).length, 2)
})

test('parseVoiceRecommendations 对垃圾输入返回空', () => {
  assert.deepEqual(parseVoiceRecommendations('not json at all and no candidate names', candidates, 5), [])
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

// ------------------------------------------------ 推荐记录存储（temp DSH_HOME）

test('AI 推荐记录：追加 / 列表（新→旧）/ 删除 / 上限', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-rec-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const mod = await import('../src/voice-recommend.ts')
  try {
    const base = { channel: 'MiniMax', channel_id: 'minimax-1', vendor: 'minimax', requirement: '清亮少女音', candidate_count: 373, top_k: 5 }
    await mod.appendVoiceRecommendRecord({ ...base, requirement: '第一次推荐' })
    await mod.appendVoiceRecommendRecord({ ...base, requirement: '第二次推荐', recommendations: [{ voice_id: 'v1', name: '音色一', source: 'system', deletable: false, reason: '理由' }] })

    let entries = await mod.listVoiceRecommendRecords()
    assert.equal(entries.length, 2)
    // 新记录插在最前
    assert.equal(entries[0]!.requirement, '第二次推荐')
    assert.equal(entries[0]!.recommendations[0]!.voice_id, 'v1')
    assert.equal(entries[0]!.channel_id, 'minimax-1')

    await mod.removeVoiceRecommendRecord(entries[1]!.id)
    entries = await mod.listVoiceRecommendRecords()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.requirement, '第二次推荐')

    // 删除不存在的 id：幂等
    await mod.removeVoiceRecommendRecord('no-such-id')
    assert.equal((await mod.listVoiceRecommendRecords()).length, 1)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

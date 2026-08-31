/**
 * voice-cast 单元测试：角色画像解析/归一化、硬过滤（gender/age/use_case 严格、
 * accent 可放松）、save_cast 校验（成员校验/备份补齐/复用警告）与选定记录落盘。
 * 运行：node --test tests/voice-cast.test.ts
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  parseCharacterProfiles,
  mapGender,
  mapAgeFilter,
  filterCandidatesWithFallback,
  prepareVoiceCast,
  saveVoiceCast,
  writeCastSelections,
  readStoredCastSelections,
  castSelectionsPath,
  type CharacterProfile,
  type CastSelectionInput,
} from '../src/voice-cast.ts'
import type { AudioChannel } from '../src/audio-engine.ts'
import { AudioGenError } from '../src/audio-engine.ts'
import type { VendorVoiceEntry } from '../src/voice-manager.ts'

interface FakeRoute {
  url: string
  method?: string
  body: unknown
}

function installFetch(routes: FakeRoute[]): void {
  ;(globalThis as { fetch: unknown }).fetch = async (url: string | URL, init?: RequestInit) => {
    const target = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const route = routes.find(item => target.includes(item.url) && (item.method ?? 'GET').toUpperCase() === method)
    if (route === undefined) throw new Error(`no mock route for ${method} ${target}`)
    return new Response(JSON.stringify(route.body), { status: 200 })
  }
}

const elevenChannel: AudioChannel = {
  id: 'eleven-1',
  preset: 'elevenlabs',
  name: 'ElevenLabs',
  apiUrl: 'https://example-eleven.local/v1',
  apiKey: 'test-key',
  models: [],
}

const minimaxChannel: AudioChannel = {
  id: 'minimax-1',
  preset: 'minimax',
  name: 'MiniMax',
  apiUrl: 'https://example-minimax.local',
  apiKey: 'test-key',
  models: [],
}

const pool: VendorVoiceEntry[] = [
  {
    provider: 'elevenlabs', voice_id: 'v_low_male', name: '深沉男声', source: 'shared',
    deletable: false, language: 'en', accent: 'british', gender: 'male', age: 'young',
    use_case: 'characters_animation', description: '低沉年轻男声', preview_url: 'https://x/v1.mp3',
  },
  {
    provider: 'elevenlabs', voice_id: 'v_bright_female', name: '清脆少女', source: 'shared',
    deletable: false, language: 'en', accent: 'british', gender: 'female', age: 'young',
    use_case: 'characters_animation', description: '清亮甜美少女声',
  },
  {
    provider: 'elevenlabs', voice_id: 'v_british_female2', name: '英音女声2', source: 'shared',
    deletable: false, language: 'en', accent: 'british', gender: 'female', age: 'young',
    use_case: 'characters_animation', description: '英式青年女性后备音色',
  },
  {
    provider: 'elevenlabs', voice_id: 'v_american_female', name: '美音御姐', source: 'shared',
    deletable: false, language: 'en', accent: 'american', gender: 'female', age: 'middle_aged',
    use_case: 'characters_animation', description: '美式成熟女性声',
  },
  {
    provider: 'elevenlabs', voice_id: 'v_owned_female', name: '自建音色', source: 'owned',
    deletable: true, language: 'en', accent: 'british', gender: 'female', age: 'young',
  },
]

// ------------------------------------------------------------ parsing

test('parseCharacterProfiles 接受数组/对象/JSON 字符串/多字段形态', () => {
  const fromArray = parseCharacterProfiles([
    { character_name: '慕声', gender: '男性', age_stage: '少年', voice_traits: '低沉、冷淡', appearance: ['少年；高马尾'] },
  ])
  assert.equal(fromArray[0]!.character_name, '慕声')
  assert.equal(fromArray[0]!.character_id, 'char_u6155_u58f0')
  assert.deepEqual(fromArray[0]!.voice_traits, ['低沉', '冷淡'])

  const fromObject = parseCharacterProfiles({
    character_id: 'char_a', character_name: '阿瑶', gender: 'female', age_stage: ['青年'],
  })
  assert.equal(fromObject[0]!.character_id, 'char_a')

  const fromString = parseCharacterProfiles(JSON.stringify([
    { character_name: '凌禄山', gender: '男性', age_stage: '中年', dialogue_count: 30 },
  ]))
  assert.equal(fromString[0]!.character_name, '凌禄山')

  const fromWrapper = parseCharacterProfiles({
    classified_characters: [{ character_name: '丫鬟' }],
  })
  assert.equal(fromWrapper[0]!.character_name, '丫鬟')
})

test('parseCharacterProfiles 缺 character_name 报错；JSON 非法报错', () => {
  assert.throws(() => parseCharacterProfiles([{ gender: '男' }]), (error: unknown) =>
    error instanceof AudioGenError && error.code === 'cast-character-missing-name')
  assert.throws(() => parseCharacterProfiles('角色简介：慕声，少年……'), (error: unknown) =>
    error instanceof AudioGenError && error.code === 'cast-characters-parse-failed')
})

test('sample_lines 接受字符串（按行）与对象数组（text/dialogue + emotion_hint）', () => {
  const profiles = parseCharacterProfiles([{
    character_name: '慕瑶',
    sample_lines: ['第一句', '第二句'],
  }, {
    character_name: '佩云',
    sample_lines: [{ dialogue: '对白', emotion_hint: '冷淡' }, { text: '第二句' }],
  }])
  assert.equal(profiles[0]!.sample_lines!.length, 2)
  assert.equal(profiles[0]!.sample_lines![0]!.text, '第一句')
  assert.equal(profiles[1]!.sample_lines![0]!.text, '对白')
  assert.equal(profiles[1]!.sample_lines![0]!.emotion_hint, '冷淡')
})

// ------------------------------------------------------------ mapping

test('mapGender：中英文归一', () => {
  assert.equal(mapGender('男性'), 'male')
  assert.equal(mapGender('女'), 'female')
  assert.equal(mapGender('female'), 'female')
  assert.equal(mapGender('MALE'), 'male')
  assert.equal(mapGender('未知'), undefined)
  assert.equal(mapGender(undefined), undefined)
})

test('mapAgeFilter：老/中年/少年/青年 归一到 ElevenLabs 年龄段', () => {
  assert.deepEqual(mapAgeFilter(['老年']), ['old'])
  assert.deepEqual(mapAgeFilter(['花甲老人']), ['old'])
  assert.deepEqual(mapAgeFilter(['中年', '肥胖男子']), ['middle_aged'])
  assert.deepEqual(mapAgeFilter(['少女']), ['young'])
  assert.deepEqual(mapAgeFilter(['青年', '成年']), ['young'])
  assert.deepEqual(mapAgeFilter([]), [])
})

// ------------------------------------------------------------ filter

test('filterCandidatesWithFallback：性别/年龄/用途严格，accent 可放松', () => {
  const strict = filterCandidatesWithFallback(pool, {
    gender: 'male', ages: ['young'], use_case: 'characters_animation', accent: 'british',
  })
  assert.equal(strict.candidates.length, 1)
  assert.equal(strict.candidates[0]!.voice_id, 'v_low_male')
  assert.equal(strict.relaxedAccent, false)

  // 严格 accent（american）无候选 → 自动放松（仍保留性别/年龄/用途；owned 缺 use_case 被排除）
  const relaxed = filterCandidatesWithFallback(pool, {
    gender: 'female', ages: ['young'], use_case: 'characters_animation', accent: 'american',
  })
  assert.equal(relaxed.relaxedAccent, true)
  assert.deepEqual(relaxed.candidates.map(voice => voice.voice_id).sort(), ['v_bright_female', 'v_british_female2'])

  // 无匹配 → 空 + 说明
  const empty = filterCandidatesWithFallback(pool, {
    gender: 'male', ages: ['old'], use_case: 'characters_animation', accent: 'british',
  })
  assert.equal(empty.candidates.length, 0)
  assert.ok(empty.notes.includes('empty'))
})

test('filterCandidatesWithFallback：use_case 为硬过滤，缺失元数据被排除', () => {
  const result = filterCandidatesWithFallback(pool, {
    gender: 'female', ages: ['young'], use_case: 'narration', accent: 'british',
  })
  assert.equal(result.candidates.length, 0)
  // 不设 use_case 时：female+young 全部保留（含 owned）
  const noUseCase = filterCandidatesWithFallback(pool, { gender: 'female', ages: ['young'] })
  assert.equal(noUseCase.candidates.length, 3)
})

// ------------------------------------------------------------ prepare (mock fetch)

test('prepareVoiceCast：ElevenLabs 每角色硬过滤 + mapped_filters', async () => {
  installFetch([
    { url: '/voices', body: { voices: [] } },
    { url: '/shared-voices', body: { voices: pool, has_more: false } },
  ])
  const profiles = parseCharacterProfiles([
    { character_id: 'char_musheng', character_name: '慕声', gender: '男性', age_stage: '少年', dialogue_count: 300 },
    { character_id: 'char_muyao', character_name: '慕瑶', gender: '女性', age_stage: '青年', dialogue_count: 120 },
  ])
  const result = await prepareVoiceCast(elevenChannel, profiles, {
    language: 'en', use_case: 'characters_animation', accent: 'british',
  })
  assert.equal(result.character_count, 2)
  const musheng = result.characters.find(view => view.character.character_id === 'char_musheng')!
  assert.equal(musheng.mapped_filters.gender, 'male')
  assert.deepEqual(musheng.mapped_filters.age, ['young'])
  assert.equal(musheng.character.importance_tier, 'lead')
  assert.ok(musheng.candidate_voices.some(voice => voice.voice_id === 'v_low_male'))
  assert.ok(!musheng.candidate_voices.some(voice => voice.voice_id === 'v_bright_female'))
  const muyao = result.characters.find(view => view.character.character_id === 'char_muyao')!
  assert.equal(muyao.mapped_filters.gender, 'female')
  assert.equal(muyao.character.importance_tier, 'major')
  // 严格候选 = female+young+british+animation → 不含美音/中年/男性；owned 无 use_case 被过滤
  assert.deepEqual(muyao.candidate_voices.map(voice => voice.voice_id).sort(), ['v_bright_female', 'v_british_female2'])
  assert.ok(!muyao.candidate_voices.some(voice => voice.voice_id === 'v_american_female'))
})

test('prepareVoiceCast：MiniMax 无性别/年龄元数据时按语言+描述候选（note 说明）', async () => {
  installFetch([
    {
      url: '/v1/get_voice', method: 'POST',
      body: {
        system_voice: [
          { voice_id: 'Chinese (Mandarin)_Mature_Woman', voice_name: '傲娇御姐', description: ['妩媚成熟青年御姐'] },
          { voice_id: 'Chinese (Mandarin)_Gentleman', voice_name: '温润男声', description: ['温润磁性青年男性'] },
          { voice_id: 'Japanese_CalmLady', voice_name: '日语女声' },
        ],
        voice_cloning: [],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const profiles = parseCharacterProfiles([
    { character_id: 'char_muyao', character_name: '慕瑶', gender: '女性', age_stage: '青年', language: 'zh' },
  ])
  const result = await prepareVoiceCast(minimaxChannel, profiles, { language: 'zh' })
  assert.equal(result.vendor, 'minimax')
  const view = result.characters[0]!
  assert.equal(view.candidate_count, 2)
  assert.ok(view.candidate_voices.every(voice => voice.language === 'Chinese (Mandarin)'))
  assert.ok(view.mapped_filters.notes.includes('青年'))
  assert.ok(view.mapped_filters.notes.includes('MiniMax'))
})

// ------------------------------------------------------------ save_cast (mock fetch + temp DSH_HOME)

const tmpDirs: string[] = []
after(() => Promise.all(tmpDirs.map(dir => rm(dir, { recursive: true, force: true }))))

async function withTempDshHome(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-voice-cast-'))
  tmpDirs.push(dir)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

test('saveVoiceCast：成员校验 + 备份补齐 + lead 复用警告 + 落盘', async () => {
  installFetch([
    { url: '/voices', body: { voices: [] } },
    { url: '/shared-voices', body: { voices: pool, has_more: false } },
  ])
  await withTempDshHome(async () => {
    const profiles = parseCharacterProfiles([
      { character_id: 'char_a', character_name: '男主', gender: '男性', age_stage: '少年', dialogue_count: 300 },
      { character_id: 'char_b', character_name: '女主', gender: '女性', age_stage: '青年', dialogue_count: 120 },
      // 故意给男主2 选同一个主音色 → 触发 lead 复用警告
      { character_id: 'char_c', character_name: '男二', gender: '男性', age_stage: '少年', dialogue_count: 250 },
    ])
    const selections: CastSelectionInput[] = [
      { character_id: 'char_a', voice_id: 'v_low_male', backup_voice_ids: ['v_bright_female'] },
      // 编造的 voice_id → 工具兜底第一个候选，并自动补齐备份
      { character_id: 'char_b', voice_id: 'hallucinated_id', reason: '清亮甜美的少女音' },
      { character_id: 'char_c', voice_id: 'v_low_male', reason: '另一个男性角色' },
    ]
    const saved = await saveVoiceCast(elevenChannel, profiles, selections, {
      language: 'en', use_case: 'characters_animation', accent: 'british',
    })
    assert.equal(saved.entries.length, 3)
    const a = saved.entries.find(entry => entry.character_id === 'char_a')!
    assert.equal(a.voice_id, 'v_low_male')
    assert.equal(a.selection_status, 'ok')
    // 候选仅 1 条（v_low_male）：不合法备份被丢弃且无需补齐
    assert.deepEqual(a.backup_voice_ids, [])
    assert.equal(a.importance_tier, 'lead')

    const b = saved.entries.find(entry => entry.character_id === 'char_b')!
    assert.notEqual(b.voice_id, 'hallucinated_id')
    assert.equal(b.voice_id, 'v_bright_female')
    assert.equal(b.selection_status, 'tool_fallback')
    assert.ok(b.issues.some(issue => issue.includes('voice_id_not_in_candidates')))
    assert.ok(b.backup_voice_ids.includes('v_british_female2'))
    assert.equal(b.importance_tier, 'major')

    const c = saved.entries.find(entry => entry.character_id === 'char_c')!
    assert.equal(c.voice_id, 'v_low_male')

    // char_a / char_c 同为 lead 且主音色相同 → 复用警告
    const reuseIssues = saved.issues.filter(issue => issue.issue === 'primary_voice_reused')
    assert.equal(reuseIssues.length, 2)
    assert.deepEqual(reuseIssues.map(issue => issue.character_id).sort(), ['char_a', 'char_c'])
    assert.ok(reuseIssues[0]!.detail.includes('v_low_male'))

    // 落盘可读回
    const stored = await readStoredCastSelections('eleven-1')
    assert.equal(stored['char_a']!.voice_id, 'v_low_male')
    assert.equal(stored['char_b']!.selection_status, 'tool_fallback')
    assert.ok(castSelectionsPath().startsWith(process.env.DSH_HOME!))
  })
})

test('writeCastSelections：同角色覆盖，多渠道隔离', async () => {
  await withTempDshHome(async () => {
    const record = {
      character_id: 'char_a',
      character_name: '男主',
      voice_id: 'v_low_male',
      voice_name: '深沉男声',
      backup_voice_ids: [] as string[],
      reason: '',
      dialogue_count: 300,
      importance_tier: 'lead',
      selection_status: 'ok' as const,
      issues: [] as string[],
      selected_at: new Date().toISOString(),
    }
    await writeCastSelections(elevenChannel, [record])
    await writeCastSelections(minimaxChannel, [{ ...record, character_id: 'char_a', voice_id: 'Chinese (Mandarin)_A' }])
    const eleven = await readStoredCastSelections('eleven-1')
    const mini = await readStoredCastSelections('minimax-1')
    assert.equal(eleven['char_a']!.voice_id, 'v_low_male')
    assert.equal(mini['char_a']!.voice_id, 'Chinese (Mandarin)_A')
  })
})

test('parseCharacterProfiles：importance_tier 显式优先于 dialogue_count', () => {
  const profiles = parseCharacterProfiles([
    { character_id: 'char_x', character_name: '旁白', dialogue_count: 10, importance_tier: 'supporting' },
  ])
  const byDialogue = parseCharacterProfiles([{ character_id: 'char_y', character_name: '主角', dialogue_count: 250 }])
  assert.equal(profiles[0]!.importance_tier, 'supporting')
  // 推导规则由 prepare/validate 内部应用：这里验证输入保留
  assert.equal(byDialogue[0]!.dialogue_count, 250)
})

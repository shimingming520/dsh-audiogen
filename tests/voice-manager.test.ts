/**
 * voice-manager 单元测试：mock globalThis.fetch，覆盖 MiniMax/ElevenLabs
 * 的音色列表（标准化+筛选）与删除保护逻辑。
 * 运行：node --test tests/voice-manager.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listVendorVoices,
  listVendorVoicesWithFallback,
  deleteVendorVoice,
  languageFromMiniMaxId,
} from '../src/voice-manager.ts'

const minimaxChannel = {
  id: 'minimax-1',
  preset: 'minimax',
  name: 'MiniMax',
  apiUrl: 'https://example-minimax.local',
  apiKey: 'test-key',
  models: [],
}
const elevenChannel = {
  id: 'eleven-1',
  preset: 'elevenlabs',
  name: 'ElevenLabs',
  apiUrl: 'https://example-eleven.local/v1',
  apiKey: 'test-key',
  models: [],
}

interface FakeRoute {
  url: string
  method?: string
  status?: number
  body: unknown
}

function installFetch(routes: FakeRoute[]): void {
  ;(globalThis as { fetch: unknown }).fetch = async (url: string | URL, init?: RequestInit) => {
    const target = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const route = routes.find(item => target.includes(item.url) && (item.method ?? 'GET').toUpperCase() === method)
    if (route === undefined) throw new Error(`no mock route for ${method} ${target}`)
    if (route.status !== undefined && route.status !== 200) {
      return new Response(JSON.stringify(route.body), { status: route.status })
    }
    return new Response(JSON.stringify(route.body), { status: 200 })
  }
}

test('languageFromMiniMaxId 检测语言前缀', () => {
  assert.equal(languageFromMiniMaxId('Chinese (Mandarin)_A'), 'Chinese (Mandarin)')
  assert.equal(languageFromMiniMaxId('Japanese_B'), 'Japanese')
  assert.equal(languageFromMiniMaxId('Arrogant_Miss'), undefined)
})

test('list MiniMax：system + custom 合并并标准化', async () => {
  installFetch([
    {
      url: '/v1/get_voice', method: 'POST',
      body: {
        system_voice: [
          { voice_id: 'Chinese (Mandarin)_Reliable_Executive', voice_name: '沉稳高管', description: ['沉稳可靠'] },
        ],
        voice_cloning: [
          { voice_id: 'voice_abc', voice_name: '定制音色', description: ['自定义'] },
        ],
        voice_generation: [
          { voice_id: 'voice_gen', voice_name: '生成音色' },
        ],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const result = await listVendorVoices(minimaxChannel)
  assert.equal(result.vendor, 'minimax')
  assert.equal(result.voices.length, 3)
  const system = result.voices.find(entry => entry.voice_id === 'Chinese (Mandarin)_Reliable_Executive')!
  assert.equal(system.source, 'system')
  assert.equal(system.language, 'Chinese (Mandarin)')
  assert.equal(system.deletable, false)
  const custom = result.voices.find(entry => entry.voice_id === 'voice_abc')!
  assert.equal(custom.source, 'custom')
  assert.equal(custom.deletable, true)
  assert.equal(custom.description, '自定义')
})

test('list MiniMax：keyword/language/source 筛选', async () => {
  installFetch([
    {
      url: '/v1/get_voice', method: 'POST',
      body: {
        system_voice: [
          { voice_id: 'Japanese_CalmLady', voice_name: 'Calm Lady', description: ['清晰温柔'] },
          { voice_id: 'Japanese_InnocentBoy', voice_name: 'Innocent Boy', description: ['少年感'] },
        ],
        voice_cloning: [],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const byKeyword = await listVendorVoices(minimaxChannel, { keyword: '少年' })
  assert.equal(byKeyword.voices.length, 1)
  assert.equal(byKeyword.voices[0]!.voice_id, 'Japanese_InnocentBoy')
  const byLanguage = await listVendorVoices(minimaxChannel, { language: 'jap' })
  assert.equal(byLanguage.voices.length, 2)
  const bySource = await listVendorVoices(minimaxChannel, { source: 'custom' })
  assert.equal(bySource.voices.length, 0)
})

test('list ElevenLabs：owned（labels）+ shared 合并，同 id owned 优先', async () => {
  installFetch([
    {
      url: '/voices',
      body: {
        voices: [
          {
            voice_id: 'own_1',
            name: 'My Voice',
            labels: { language: 'en', accent: 'british', gender: 'male' },
            description: 'my own voice',
            preview_url: 'https://own.example/a.mp3',
          },
          { voice_id: 'shared_dup', name: 'Owned Version' },
        ],
      },
    },
    {
      url: '/shared-voices',
      body: {
        voices: [
          {
            voice_id: 'shared_1',
            name: 'Nigel',
            language: 'en',
            accent: 'british',
            description: 'community voice',
            preview_url: 'https://shared.example/b.mp3',
          },
          { voice_id: 'shared_dup', name: 'Shared Version' },
        ],
        has_more: false,
      },
    },
  ])
  const result = await listVendorVoices(elevenChannel)
  assert.equal(result.vendor, 'elevenlabs')
  assert.equal(result.voices.length, 3)
  const owned = result.voices.find(entry => entry.voice_id === 'own_1')!
  assert.equal(owned.source, 'owned')
  assert.equal(owned.deletable, true)
  assert.equal(owned.language, 'en')
  assert.equal(owned.gender, 'male')
  assert.ok(owned.preview_url)
  const dup = result.voices.find(entry => entry.voice_id === 'shared_dup')!
  assert.equal(dup.source, 'owned')
  assert.equal(dup.name, 'Owned Version')
  const shared = result.voices.find(entry => entry.voice_id === 'shared_1')!
  assert.equal(shared.source, 'shared')
  assert.equal(shared.deletable, false)
})

test('delete MiniMax：拒绝系统预置音色', async () => {
  await assert.rejects(
    async () => {
      installFetch([
        {
          url: '/v1/get_voice', method: 'POST',
          body: {
            system_voice: [
              { voice_id: 'Japanese_CalmLady', voice_name: 'Calm Lady', description: [] },
            ],
            voice_cloning: [],
            base_resp: { status_code: 0 },
          },
        },
      ])
      await deleteVendorVoice(minimaxChannel, 'Japanese_CalmLady')
    },
    /只读|不能删除/,
  )
})

test('delete MiniMax：自定义音色成功（先 get_voice 校验再 delete）', async () => {
  const calls: string[] = []
  installFetch([
    {
      url: '/v1/get_voice', method: 'POST',
      body: {
        system_voice: [],
        voice_cloning: [{ voice_id: 'voice_abc', voice_name: '定制音色' }],
        base_resp: { status_code: 0 },
      },
    },
    {
      url: '/v1/delete_voice',
      method: 'POST',
      body: { base_resp: { status_code: 0 } },
    },
  ])
  const result = await deleteVendorVoice(minimaxChannel, 'voice_abc')
  assert.equal(result.deleted, true)
  assert.equal(result.vendor, 'minimax')
})

test('delete ElevenLabs：删除前校验自有，共享音色拒绝', async () => {
  await assert.rejects(
    async () => {
      installFetch([
        { url: '/voices', body: { voices: [] } },
        { url: '/voices/shared_1', method: 'DELETE', body: {} },
      ])
      await deleteVendorVoice(elevenChannel, 'shared_1')
    },
    /不是账户自有音色|不能删除/,
  )
})

test('delete ElevenLabs：自有音色删除成功', async () => {
  installFetch([
    { url: '/voices', body: { voices: [{ voice_id: 'own_1' }] } },
    { url: '/voices/own_1', method: 'DELETE', body: { ok: true } },
  ])
  const result = await deleteVendorVoice(elevenChannel, 'own_1')
  assert.equal(result.deleted, true)
  assert.equal(result.vendor, 'elevenlabs')
})

test('list ElevenLabs：官方筛选参数透传 shared-voices query', async () => {
  const urls: string[] = []
  ;(globalThis as { fetch: unknown }).fetch = async (url: string | URL) => {
    const target = String(url)
    urls.push(target)
    if (target.includes('/voices')) return new Response(JSON.stringify({ voices: [] }), { status: 200 })
    if (target.includes('/shared-voices')) return new Response(JSON.stringify({ voices: [], has_more: false }), { status: 200 })
    throw new Error(`unexpected ${target}`)
  }
  await listVendorVoices(elevenChannel, {
    language: 'en',
    serverFilters: {
      search: 'warm', use_case: 'narration', accent: 'british', gender: 'female',
      age: 'adult', locale: 'en-gb', category: 'animation', sort: 'most_used',
      featured: true, free_users_allowed: true, descriptive: true,
    },
  })
  const sharedUrl = urls.find(url => url.includes('/shared-voices'))!
  const query = new URL(sharedUrl).searchParams
  for (const [key, value] of Object.entries({
    language: 'en', search: 'warm', use_case: 'narration', accent: 'british',
    gender: 'female', age: 'adult', locale: 'en-gb', category: 'animation',
    sort: 'most_used', featured: 'true', free_users_allowed: 'true', descriptive: 'true',
  })) {
    assert.equal(query.get(key), value, `query ${key}`)
  }
})

test('官方筛选字段本地兜底：owned 音色也按 accent/gender 过滤', async () => {
  installFetch([
    {
      url: '/voices',
      body: {
        voices: [
          { voice_id: 'own_1', name: 'British Ow', labels: { accent: 'british', gender: 'male' } },
          { voice_id: 'own_2', name: 'American Ow', labels: { accent: 'american', gender: 'female' } },
        ],
      },
    },
    { url: '/shared-voices', body: { voices: [], has_more: false } },
  ])
  const result = await listVendorVoices(elevenChannel, {
    serverFilters: { accent: 'british', gender: 'male' },
  })
  assert.equal(result.voices.length, 1)
  assert.equal(result.voices[0]!.voice_id, 'own_1')
})

test('list MiniMax：服务端筛选参数以 note 说明（本地兜底过滤）', async () => {
  installFetch([
    {
      url: '/v1/get_voice',
      method: 'POST',
      body: {
        system_voice: [{ voice_id: 'Japanese_CalmLady', voice_name: 'Calm Lady' }],
        voice_cloning: [],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const result = await listVendorVoices(minimaxChannel, { serverFilters: { use_case: 'narration' } })
  assert.ok(result.note?.includes('use_case'))
})

test('list 排序：可删音色（custom/owned）优先于只读音色', async () => {
  installFetch([
    {
      url: '/v1/get_voice',
      method: 'POST',
      body: {
        system_voice: [
          { voice_id: 'male-qn-qingse', voice_name: '青涩青年' },
          { voice_id: 'female-shaonv', voice_name: '少女' },
        ],
        voice_cloning: [{ voice_id: 'voice_muyao', voice_name: '慕瑶定制' }],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const result = await listVendorVoices(minimaxChannel)
  assert.equal(result.voices[0]!.voice_id, 'voice_muyao')
  assert.equal(result.voices[0]!.deletable, true)
  assert.equal(result.voices[1]!.deletable, false)
})

test('list limit 生效且 truncated 标记', async () => {
  installFetch([
    {
      url: '/v1/get_voice',
      method: 'POST',
      body: {
        system_voice: [
          { voice_id: 's1', voice_name: '一' },
          { voice_id: 's2', voice_name: '二' },
          { voice_id: 's3', voice_name: '三' },
        ],
        voice_cloning: [],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const result = await listVendorVoices(minimaxChannel, { limit: 2 })
  assert.equal(result.voices.length, 2)
  assert.equal(result.truncated, true)
})

test('ElevenLabs 网关 404：错误信息带官方地址引导', async () => {
  installFetch([
    {
      url: '/voices',
      status: 404,
      body: { error: { message: 'Invalid URL (GET /v1/voices)' } },
    },
    {
      url: '/shared-voices',
      status: 404,
      body: { error: { message: 'Invalid URL (GET /v1/shared-voices)' } },
    },
  ])
  await assert.rejects(
    async () => { await listVendorVoices(elevenChannel) },
    /api\.elevenlabs\.io/,
  )
})

test('语言筛选：ISO 值匹配 MiniMax 语言前缀标签（zh→Chinese/Mandarin）', async () => {
  installFetch([
    {
      url: '/v1/get_voice',
      method: 'POST',
      body: {
        system_voice: [
          { voice_id: 'Chinese (Mandarin)_Reliable_Executive', voice_name: '沉稳高管' },
          { voice_id: 'Japanese_CalmLady', voice_name: 'Calm Lady' },
        ],
        voice_cloning: [],
        base_resp: { status_code: 0 },
      },
    },
  ])
  const zh = await listVendorVoices(minimaxChannel, { language: 'zh' })
  assert.equal(zh.voices.length, 1)
  assert.equal(zh.voices[0]!.voice_id, 'Chinese (Mandarin)_Reliable_Executive')
  const ja = await listVendorVoices(minimaxChannel, { language: 'ja' })
  assert.equal(ja.voices.length, 1)
  assert.equal(ja.voices[0]!.voice_id, 'Japanese_CalmLady')
})

test('不支持的渠道明确报错', async () => {
  await assert.rejects(
    () => listVendorVoices({ ...minimaxChannel, preset: 'stability', apiUrl: 'https://stability.example' }),
    /仅 MiniMax 与 ElevenLabs/,
  )
})

test('listVendorVoicesWithFallback：网关无音色库端点时回退为渠道模型目录', async () => {
  installFetch([
    { url: '/voices', status: 404, body: { error: { message: 'Invalid URL (GET /v1/voices)' } } },
    { url: '/shared-voices', status: 404, body: { error: { message: 'Invalid URL (GET /v1/shared-voices)' } } },
  ])
  const gatewayChannel = {
    ...elevenChannel,
    name: 'ElevenLabs（网关）',
    models: [
      { alias: 'Rachel', id: 'Rachel' },
      { alias: 'Adam', id: 'Adam' },
    ],
  }
  const result = await listVendorVoicesWithFallback(gatewayChannel)
  assert.equal(result.vendor, 'elevenlabs')
  assert.equal(result.voices.length, 2)
  assert.ok(result.voices.every(voice => voice.source === 'configured' && voice.deletable === false))
  assert.ok(result.note !== undefined && result.note.includes('回退'))
  // 筛选/keyword 本地仍生效（仅按名称）
  const filtered = await listVendorVoicesWithFallback(gatewayChannel, { keyword: 'Rachel' })
  assert.equal(filtered.voices.length, 1)
})

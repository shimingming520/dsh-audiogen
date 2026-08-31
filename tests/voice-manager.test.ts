/**
 * voice-manager 单元测试：mock globalThis.fetch，覆盖 MiniMax/ElevenLabs
 * 的音色列表（标准化+筛选）与删除保护逻辑。
 * 运行：node --test tests/voice-manager.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listVendorVoices,
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

test('不支持的渠道明确报错', async () => {
  await assert.rejects(
    () => listVendorVoices({ ...minimaxChannel, preset: 'stability', apiUrl: 'https://stability.example' }),
    /仅 MiniMax 与 ElevenLabs/,
  )
})

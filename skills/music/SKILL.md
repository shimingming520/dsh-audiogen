---
name: dsh-audiogen-music
description: DSH AI 音频插件（dsh-audiogen）的音乐生成技能：调用 generate_audio(mode=music)；覆盖 MiniMax（music-3.0/2.6/cover，lyrics 歌词、is_instrumental 纯音乐、audio_setting 采样率 16000-44100/码率 32000-256000/格式 mp3-wav-pcm、时长）、ElevenLabs（/v1/music，music_v2，时长 3-600s、lyrics_text、force_instrumental）与 Stability（stable-audio 2/2.5/3，官方 v2beta 或 OpenAI 兼容 /v1/audio/speech 双通道，seed/steps/cfg_scale/duration）。
whenToUse: 用户请求生成音乐、配乐、BGM、纯音乐、歌曲，或触发 /audio:music 时使用；MiniMax 未给歌词且未要求纯音乐时，先补一段歌词或设置 is_instrumental。
---
# 音乐生成

## 触发
- `/audio:music <描述>`
- 用户说“生成一段音乐 / 配乐 / BGM / 纯音乐”

## 参数
- prompt: 必填，风格/情绪/乐器/时长描述
- model: 可选，已配置的音频模型（MiniMax：music-3.0 / music-2.6 / music-cover）
- lyrics: 可选，歌词；**MiniMax music-3.0 / music-cover 必填**（除非 is_instrumental=true）；多段用空行分隔
- is_instrumental: 可选，是否纯音乐（无歌词/人声），true 时 lyrics 可留空
- duration: 可选，秒数（MiniMax 一般 5-120s）
- format: 可选，MiniMax 音乐仅 mp3 / wav / pcm

## 流程
1. 确认已配置支持音乐生成的渠道（如 MiniMax / Stability Audio / 自定义）。
2. 若用户未给歌词且未要求纯音乐：对 MiniMax 渠道先创作/补全一段歌词再调用。
3. 调用 `generate_audio`，mode=music。
4. 将生成的音频 URL 返回给用户。

## MiniMax 官方 music_generation 字段参考（POST /v1/music_generation）

| 字段 | 工具参数 | 说明 |
| --- | --- | --- |
| model | model | music-3.0 / music-2.6 / music-cover |
| prompt | prompt | 音乐风格/情绪/乐器描述（≤3000 字） |
| lyrics | lyrics | 歌词；多段用空行分隔；纯音乐模式可留空 |
| is_instrumental | is_instrumental | 默认 false；true = 纯音乐（无歌词/人声），此时 lyrics 可省 |
| duration | duration | 生成时长（秒） |
| audio_setting.format | format | **mp3 / wav / pcm**（仅此三种） |
| audio_setting.sample_rate | sample_rate | **16000 / 24000 / 32000 / 44100**（无 48000） |
| audio_setting.bitrate | bitrate | **32000 / 64000 / 128000 / 256000** |

> 引擎对音乐 audio_setting 按上述枚举校验，超出枚举的取值自动回退默认（format=mp3、sample_rate=44100、bitrate=256000）。
> 若不加 lyrics 也未开启纯音乐，引擎会直接提示 `lyrics-required`（MiniMax 上游返回 2013 lyrics is required）。

## 常见错误
- `lyrics-required`：MiniMax 音乐生成需要歌词，或开启纯音乐。
- `HTTP 400` 且含 `2013`：上游参数不合法，检查 lyrics / audio_setting 枚举。

## ElevenLabs Music（POST /v1/music，模型 music_v1 / music_v2）

| 字段 | 工具/面板参数 | 说明 |
| --- | --- | --- |
| model_id | model（music_v2 等） | 官方枚举：music_v1 / music_v2，默认 music_v1 |
| prompt | prompt | 音乐/歌词主题描述（不能与 composition_plan 同用；引擎用 prompt） |
| music_length_ms | duration（秒，自动×1000） | 3000ms - 600000ms（3s-600s），超出自动收敛区间 |
| lyrics_text | lyrics（歌词） | 选填歌词文本 |
| force_instrumental | is_instrumental（纯音乐） | true 保证无演唱（无词） |
| seed / generation_mode / finetune_* | — | 高级字段，暂未透出 |

> 响应为音频字节流（audio/*，常为 mp3）。请求同时携带 `xi-api-key` 与 `Authorization: Bearer`，以兼容 New API 类网关（官方站任一头即可）。

## Stability Stable Audio（官方 v2beta，multipart/form-data）

官方端点（文本到音频，TTS 描述 / 音乐 / 音效统一走该接口，不同模型参数不同）：
- `POST /v2beta/audio/stable-audio/text-to-audio` → 模型 `stable-audio-3`（202 异步，随后轮询 GET /v2beta/audio/results/{id}）
- `POST /v2beta/audio/stable-audio-2/text-to-audio` → 模型 `stable-audio-2` / `stable-audio-2.5`（同步返回音频）

| 字段 | 工具/面板参数 | 说明 |
| --- | --- | --- |
| prompt | prompt | 必填，描述性提示词（乐器/情绪/风格/体裁，≤10000 字符） |
| model | model | stable-audio-3 / stable-audio-2.5 / stable-audio-2 |
| duration | duration | 秒数：3 ≤380（默认 190）；2/2.5 ≤190（默认 190） |
| seed | seed | 0-4294967294，默认 0=随机；同参数同 seed 可复现 |
| steps | steps | 采样步数：2 → 30-100（默认 50）；2.5/3 → 4-8（默认 8） |
| cfg_scale | cfg_scale | 1-25：2 默认 7，2.5/3 默认 1；越高越贴提示词 |
| output_format | format | mp3 / wav |

> 引擎按模型自动收敛步数/时长区间；渠道 preset/apiUrl 含 `stability` 或模型名以 `stable-audio-` 开头即走官方协议（自定义渠道同样适用）。

### 双通道（自动选择）
- **官方 v2beta**：apiUrl 为 `https://api.stability.ai`（含 `/v2beta`、`/v2beta/audio` 形态）→ multipart 原生端点（2/2.5 同步、3 异步轮询）。
- **OpenAI 兼容网关**：apiUrl 以 `/v1` 结尾或含 `/audio/speech`（如 New API）→ `POST {apiUrl}/audio/speech`，JSON：
  `{ "model": "stable-audio-2.5", "input": "<prompt>", "output_format": "mp3", "duration": 30, "seed": 0, "steps": 8, "cfg_scale": 1 }`（网关把该模型映射到 Stable 上游）。
- 一方返回 `404 Invalid URL`（未路由）时自动换另一方重试；参数在两种通道均按模型收敛（duration/seed/steps/cfg_scale/output_format）。

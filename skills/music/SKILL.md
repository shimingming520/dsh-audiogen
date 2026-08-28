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

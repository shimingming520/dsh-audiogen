---
name: dsh-audiogen-tts
description: DSH AI 音频插件（dsh-audiogen）的 TTS 文本转语音技能：先确认渠道/模型/音色，再调用 generate_audio(mode=tts)；包含 MiniMax 官方 t2a_v2 全字段（语速/音量/音调/情绪/采样率/码率/声道/发音词典/字幕/变声/双音色混合）、ElevenLabs 与 Stable Audio 的对应参数说明，以及常见错误（voice-required、网关 404 Invalid URL 等）的处理。
whenToUse: 用户提出朗读、配音、语音合成、TTS，或触发 /audio:tts 时使用；MiniMax 必须提供音色 voice_id。
---
# TTS 文本转语音

## 触发
- `/audio:tts <文本>`
- 用户说“朗读 / 配音 / 语音生成”

## 参数
- text: 必填，要朗读的文本
- model: 可选，已配置的模型/音色（MiniMax 为 speech-2.6/2.8 系列）
- voice: 可选，音色；**MiniMax 必填**（voice_id，如 male-qn-qingse、female-shaonv）
- speed: 可选，语速倍率（MiniMax 0.5-2.0，默认 1）
- format: 可选，mp3 / wav / flac / aac / pcm

## 流程
1. 确认已配置音频渠道（设置 → 插件 → AI 音频）。
2. 若用户未指定模型且有多个，先询问。
3. 调用 `generate_audio` 工具，mode=tts。
4. 把返回的音频 URL 提供给用户，可播放/下载。

## MiniMax 官方 t2a_v2 字段参考（POST /v1/t2a_v2）

引擎按官方协议逐字段透传（无值时不发送）；以下字段均可在 `generate_audio` 中按需传入（仅 MiniMax 渠道生效）：

| 字段 | 工具参数 | 说明 |
| --- | --- | --- |
| model | model | 模型：speech-2.8-hd / speech-2.8-turbo / speech-2.6-hd / speech-2.6-turbo / speech-02-hd / speech-02-turbo |
| text | prompt | 文本，支持 (laughs) 等标签 |
| stream | — | 固定 false（引擎非流式消费） |
| voice_setting.voice_id | voice | **必填**音色；账号音色可在设置中「获取可用模型」拉取 |
| voice_setting.speed | speed | 0.5-2.0，默认 1 |
| voice_setting.vol | vol | 音量 0-10，默认 1 |
| voice_setting.pitch | pitch | 音调偏移 -12~12，默认 0 |
| voice_setting.emotion | emotion | 情绪：happy / sad / angry / nervous / fearful / bored 等 |
| voice_setting.text_normalization | text_normalization | 文本归一化开关 |
| voice_setting.latex_read | latex_read | 数学公式朗读开关 |
| pronunciation_dict.tone | pronunciation_tone | 发音词典条目数组，如 ["处理/(chu3)(li3)", "危险/dangerous"]（每项 "文字/读音"） |
| audio_setting.format | format | mp3 / wav / pcm，默认 mp3 |
| audio_setting.sample_rate | sample_rate | 16000/24000/32000/44100/48000，默认 32000 |
| audio_setting.bitrate | bitrate | 64000-320000，默认 128000 |
| audio_setting.channel | channel | 1 或 2，默认 1 |
| audio_setting.force_cbr | force_cbr | 强制 CBR 编码 |
| subtitle_enable | subtitle_enable | 生成字幕（响应携带字幕内容） |
| aigc_watermark | aigc_watermark | AIGC 水印 |
| language_boost | language_boost | 语言增强（模型相关，如中英混读） |
| voice_modify | voice_modify | 变声 {pitch, intensity, timbre, sound_effects}（speech-2.8 等支持） |
| timbre_weights | timbre_weights | 双音色混合 [{voice_id, weight}] |

### 网关/代理渠道
- 官方默认地址 `https://api.minimaxi.com`（原生 `/v1/t2a_v2`，字段全量支持）。
- 若渠道配置为 New API 一类网关（只暴露 OpenAI 兼容 `/v1/audio/speech`，对 `/v1/t2a_v2` 返回 404 Invalid URL），引擎会自动回退到 `/v1/audio/speech`，并把上述官方字段放进 `metadata` 供网关合并转发；此类网关的字段支持取决于其实现。
- 回退也失败时，错误信息会同时给出两种端点与排查建议。

### 常见错误
- `voice-required`：未选择音色，需传 voice（voice_id）。
- HTTP 404 Invalid URL：网关未路由 `/v1/t2a_v2`（已自动回退）。
- `HTTP 400` 且 base_resp.status_code 非 0：上游参数不合法（如 emotion 不受该音色支持）。

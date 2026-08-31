---
name: dsh-audiogen-sfx
description: DSH AI 音频插件（dsh-audiogen）的音效生成技能：调用 generate_audio(mode=sfx)；覆盖 ElevenLabs（/v1/sound-generation，eleven_text_to_sound_v2，loop 无缝循环、prompt_influence 0-1、duration_seconds 0.5-30）与 MiniMax、Stability 等渠道的对应字段与常见错误处理。
whenToUse: 用户请求生成音效、提示音、环境音、UI 音，或触发 /audio:sfx 时使用。
---
# 音效生成

## 触发
- `/audio:sfx <描述>`
- 用户说“生成一个音效 / 提示音 / 环境音”

## 参数
- prompt: 必填，音效描述
- model: 可选，已配置模型（ElevenLabs：eleven_text_to_sound_v2）
- duration: 可选，秒数（ElevenLabs 0.5-30，留空则自动）
- loop: 可选，ElevenLabs 无缝循环音效（仅 eleven_text_to_sound_v2）
- prompt_influence: 可选，ElevenLabs 提示词影响度 0-1（默认 0.3，越高越贴近提示词、越少随机）
- format: 可选

## 流程
1. 确认已配置音效生成渠道。
2. 调用 `generate_audio`，mode=sfx。
3. 将音频 URL 返回。

## ElevenLabs Sound Generation（POST /v1/sound-generation）

| 字段 | 工具/面板参数 | 说明 |
| --- | --- | --- |
| text | prompt | 必填，转换为音效的文本/描述 |
| model_id | model | 官方枚举：eleven_text_to_sound_v2（默认） |
| duration_seconds | duration | 0.5-30 秒；留空由提示词推算最优时长 |
| loop | loop | 是否生成平滑循环音效（仅 eleven_text_to_sound_v2） |
| prompt_influence | prompt_influence | 0-1，默认 0.3；越高越贴提示词，越低越多样 |

> 响应为 audio/mpeg 二进制。请求同时携带 `xi-api-key` 与 `Authorization: Bearer`，兼容 New API 类网关。
>
> 网关自动回退：当渠道 API 地址不是 ElevenLabs 官方域名且官方协议被网关拒绝时
> （404 Invalid URL / 401 Invalid token，例如 ai.farmmx.com 未映射 `/v1/sound-generation`），
> 引擎自动改用 OpenAI 兼容形态重试：`POST {base}/audio/speech` + `Authorization: Bearer` +
> `model=eleven_text_to_sound_v2` + `text/duration_seconds/prompt_influence/loop` 字段。
> 官方地址（api.elevenlabs.io）直连时不触发回退。音色设计在网关无对应兼容端点，会明确报错不便死等。

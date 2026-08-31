---
name: dsh-audiogen-voice-management
description: 浏览/筛选/删除厂商音色库（MiniMax、ElevenLabs）并复用选定音色生成 TTS。当用户提到「音色管理 / 音色列表 / 查看有哪些音色 / 删除音色 / 筛选音色 / 用某个音色 TTS / 声音列表」时触发。与资源库（本地生成结果）无关，请勿混淆。
whenToUse: 需要查看某个渠道（MiniMax / ElevenLabs）有哪些可用音色、按语言/关键词筛选音色、删除某个自建音色，或拿到音色 voice_id 后用它生成语音时。
---

# 厂商音色管理（dsh-audiogen）

插件提供 `manage_audio_voices` 工具，对接厂商官方音色管理接口：

| 渠道 | 浏览 | 删除 |
|---|---|---|
| MiniMax | `POST /v1/get_voice`（system 预置 + voice_cloning/voice_generation 自建） | `POST /v1/delete_voice`（仅自建） |
| ElevenLabs | `GET /v1/voices`（自有）+ `GET /v1/shared-voices`（社区共享库） | `DELETE /v1/voices/{voice_id}`（仅自有） |

## 浏览音色（action=list）

```json
{"action": "list", "channel": "MiniMax", "language": "zh", "keyword": "少女", "source": "custom"}
```

- `channel`：设置中的渠道名称或 id；缺省用默认渠道，多渠道时必须指定。
- `language`：语言子串（`en` / `zh` / `ja`，或 `Chinese (Mandarin)` 等）。
- `keyword`：音色名/描述/口音/用途中的自由词。
- `source`：`system`（官方预置）| `custom`（MiniMax 自建）| `owned`（ElevenLabs 自有）| `shared`（ElevenLabs 社区库）。
- 返回每条含 `voice_id` / `name` / `source` / `deletable` / `description` / `preview_url`。

## 删除音色（action=delete）

```json
{"action": "delete", "channel": "MiniMax", "voice_id": "voice_abc123", "confirm": true}
```

- 仅 `deletable=true`（custom/owned）的音色可删；官方/共享/系统音色会被拒绝。
- 删除不可逆：必须显式传 `confirm: true`，且 `voice_id` 用 `action=list` 返回的精确值。

## 闭环：选定音色 → 生成 TTS

1. `manage_audio_voices(list)` 找到符合需求的音色，记录其 `voice_id`。
2. `generate_audio(mode="tts", voice="<voice_id>", channel="<渠道名>", prompt="...")` 生成语音。

MiniMax TTS 的 `voice` 参数需要官方 voice_id；ElevenLabs 的 `voice` 参数可填音色 name 或 voice_id（网关渠道强制 voice_id）。

## 常见错误

- `channel-choice-required`：多个渠道未指定 → 先 `manage_audio_voices(list, channel=...)` 或询问用户。
- 删除被拒（`system`/`shared` 只读）：换个 `source=custom`/`owned` 的音色。
- 拉取失败：渠道 API 地址/密钥错误，或网关不支持音色管理端点（Stability、自定义 OpenAI 兼容渠道无此能力，会明确提示不支持）。

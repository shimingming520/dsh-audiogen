---
name: dsh-audiogen-voice-management
description: 浏览/筛选/删除厂商音色库（MiniMax、ElevenLabs）并按需求描述（prompt）推荐音色，复用选定音色生成 TTS。当用户提到「音色管理 / 音色列表 / 查看有哪些音色 / 删除音色 / 筛选音色 / 推荐音色 / 选个合适的音色 / 用某个音色 TTS / 声音列表」时触发。与资源库（本地生成结果）无关，请勿混淆。
whenToUse: 需要查看某个渠道（MiniMax / ElevenLabs）有哪些可用音色、按语言/关键词筛选音色、按一段描述（如「清亮甜美的少女音」）让模型推荐音色、删除某个自建音色，或拿到音色 voice_id 后用它生成语音时。
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
- `keyword`：音色名/描述/口音/用途中的自由词（本地过滤）。
- `source`：`system`（官方预置）| `custom`（MiniMax 自建）| `owned`（ElevenLabs 自有）| `shared`（ElevenLabs 社区库）。
- 返回每条含 `voice_id` / `name` / `source` / `deletable` / `description` / `preview_url`。

### ElevenLabs 官方共享库筛选（服务端参数，对应官方 GET /v1/shared-voices）

```json
{"action": "list", "channel": "ElevenLabs", "use_case": "characters_animation", "accent": "british", "gender": "female", "sort": "most_used", "featured": true}
```

| 参数 | 说明 |
|---|---|
| `search` | 共享库自由文本搜索 |
| `use_case` | 用途，如 `characters_animation` / `conversational` / `narration` / `gaming` |
| `accent` | 口音，如 `british` / `american` / `australian` |
| `gender` | `male` / `female` |
| `age` | 年龄段，如 `adult` / `young` / `middle_aged` |
| `locale` | 方言，如 `en-us` / `en-gb` |
| `category` | 分类，如 `animation` |
| `sort` | `most_used` / `random` / `oldest` / `newest` |
| `featured` / `free_users_allowed` / `descriptive` | 布尔筛选（仅传 true 时生效） |

这些参数只对 ElevenLabs 共享库起作用（服务端筛选），自有音色与其他渠道按同名字段本地兜底；MiniMax 无服务端筛选端点，会在返回 `note` 中说明。

## 按需求描述推荐音色（action=recommend）

```json
{"action": "recommend", "channel": "ElevenLabs", "language": "en", "requirement": "17岁清亮甜美的少女音，适合活泼女主角，英式口音", "top_k": 5}
```

- `requirement`（必填）：自然语言需求描述。模型按语言/性别/年龄感/气质/用途综合打分。
- `top_k`：推荐条数（1-10，默认 5）。
- 候选池 = 当前渠道 + 传入的筛选条件（language/keyword/source + 共享库服务端参数），默认拉宽到上限 500 条；结果中的 `voice_id` 均校验为候选池真实成员（模型编造的 id 会被丢弃）。
- 返回 `recommendations`：每条含 `voice_id` / `name` / `source` / `deletable` / `preview_url` 等音色字段 + `reason`（中文推荐理由）。
- 机制：复用 Agent 默认模型（「设置 → 模型」的 agent-default-model），**不新增 API key**；模型未配置时提示先设置默认模型。
- 推荐后再 `generate_audio(mode="tts", voice="<voice_id>")` 闭环生成。

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
- `recommend-requirement-required`：推荐时缺 `requirement` → 补上自然语言描述。
- `recommend-no-candidates`：候选池为空 → 确认渠道音色库可用，或放宽筛选。
- `recommend-parse-failed`：模型返回的推荐未命中候选池 → 重试，或用语言/关键词先缩小候选集。
- 删除被拒（`system`/`shared` 只读）：换个 `source=custom`/`owned` 的音色。
- 拉取失败：渠道 API 地址/密钥错误，或网关不支持音色管理端点（Stability、自定义 OpenAI 兼容渠道无此能力，会明确提示不支持）。

## 角色选角（多角色分配音色）

上面是「一个需求 → 一个音色」。如果用户有一整组角色（小说/游戏配音）要为每个角色分配
主音色（+备用音色），使用工具的 **action=cast / action=save_cast** 两个动作：

1. `action=cast`：传 `characters`（角色画像 JSON 数组/对象，含 character_name/gender/age_stage/
   voice_traits/personality_traits/appearance/sample_lines/dialogue_count），工具按性别/年龄/用途做
   确定性硬过滤（accent 为偏好、候选为空才放松），返回每个角色的候选池。
2. Agent 在上下文中全局选角（lead/major 角色主音色不要复用；每角色主音色 + 最多 2 个备用）。
3. `action=save_cast`：传同样的 `characters` + `selections`，工具校验 voice_id 属于候选池、
   补齐备份、标记复用警告并持久化到 `~/.dsh/dsh-audiogen/cast-selections.json`。
4. 用选定 `voice_id` 调 `generate_audio` 生成 TTS；无合适音色时先用
   `generate_audio(mode="voice_design")` 创作专属音色。

完整流程、输入结构示例与约束见 **dsh-audiogen-voice-cast** 技能。

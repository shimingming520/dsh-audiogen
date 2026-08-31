---
name: dsh-audiogen-voice-cast
description: 角色音色选角（casting）——把角色画像（JSON 或文本）交给 DSH AI 音频插件，manage_audio_voices 的 action=cast 做确定性硬过滤（性别/年龄/用途严格、accent 可放松）得到每个角色的候选音色池，Agent 在上下文中全局权衡主音色（lead/major 不复用）+ 备用音色，再用 action=save_cast 校验落盘并生成 TTS。当用户提到「为角色选音色 / 角色配音 / 给每个角色分配声音 / 选角 / 角色音色表 / 给小说或游戏角色挑声线」时触发。
whenToUse: 用户有一批角色（小说/游戏/剧本），需要用 MiniMax 或 ElevenLabs 音色为每个角色分配主音色（可带备用音色），且输入可能是结构化 JSON 或自然语言文本；或想把选角结果保存下来再逐角色生成 TTS 时。
---

# 角色音色选角（dsh-audiogen voice cast）

选角 = **角色画像 → 确定性硬过滤（工具）→ 全局权衡（Agent 推理）→ 校验落盘（工具）→ TTS 生成**。
工具不做「选谁」的推理（那是本 Agent 的工作，保持整组阵容的全局视野）；工具只做可校验的过滤与防幻觉校验。

## 第一步：整理输入（JSON 或文本都行，但工具只接受 JSON 结构）

`manage_audio_voices` 的 `characters` 参数接受：JSON 数组 / 单个对象 / JSON 字符串。
如果用户给的是自然语言文本（如「男主慕声，少年，声音低沉阴郁；女主慕瑶，青年，清冷……」），
**先把它整理成下面的结构**再调用：

```json
{
  "action": "cast",
  "channel": "MiniMax",
  "language": "zh",
  "characters": [
    {
      "character_id": "char_musheng",
      "character_name": "慕声",
      "gender": "男性",
      "age_stage": "少年",
      "voice_traits": ["声音低沉轻柔", "冷淡"],
      "personality_traits": ["阴郁", "狠厉", "占有欲强"],
      "appearance": ["少年；高马尾；黑发微卷；身形单薄"],
      "sample_lines": [{"text": "……", "emotion_hint": "冷淡"}],
      "dialogue_count": 300
    },
    {
      "character_id": "char_muyao",
      "character_name": "慕瑶",
      "gender": "女性",
      "age_stage": "青年",
      "voice_traits": ["清冽动听", "清冷"],
      "personality_traits": ["清冷", "孤傲", "坚强"],
      "dialogue_count": 120
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `character_id` | 否 | 缺省按角色名自动生成（`char_<slug>`） |
| `character_name` | 是 | 角色名（缺失会报 `cast-character-missing-name`） |
| `gender` | 否 | 男/女、male/female（自动归一） |
| `age_stage` | 否 | 少年/青年/中年/老年 或数组；可加 `age_stage_source`（explicit/appearance_inferred/unknown）表示年龄字段可信度 |
| `voice_traits` / `personality_traits` / `appearance` | 否 | 字符串或数组，自动按 `；;、,，/|` 拆分去重 |
| `sample_lines` | 否 | 样例台词（voice_design 的 preview_text 来源，最多 3 句） |
| `dialogue_count` | 否 | 台词量：≥200 → lead，≥50 → major，其余 supporting（决定「主音色不复用」的约束） |
| `language` / `use_case` | 否 | 语言（如 zh/en）与用途（如 characters_animation）；也可在工具顶层传 |

## 第二步：action=cast 拿每角色的候选池（工具做确定性硬过滤）

```json
{
  "action": "cast",
  "channel": "ElevenLabs",
  "language": "en",
  "use_case": "characters_animation",
  "accent": "british",
  "characters": [……]
}
```

返回每个角色的 `character`（含 `importance_tier`）、`mapped_filters`（映射后的过滤条件 + notes）与
`candidate_voices`（每条含 voice_id/name/source/gender/age/accent/use_case/description/preview_url）。

**过滤规则（与音频工作室项目一致）**：

- `gender`：男→male / 女→female；映射出来后是**硬过滤**，绝不放松。
- `age`：少年/少女/青年/成年→young；中年→middle_aged；老年→old；**硬过滤**。
- `use_case`：**硬过滤**（ElevenLabs 默认 `characters_animation`；传 `""` 关闭）。
- `accent`：**只是偏好**——严格候选为空时才放松（重新从全池过滤）。
- MiniMax 系统/自建音色没有性别/年龄/用途元数据：候选池按语言（voice_id 前缀）本地过滤，
  排名完全靠名称/描述，需要 Agent 结合声音描述判断。
- 候选最多 60 条/角色，超限自动截断并在 `note` 标注。

## 第三步：全局选角（Agent 推理，这是 LLM 的活）

拿到每角色候选池后，在上下文里统一权衡（不要逐角色独立选）：

1. 先看 `voice_traits`（声线质感），用 `personality_traits` 修正气质（清冷/温润/阴郁/活泼/胆怯/威严）。
2. 用 `gender` + `age_stage` 排除明显不合的候选（注意 `age_stage_source`：explicit 时年龄是唯一依据，
   appearance 里的年龄词只能作辅助）。
3. 主音色要能承担长台词：清晰度、稳定音量、中性/紧张/温柔/愤怒都要可行；
   很强"效果音"质感的只适合备用槽，除非那正是角色日常说话身份。
4. **lead / major 角色主音色不得复用**；supporting 只有无替代候选时才可复用并在 reason 说明。
5. 每个角色主音色 + 最多 2 个备用（`backup_voice_ids`）；`reason` 简短中文理由。

## 第四步：action=save_cast 校验落盘

```json
{
  "action": "save_cast",
  "channel": "ElevenLabs",
  "characters": [……同 cast……],
  "selections": [
    {"character_id": "char_musheng", "voice_id": "bjoUrk7s2fY9cu2u67KF", "backup_voice_ids": ["q1h5HGdnfVxp4TXTJRNN"], "reason": "低沉阴郁的少年音…"}
  ]
}
```

工具会：
- 重新按相同规则算候选池，校验 `voice_id` 属于该角色候选（**编造/过期 id 会被兜底并标记 `tool_fallback`**）;
- 自动补齐 `backup_voice_ids`（最多 2 个，不重复、不等于主音色）；
- 检查 lead/major 主音色复用（`issues` 里给 `primary_voice_reused` 警告，需你下一轮修正后重存）；
- 持久化到 `~/.dsh/dsh-audiogen/cast-selections.json`（按渠道 + character_id 覆盖保存）。

返回 `selections`（含 `selection_status`/`issues`）与 `issues`；有 `primary_voice_reused` 时修一下再存。

## 第五步：按选定音色生成 TTS

```json
{"mode": "tts", "channel": "ElevenLabs", "voice": "<voice_id>", "prompt": "对白文本"}
```

- MiniMax 的 `voice` 必须是官方 voice_id（如 `Chinese (Mandarin)_Gentleman` 或 `voice_xxx`）。
- 若字符没有合适现成音色，先用 **voice_design 创作专属音色**（见 dsh-audiogen-voice-design 技能）：

```json
{"mode": "voice_design", "prompt": "一位清冷孤傲却带柔情的青年女声，音色清冽，气质疏离……", "preview_text": "从 sample_lines 里选一句，或写一句自然对白"}
```

  生成的 `voiceId` 可直接作为该角色的主音色 `voice_id` 写入 save_cast。

## 常见错误

- `cast-characters-parse-failed`：characters 不是合法 JSON → 先整理成数组/对象再调用。
- `cast-character-missing-name`：某个角色缺 `character_name`。
- `cast-selections-required`：save_cast 忘了传 `selections`。
- `character_count=0` 或显示候选为空：检查语言/use_case 太严（use_case 传 `""` 再试），或渠道网关不支持音色库。
- `channel-choice-required`：多渠道未指定 → 显式传 `channel`（如 "ElevenLabs"）。
- 候选池只有 shared/system（只读）没关系：cast 只需要 voice_id，生成时照常可用。
- 网关渠道无音色库端点时：cast 候选池会回退为该渠道配置的音色目录（`source=渠道模型`，无性别/年龄
  元数据），此时硬过滤不适用，只能按名称/描述判断；需要完整候选池请配置官方 API 地址的渠道。

## 与推荐的区别

- `action=recommend`：一句需求文本（如「17岁清亮甜美少女音」）→ 插件 LLM 给 top-k，
  适合**单个声线的快速推荐**（无角色结构）。
- `action=cast` + `save_cast`：**整组角色** → 工具硬过滤 + Agent 全局选角 + 校验落盘，
  适合**小说/游戏配音的正式选角**（JSON 或文本角色清单）。

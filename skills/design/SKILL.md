# 音色/音效设计

## 触发
- `/audio:design <描述>`

## 用途
- 帮助用户把音色或音效需求细化成可复用的描述，供后续 TTS/music/sfx 生成。
- 输出不建议直接生成音频，而是给出音色参数建议和可用的模型/音色清单。

## 面板/工具的音色设计（voice_design）
- 渠道支持：MiniMax（POST /v1/voice_design，prompt + preview_text）与 ElevenLabs（POST /v1/text-to-voice/design）。
- MiniMax 参数：`prompt`（音色描述）、`preview_text`（试听文本，任意长度）。
- ElevenLabs 参数：`voice_description`（音色描述）；试听文本 `preview_text` 需 100-1000 字符，过短时自动 `auto_generate_text`；响应含 `previews[].audio_base_64` 与 `generated_voice_id`（可后续在 TTS 中复用该 voice_id）。
- 面板音色设计模式顶部可切换「厂商 / 渠道」。

## 流程
1. 询问目标风格、音域、情绪、适用场景。
2. 生成结构化的音色描述（如温暖复古合成器、未来感 UI 提示音）。
3. 在后续生成中复用该描述，必要时通过 `generate_audio`（mode=voice_design）试听。

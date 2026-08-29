# 🎧 dsh-audiogen

**AI audio generation for DeepSeek Harness (DSH)** — turn your DSH web GUI into an audio studio: text-to-speech, music, sound effects and voice design, from the sidebar panel or straight from the Agent.

[English](README.md) | [简体中文](README.zh-CN.md)

![npm version](https://img.shields.io/npm/v/dsh-audiogen?style=flat-square&color=8B5CF6)
![license](https://img.shields.io/npm/l/dsh-audiogen?style=flat-square)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-brightgreen?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)

![Main panel](docs/images/hero.png)

## ✨ Features

- **Four generation modes**: text-to-speech, music, sound effects, and voice design
- **Multi-vendor channels in one place**: OpenAI-compatible TTS, MiniMax, ElevenLabs, Stability AI, or any custom OpenAI-compatible / generic POST endpoint
- **Per-channel model & voice catalogs** with one-click discovery, display aliases, capability categories, and per-model advanced fields (duration, seed, steps, cfg_scale, loop, prompt influence, …)
- **Model comparison**: run the same prompt across 2–4 models at once with per-model parameter overrides — results are grouped side by side
- **Prompt enhancement**: rewrite a rough idea into a ready-to-generate description with an LLM (pick any model from *Settings → Models*; falls back to the agent default model)
- **History with one-click restore**: prompt, config, model set *and the original audio* come back into the panel — no regeneration, no extra cost
- **Resource library**: auto-save generated audio (or opt in per run), organized by type — voices / music / SFX / TTS — with search, tags, rename, category moves, and full provenance (channel, model, voice id, prompt, params snapshot). Reuse a voice or music bed instead of regenerating
- **Agent tools**: `generate_audio` and `search_audio_library`, plus bundled session skills — the Agent can generate and find audio on demand
- **Keys stay local**: API keys live in the local DSH settings document and generation is proxied by the local host; the browser and the Agent never touch plaintext credentials

## 📸 Screenshots

| Generation panel | Resource library |
| --- | --- |
| ![Generation](docs/images/hero.png) | ![Library](docs/images/library.png) |

| Library — full provenance drawer | Channels settings |
| --- | --- |
| ![Library detail](docs/images/library-detail.png) | ![Settings](docs/images/settings-channels.png) |

| Channel editor (model catalog & auto capabilities) | LLM models (Settings → Models) |
| --- | --- |
| ![Channel editor](docs/images/settings-stability.png) | ![Models page](docs/images/models-page.png) |

## 📦 Installation

The plugin is published on npm. DSH host (Node ≥ 20) required.

```bash
dsh plugin --profile web add dsh-audiogen
```

Local development install:

```bash
dsh plugin --profile web add /path/to/dsh-audiogen
```

Restart `dsh web` after install — the sidebar will show the **AI Audio** entry.

## 🚀 Quick start

1. Open **Settings → Plugins → AI Audio**
2. Add a channel: pick a preset provider (+ Add provider) or a custom endpoint (+ Add custom provider)
3. Fill in the API URL, API key, and the model/voice catalog (use *Fetch available models* to import them)
4. Save, then open the **AI Audio** sidebar panel:
   - choose a mode (Speech / Music / Sound effects / Voice design)
   - type your text or prompt (optional: ✨ Enhance prompt)
   - pick a model — or tick **Model comparison** for 2–4 models at once
   - press **Start generation** and play the results, download them, or add them to the resource library

## 🎛 Modes supported by each vendor

| Mode | MiniMax | ElevenLabs | Stability AI | OpenAI-compatible / custom |
| --- | --- | --- | --- | --- |
| TTS | ✅ (8 voices) | ✅ (voices + streams) | — | ✅ |
| Music | ✅ (`music-3.0` / `music-2.6` / `music-cover`) | ✅ (`music_v2`) | ✅ (`stable-audio-*`) | ✅ (generic POST) |
| Sound effects | — | ✅ (`eleven_text_to_sound_v2`, loop / prompt influence) | ✅ (`stable-audio-*` — same text-to-audio protocol; auto-detected in both Music and SFX) | ✅ (generic POST) |
| Voice design | ✅ (`/v1/voice_design`) | ✅ (`/v1/text-to-voice/design`) | — | — |

## 🤖 Agent usage

| Tool | Purpose |
| --- | --- |
| `generate_audio` | Submit a TTS / music / SFX / voice-design task; waits for completion and returns same-origin audio URLs. Optional `enhance_prompt`, `save_to_library`, per-vendor params. |
| `search_audio_library` | Search the local resource library (type / category / keyword) and reuse an existing voice, music bed or effect. |

Typical session commands (skills bundled with the plugin):

```text
/audio:tts      Read this sentence with a warm voice
/audio:music    Generate a 30-second lo-fi background track
/audio:sfx      Create a sci-fi UI cue
/audio:design   Craft a warm retro synth voice
```

## 🔐 Security & data notes

- API keys are stored in the local DSH settings document; requests are proxied by the local host (`/api/dsh-audiogen/*`, loopback-only routes)
- Generation consumes your upstream provider quota; audio content is produced by the upstream model
- History & library persist under `~/.dsh/dsh-audiogen/`
- Prompt enhancement calls the LLM model you choose (default: agent default model) — no extra API key

## 🛠 Development

```bash
pnpm install
pnpm run typecheck
pnpm run build      # outputs lib/ (host + client bundles)
```

## 📄 License

[Apache-2.0](LICENSE)

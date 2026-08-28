# dsh-audiogen

DeepSeek Harness（DSH）AI 音频插件：让 Agent 不只会回答，还能生成语音、音乐与音效。

- 侧边栏新增「AI 音频」模块，与 dsh-imagegen 的「AI 生图」类似。
- 在「设置 → 插件 → AI 音频」中可添加多个音频厂商渠道：
  - OpenAI 兼容 TTS
  - ElevenLabs
  - MiniMax
  - Stability AI（音乐/音效）
  - 自定义 OpenAI 兼容或通用 POST 接口
- Agent 可通过 `generate_audio` 工具生成音频，并在对话工具结果中直接播放 / 下载。
- API 密钥保存在 DSH 宿主侧，浏览器与 Agent 不接触明文密钥。
- 生成历史持久化在 `~/.dsh/dsh-audiogen/`。
- **资源库**：生成的音频可勾选「加入资源库」（或设置中开启自动保存），按类型分目录存放
  （`voice/male|female|custom`、`music`、`sfx`、`tts/<音色键>`），每条资源都带完整溯源
  （渠道、模型与上游 ID、音色 voiceId、提示词、参数快照）。资源库支持搜索、标签、
  重命名、移动分类、批量管理与详情抽屉（可复制参数 / 复用音色）。
- **模型对比**：生成页勾选「模型对比」后选择 2-4 个模型，用相同参数逐个生成，
  结果按模型分组并列展示，便于对比音质/风格。
- Agent 亦可调用 `search_audio_library` 检索本地资源库，复用已有音色/配乐/音效。

## 安装

已发布到 npm：

```bash
dsh plugin --profile web add dsh-audiogen
# 或指定版本
dsh plugin --profile web add dsh-audiogen@0.1.0
```

本地开发安装：

```bash
dsh plugin --profile web add /path/to/dsh-audiogen
```

安装后重启 `dsh web`，侧边栏出现「AI 音频」。打开「设置 → 插件 → AI 音频」，添加一个厂商渠道并填写 API 地址、密钥、模型/音色后即可使用。

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `generate_audio` | 提交 TTS / 音乐 / 音效生成，等待完成后返回同源音频 URL；可选 `save_to_library` 入库。 |
| `search_audio_library` | 检索本地资源库（类型/分类/关键词），返回资源、溯源与音频 URL。 |

示例：

```text
/audiogen 生成一段 30 秒的 Lo-fi 背景音乐
/audio:tts 用温暖的声音朗读这句话
/audio:sfx 生成一声科幻风格的 UI 提示音
```

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run build
```

## 目录

```text
dsh-audiogen/
├── package.json           # dsh.bundle + dsh.client 声明
├── cordis.patch.yml       # 插件行
├── src/
│   ├── index.ts           # 宿主插件
│   ├── protocol.ts        # 共享协议
│   ├── audio-engine.ts    # 多厂商生成引擎
│   ├── audio-presets.ts   # 预置厂商
│   ├── audio-store.ts     # 音频/历史持久化
│   ├── routes.ts          # /api/dsh-audiogen/*
│   ├── agent-audio-tools.ts
│   └── client/            # 浏览器端：侧边栏、设置卡片、面板、工具视图
└── skills/                # 建议的会话技能定义（TTS / music / sfx / design）
```

## 许可证

Apache-2.0

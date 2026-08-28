# dsh-audiogen 项目开发总结

## 项目定位
- 目标：创建一个 DSH 插件，类似 `dsh-imagegen`，可在会话中直接触发生成音频。
- 覆盖能力：
  - 音色设计
  - TTS 文本转语音（可基于设计的音色/音效进行生成）
  - 音乐生成
  - 音效生成
- 插件命名：`dsh-audiogen`
- 仓库：`git@github.com:shimingming520/dsh-audiogen.git`
- 本地路径：`/Users/shimingming/Projects_code/dsh-audiogen`
- 当前状态：已实现可安装的 DSH 插件雏形（宿主 + 浏览器端），包含多厂商音频渠道、设置卡片、侧边栏「AI 音频」面板和 Agent `generate_audio` 工具。

## 实际结构（DSH Bundle 插件）
```text
dsh-audiogen/
├── package.json           # dsh.bundle + dsh.client 声明
├── cordis.patch.yml       # 插件行
├── lib/                   # 预构建 node/client bundle
├── src/
│   ├── index.ts           # 宿主插件
│   ├── protocol.ts        # 共享协议
│   ├── audio-engine.ts    # 多厂商生成引擎
│   ├── audio-presets.ts   # 预置厂商
│   ├── audio-store.ts     # 音频/历史持久化
│   ├── routes.ts          # /api/dsh-audiogen/*
│   ├── agent-audio-tools.ts
│   └── client/            # 浏览器端：侧边栏、设置卡片、面板、工具视图
└── skills/                # 会话技能定义（design / tts / music / sfx）
```

## 会话内触发示例
```text
/audio:design 一个温暖复古的合成器音色
/audio:tts 用上面设计的音色朗读这句话
/audio:music 生成一段 30 秒的 Lo-fi 背景音乐
/audio:sfx 生成一声科幻风格的 UI 提示音
```

也可以提供统一入口：
```text
/audiogen 生成一段赛博朋克风格的音效
```

## 进度
- [x] 初始化插件元数据：`package.json`（dsh.bundle/dsh.client）、`cordis.patch.yml`、`README.md`、Apache-2.0 许可证。
- [x] 实现 skills 定义：design / tts / music / sfx。
- [x] 接入多厂商音频生成后端：OpenAI 兼容 TTS、ElevenLabs、MiniMax、Stability Audio、自定义接口。
- [x] 定义参数规范：文本、模型/音色、语速、时长、采样/输出格式等。
- [x] 支持组合能力：先设计描述，再用 `generate_audio` 生成。
- [x] 已构建 `lib/`，可通过 `dsh plugin add /path/to/dsh-audiogen` 或 tarball 安装。
- [x] 已提交到本地 Git（可继续推送 GitHub）。
- [ ] 真机验证各厂商接口字段；按需补充更多预置厂商。

## 新会话开发提示
- 在新会话中直接说：
  > 继续开发 `/Users/shimingming/Projects_code/dsh-audiogen` 插件，按照 `PROJECT_SUMMARY.md` 推进。
- 工作目录：`/Users/shimingming/Projects_code/dsh-audiogen`

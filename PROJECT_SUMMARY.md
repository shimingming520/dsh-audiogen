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

## 推荐结构
```text
dsh-audiogen/
├── plugin.yaml / plugin.json
├── README.md
├── skills/
│   ├── design        # 音色/音效设计
│   ├── tts           # 文本转语音
│   ├── music         # 音乐生成
│   └── sfx           # 音效生成
└── ...
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

## 待开发事项
1. 初始化插件元数据：`plugin.yaml` / `plugin.json`、`README.md`、许可证。
2. 实现各 skill 的定义、触发词、参数和提示词模板。
3. 接入音频生成后端/API：
   - TTS
   - 音乐生成
   - 音效生成
   - 音色/音效设计
4. 定义参数规范：文本、风格、时长、音色、采样率、输出格式等。
5. 支持组合能力：先设计音色/音效，再基于该音色/音效生成 TTS 或音乐。
6. 本地测试安装：`dsh plugin add /path/to/dsh-audiogen` 或对应开发模式。
7. 提交并推送到 GitHub。

## 新会话开发提示
- 在新会话中直接说：
  > 继续开发 `/Users/shimingming/Projects_code/dsh-audiogen` 插件，按照 `PROJECT_SUMMARY.md` 推进。
- 工作目录：`/Users/shimingming/Projects_code/dsh-audiogen`

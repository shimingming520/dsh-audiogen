# 音乐生成

## 触发
- `/audio:music <描述>`
- 用户说“生成一段音乐 / 配乐 / BGM”

## 参数
- prompt: 必填，风格/情绪/乐器/时长描述
- model: 可选，已配置的音频模型
- duration: 可选，秒数
- format: 可选，mp3 / wav

## 流程
1. 确认已配置支持音乐生成的渠道（如 Stability Audio / 自定义）。
2. 调用 `generate_audio`，mode=music。
3. 将生成的音频 URL 返回给用户。

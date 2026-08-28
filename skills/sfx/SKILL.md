# 音效生成

## 触发
- `/audio:sfx <描述>`
- 用户说“生成一个音效 / 提示音 / 環境音”

## 参数
- prompt: 必填，音效描述
- model: 可选，已配置模型
- duration: 可选，秒数
- format: 可选

## 流程
1. 确认已配置音效生成渠道。
2. 调用 `generate_audio`，mode=sfx。
3. 将音频 URL 返回。

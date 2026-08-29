/**
 * 提示词增强：复用 Agent 当前默认模型（设置「模型」里的 provider/model，
 * 即 agent-default-model 命名空间），宿主端发起一次 LLM 调用把用户 prompt
 * 扩展成更适合生成的任务描述。不新增 API key 配置。
 *
 * 面板「✨ 增强提示词」与 generate_audio 工具的 enhance_prompt 都走这里。
 */

import type { AudioMode } from './protocol.ts'
import { AudioGenError } from './audio-engine.ts'

/** 按生成模式给出增强指令（系统提示）。 */
function instructionsFor(mode: AudioMode): string {
  const common = [
    '你是一个音频提示词增强助手。用户给出一个粗略的音频生成需求，',
    '请将其扩写为一段可直接提交给音频生成模型的中文或英文描述。',
    '只输出增强后的描述本身，不要输出任何解释、前后缀、引号或代码块。',
    '保持用户原始意图，不要改变其核心内容；为最终生成的音频服务。',
    '描述控制在 200-600 字左右。',
  ].join('')
  const perMode: Record<AudioMode, string> = {
    tts: '这是文本转语音（TTS）任务：让文本更适合朗读——口语化、自然、带合适的情感标签（如 (laughs)、(whisper)），避免生僻多音字和超长句，可适当补足上下文使语句完整，但不要改写原意。',
    music: '这是音乐生成任务：扩写音乐风格/情绪/乐器/结构/节奏变化/氛围，使用音频模型熟悉的描述词汇（如 cinematic orchestral、lo-fi、bpm、弦乐进出、旋律动机、前中后段结构），如用户未指定可补充风格建议，但保持原方向。',
    sfx: '这是音效生成任务：扩写声音材质、动作过程、空间感、节奏（先轻后重、清脆短促等）、环境氛围，用具体拟声与材质词，避免抽象概括。',
    voice_design: '这是音色设计任务：扩写人声/音色特征——性别年龄、音域、音质（低沉/清亮/沙哑）、语速、情绪性格、适用场景，用可感知的描述，方便语音模型合成。',
  }
  return common + perMode[mode]
}

export interface PromptEnhanceDeps {
  /** DSH 设置 seam（读 agent-default-model）。 */
  settings: { describe(options?: { redactSecrets?: boolean }): Array<{ ns: unknown; value?: unknown }> }
  /** 宿主 LLM 运行时访问器（延迟读取，调用时才获取）。 */
  llm?: () => unknown
}

/** 读取 Agent 默认模型并调用 LLM 增强，返回增强后的文本。 */
export async function enhancePromptText(deps: PromptEnhanceDeps, prompt: string, mode: AudioMode): Promise<string> {
  const text = prompt.trim()
  if (text === '') throw new AudioGenError('提示词为空，无法增强', 'enhance-empty-prompt')
  const descriptor = (deps.settings.describe({ redactSecrets: true }) ?? []).find(candidate => String(candidate.ns) === 'agent-default-model')
  const value = (descriptor?.value ?? {}) as { provider?: unknown; model?: unknown }
  const provider = typeof value.provider === 'string' && value.provider.trim() !== '' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' && value.model.trim() !== '' ? value.model.trim() : ''
  if (provider === '' || model === '') {
    throw new AudioGenError('未找到 Agent 默认模型（agent-default-model）：请先在「设置 → 模型」中配置默认模型', 'no-default-model')
  }
  const runtime = deps.llm?.() as { stream?: (options: unknown) => AsyncIterable<unknown> } | undefined
  if (runtime === undefined || runtime.stream === undefined) {
    throw new AudioGenError('宿主 LLM 服务不可用（ctx.llm 未注册）', 'llm-unavailable')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), 30_000)
  timer.unref?.()
  let output = ''
  try {
    for await (const chunk of runtime.stream({
      provider,
      model,
      messages: [{ role: 'user', content: text }],
      system: instructionsFor(mode),
      temperature: 0.7,
      maxTokens: 1200,
      signal: controller.signal,
    })) {
      const record = chunk as { type?: string; text?: string; block?: { type?: string; text?: string } }
      if (record.type === 'text-delta' && typeof record.text === 'string') {
        output += record.text
      } else if (record.type === 'block-end' && record.block !== undefined
        && record.block.type === 'text' && typeof record.block.text === 'string') {
        output += record.block.text
      }
    }
  } finally {
    clearTimeout(timer)
  }
  const result = stripFences(output.trim())
  if (result === '') {
    throw new AudioGenError('模型未返回增强内容：请检查「设置 → 模型」的默认模型是否可用（或稍后重试）', 'enhance-empty-result')
  }
  return result
}

/** 去掉模型可能包裹的 ``` 代码围栏。 */
function stripFences(value: string): string {
  if (value === '') return value
  const withoutFence = value.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '')
  return withoutFence.trim()
}

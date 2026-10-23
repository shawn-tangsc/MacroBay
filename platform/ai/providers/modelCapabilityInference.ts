import { lookupModelCapabilityHint } from './modelCapabilityCatalog'
import { normalizeModelCapabilities } from './modelCapabilities'
import type { ModelCapabilities } from './modelProviderTypes'

/**
 * PLAT-62：按真实信息推断模型能力（不再默认 `chat/tools = true`）。
 *
 * 优先级：**显式字段 > 供应商 `type` > 模型 id 模式**。
 * 只写「能确认」的能力：除 `chat` 外全部可选；`tools` 只有显式 true 才标注。
 * AIOnly `/v1/models` 的 type 实测只有：text_model / visual_model / image_generation / speech_model。
 */
export type ModelCapabilityInput = {
  id: string
  /** 供应商返回的 type（AIOnly/Groq 等）。 */
  type?: string
  capabilities?: Partial<ModelCapabilities>
}

const NON_CHAT_FLAGS = ['rerank', 'embedding', 'speech', 'transcription', 'imageGeneration', 'videoGeneration'] as const

export function inferModelCapabilities(model: ModelCapabilityInput): ModelCapabilities {
  const explicit = model.capabilities ?? {}
  const flags = {
    tools: explicit.tools === true,
    vision: explicit.vision === true,
    reasoning: explicit.reasoning === true,
    embedding: explicit.embedding === true,
    imageGeneration: explicit.imageGeneration === true,
    videoGeneration: explicit.videoGeneration === true,
    rerank: explicit.rerank === true,
    // 老数据只有 audio ⇒ 当作语音合成（speech）；转写按显式字段/id 判定。
    speech: explicit.speech === true || explicit.audio === true,
    transcription: explicit.transcription === true,
    ocr: explicit.ocr === true
  }

  applyTypeFlags(flags, model.type, explicit)
  // 内置能力表（供应商普遍不返回能力字段时的主要来源），显式字段已为 true 的不受影响。
  const hint = lookupModelCapabilityHint(model.id)
  for (const [key, value] of Object.entries(hint) as Array<[keyof typeof flags, boolean | undefined]>) {
    if (value === true && explicit[key] !== false) flags[key] = true
  }
  applyIdFlags(flags, model.id, explicit)

  const ocrModel = /ocr/i.test(model.id)
  // OCR 模型是「输入限定为一张图」的 VLM：它能被 chat/completions 调起，所以**不是**非聊天族。
  // 同时置 `ocr`（专长标记，供筛选/提示）与 `vision`（输入是图片），chat 交给下面的常规规则。
  if (ocrModel) {
    setFlag(flags, explicit, 'ocr')
    setFlag(flags, explicit, 'vision')
  }
  // `visual_model` 只是个粗类型：id 里看不出是视频还是视觉时**不加标签**（也不当聊天模型）。
  const unknownVisual = isVisualModel(model.type) && !flags.vision && !flags.videoGeneration
  const nonChat = NON_CHAT_FLAGS.some((key) => flags[key])
  const chat = typeof explicit.chat === 'boolean' ? explicit.chat : !nonChat && !unknownVisual
  const capabilities: ModelCapabilities = { chat }
  for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
    if (flags[key]) capabilities[key] = true
  }
  if (explicit.agentRuntimes) capabilities.agentRuntimes = explicit.agentRuntimes
  return capabilities
}

function isVisualModel(type: string | undefined): boolean {
  return (type?.trim().toLowerCase() ?? '') === 'visual_model'
}

function applyTypeFlags(
  flags: Record<string, boolean>,
  type: string | undefined,
  explicit: Partial<ModelCapabilities>
): void {
  const normalized = type?.trim().toLowerCase() ?? ''
  if (!normalized) return
  if (normalized === 'image_generation') setFlag(flags, explicit, 'imageGeneration')
  else if (normalized === 'speech_model' || normalized === 'tts' || normalized === 'audio') {
    setFlag(flags, explicit, 'speech')
  } else if (normalized === 'transcription' || normalized === 'asr') {
    setFlag(flags, explicit, 'transcription')
  } else if (normalized === 'ocr') {
    setFlag(flags, explicit, 'ocr')
    setFlag(flags, explicit, 'vision')
  } else if (normalized === 'embedding') setFlag(flags, explicit, 'embedding')
  else if (normalized === 'rerank' || normalized === 'reranker') setFlag(flags, explicit, 'rerank')
  else if (normalized === 'video') setFlag(flags, explicit, 'videoGeneration')
  // visual_model / text_model 交给 id 模式细分（visual 的未知情况由调用方判空）。
}

function applyIdFlags(flags: Record<string, boolean>, id: string, explicit: Partial<ModelCapabilities>): void {
  const normalized = id.trim().toLowerCase()
  if (!normalized) return
  if (/rerank/.test(normalized)) setFlag(flags, explicit, 'rerank')
  else if (/embed|bge|gte/.test(normalized)) setFlag(flags, explicit, 'embedding')
  if (/vl|vision|-v-/.test(normalized)) setFlag(flags, explicit, 'vision')
  if (/r1|reasoning|think/.test(normalized)) setFlag(flags, explicit, 'reasoning')
  // 语音族：**先判转写**（sensevoice 的 id 里也含 voice），再判合成。
  const transcriptionLike = /whisper|asr|sensevoice|transcri|diariz|gsr/.test(normalized)
  if (transcriptionLike) setFlag(flags, explicit, 'transcription')
  if (!transcriptionLike && /tts|ttsd|cosyvoice|speech|audio|voice/.test(normalized)) {
    setFlag(flags, explicit, 'speech')
  }
  // seedream 是**生图**（不是视频），seedance 才是视频；两者同属"seed 系列"，别再混。
  if (/flux|dall|image|t2i|kolors|diffusion|semif|kev|seedream|seed3d/.test(normalized)) setFlag(flags, explicit, 'imageGeneration')
  if (/t2v|i2v|video|seedance|hailuo|kling|runway|pika|director|wan/.test(normalized)) setFlag(flags, explicit, 'videoGeneration')
  // 视频模型族即使 id 里带 t2i，也只归视频（不叠图片）；wan-image 这类纯图片 id 保留图片。
  // 注意 seedream 不在这里：它是生图模型，混进来会被清掉图片位、又因不再命中视频族而变成聊天模型。
  if (/seedance|hailuo|kling|runway|pika/.test(normalized) && explicit.imageGeneration !== true) {
    flags.imageGeneration = false
  }
  if (/wan/.test(normalized) && /t2v|i2v|video/.test(normalized) && explicit.imageGeneration !== true) {
    flags.imageGeneration = false
  }
  if (/wan/.test(normalized) && /image|t2i/.test(normalized) && !/t2v|i2v|video/.test(normalized)) {
    flags.videoGeneration = false
  }
}

/** 显式 false 也算「明确信息」，推断不得覆盖。 */
function setFlag(
  flags: Record<string, boolean>,
  explicit: Partial<ModelCapabilities>,
  key: keyof ModelCapabilities
): void {
  if (explicit[key] === false) return
  flags[key] = true
}

/** 便于调用方把持久化能力也走同一套「只保留明确字段」的归一化。 */
export function inferNormalizedCapabilities(model: ModelCapabilityInput): ModelCapabilities {
  return normalizeModelCapabilities(inferModelCapabilities(model))
}


/** PLAT-62：探测最后一道闸——非聊天能力或已知非聊天模型族，一律不探测。 */
const NON_CHAT_MODEL_ID_PATTERN =
  /bge|embed|rerank|asr|tts|ttsd|voice|sensevoice|cosyvoice|diarize|gsr|audio|z-image|kolors|diffusion|seedream|seedance|flux|t2i|image|wan|i2v|t2v|video|hailuo|kling|runway|pika|semif|kev/i

/**
 * PLAT-62：能力单一事实来源。
 * 用户显式编辑过 ⇒ 用 stored；否则按 id/type 重算（不信任 stored 的 chat=true）。
 */
export function resolveModelCapabilities(model: {
  id: string
  capabilities: ModelCapabilities
}): ModelCapabilities {
  if (model.capabilities.capabilitiesEdited === true) return model.capabilities
  const { chat: _ignoredChat, ...rest } = model.capabilities
  // 已知非聊天 id：忽略 stored 的非聊天标记，避免 seedream 同时显示图片/视频。
  const capabilities = isNonChatModelId(model.id)
    ? (rest.agentRuntimes ? { agentRuntimes: rest.agentRuntimes } : {})
    : rest
  return inferModelCapabilities({ id: model.id, capabilities })
}

export function isNonChatModelId(id: string): boolean {
  return NON_CHAT_MODEL_ID_PATTERN.test(id)
}

export function isChatProbeCandidate(model: {
  id: string
  capabilities: ModelCapabilities
}): boolean {
  const capabilities = resolveModelCapabilities(model)
  if (capabilities.chat !== true) return false
  if (
    capabilities.rerank ||
    capabilities.embedding ||
    capabilities.speech ||
    capabilities.transcription ||
    capabilities.imageGeneration ||
    capabilities.videoGeneration
  ) {
    return false
  }
  return !isNonChatModelId(model.id)
}

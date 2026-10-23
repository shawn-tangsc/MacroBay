/**
 * PLAT-73：内置模型能力表（按模型族匹配）。
 *
 * 为什么需要：多数供应商的 `/v1/models` 只返回 `{ id, object, created, owned_by }`
 *（实测硅基流动就是如此），能力信息拿不到；只靠 id 正则会出现"别的客户端有图标、我们没有"。
 *
 * 匹配顺序：供应商显式字段 > **本表** > id 正则兜底。
 * 规则只写确认过的族；新增族时在这里加一行即可（数据文件，不放逻辑）。
 */
export type ModelCapabilityHint = {
  tools?: boolean
  vision?: boolean
  reasoning?: boolean
  embedding?: boolean
  imageGeneration?: boolean
  videoGeneration?: boolean
  rerank?: boolean
  speech?: boolean
  transcription?: boolean
}

type CatalogRule = { pattern: RegExp; hint: ModelCapabilityHint }

const RULES: CatalogRule[] = [
  // 非聊天族放最前：它们更具体，不能被下面的"工具"族规则抢先匹配
  // （否则 Qwen3-Embedding / Reranker 会被当成聊天模型打上工具图标）。
  { pattern: /rerank/i, hint: { rerank: true } },
  { pattern: /embed|bge|gte/i, hint: { embedding: true } },
  { pattern: /flux|seedream|kolors|dall-?e|stable-diffusion|sdxl|imagen|z-image/i, hint: { imageGeneration: true } },
  { pattern: /wan2|[-_/]t2v|t2v-|i2v|seedance|kling|hailuo|veo|runway|pika/i, hint: { videoGeneration: true } },
  // 语音族拆成转写（ASR）与合成（TTS）：转写更具体，必须排在合成前面
  //（SenseVoice / whisper 的 id 里也可能含 voice/speech，先匹配转写才不会误判成 TTS）。
  { pattern: /whisper|asr|sensevoice|transcri|diariz|gsr/i, hint: { transcription: true } },
  { pattern: /tts|cosyvoice|speech|[-_/]audio|voice/i, hint: { speech: true } },
  // 推理族（先于通用聊天族）
  { pattern: /deepseek[-_.]?r1|deepseek[-_.]?reasoner|[-_/]reasoner\b/i, hint: { reasoning: true, tools: true } },
  { pattern: /(^|[-_/])o[134](-|$)|qwq|thinking/i, hint: { reasoning: true, tools: true } },
  // 视觉族
  { pattern: /qwen[\d.]*[-_.]?vl|qwen.*vl\b|vision|[-_/]vl[-_/]|llava|internvl|glm-4(\.\d)?v\b/i, hint: { vision: true, tools: true } },
  // 对话主力族（默认支持工具调用）
  { pattern: /deepseek[-_.]?v[34]|deepseek[-_.]?chat/i, hint: { tools: true } },
  { pattern: /qwen/i, hint: { tools: true } },
  { pattern: /glm-[\d.]|kimi|moonshot|minimax[-_.]?m|mimo|doubao[-_.]?seed(?!ream)|grok|mistral|llama|gemma|command-r|yi-|ernie/i, hint: { tools: true } },
  { pattern: /gpt-|claude-|o[134]-/i, hint: { tools: true } }
]

export function lookupModelCapabilityHint(modelId: string): ModelCapabilityHint {
  const id = modelId.trim()
  if (!id) return {}
  for (const rule of RULES) {
    if (rule.pattern.test(id)) return rule.hint
  }
  return {}
}

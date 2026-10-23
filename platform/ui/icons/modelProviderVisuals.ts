export type VisualTone = {
  background: string
  foreground: string
  border?: string
}

export type VisualIdentity = {
  key: string
  label: string
  shortLabel: string
  tone: VisualTone
  iconSet?: 'provider' | 'model'
  iconKey?: string
  isFallback?: boolean
}

type VisualSeed = {
  label: string
  shortLabel?: string
  tone: VisualTone
  iconSet?: 'provider' | 'model'
  iconKey?: string
  isFallback?: boolean
}

const providerVisuals: Record<string, VisualSeed> = {
  '302ai': providerSeed('302.AI', '302', '#7c3aed', '#ffffff'),
  'ai-only': providerSeed('AiOnly', 'AI', '#eaffff', '#00a8c7', '#c9f3f7'),
  aihubmix: providerSeed('AiHubMix', 'AH', '#2563eb', '#ffffff'),
  alayanew: providerSeed('Alaya NeW', 'A', '#fff7ed', '#ea580c', '#fed7aa'),
  anthropic: providerSeed('Anthropic', 'A', '#e47657', '#ffffff'),
  'aws-bedrock': providerSeed('AWS Bedrock', 'AWS', '#232f3e', '#ffffff'),
  azureai: providerSeed('Azure OpenAI', 'AZ', '#19a7f2', '#ffffff'),
  baichuan: providerSeed('Baichuan', '百', '#f3f4f6', '#111827', '#e5e7eb'),
  'baidu-cloud': providerSeed('Baidu Cloud', '百', '#ffffff', '#2563eb', '#dbeafe'),
  bailian: providerSeed('Bailian', '百', '#e7f4ff', '#2478f2', '#cfe8ff'),
  burncloud: providerSeed('BurnCloud', 'B', '#fff3e1', '#ff7a1a', '#ffd9a8'),
  cephalon: providerSeed('Cephalon', 'C', '#111111', '#ffffff'),
  cerebras: providerSeed('Cerebras', 'C', '#111827', '#ffffff'),
  claude: modelSeed('Claude', '✹', '#e47657', '#ffffff'),
  copilot: providerSeed('GitHub Copilot', 'GH', '#111827', '#ffffff', undefined, 'github-copilot'),
  dashscope: providerSeed('DashScope', '通', '#e7f4ff', '#2478f2', '#cfe8ff'),
  deepseek: providerSeed('DeepSeek', 'DS', '#556cff', '#ffffff'),
  dmxapi: providerSeed('DMXAPI', 'DMX', '#f0f9ff', '#0284c7', '#ccecff'),
  doubao: providerSeed('Doubao', '豆', '#eef2ff', '#4f46e5', '#dfe5ff'),
  fireworks: providerSeed('Fireworks', 'FW', '#fff1e6', '#f97316', '#ffd9bd'),
  gemini: modelSeed('Gemini', 'G', '#ffffff', '#4285f4', '#e3e7ef'),
  github: providerSeed('GitHub', 'GH', '#111827', '#ffffff'),
  glm: modelSeed('GLM', 'GLM', '#101827', '#c8f36a'),
  google: providerSeed('Google', 'G', '#ffffff', '#4285f4', '#e3e7ef'),
  gpustack: providerSeed('GPUStack', 'GPU', '#f1f5f9', '#334155', '#dbe2ea'),
  grok: providerSeed('Grok', 'G', '#111111', '#ffffff'),
  groq: providerSeed('Groq', 'GQ', '#fff7ed', '#ea580c', '#fed7aa'),
  huggingface: providerSeed('Hugging Face', 'HF', '#fff7cc', '#b45309', '#fde68a'),
  hunyuan: providerSeed('Hunyuan', '混', '#e0f2fe', '#0369a1', '#bae6fd'),
  hyperbolic: providerSeed('Hyperbolic', 'H', '#f5f3ff', '#7c3aed', '#ddd6fe'),
  infini: providerSeed('Infini', 'I', '#ecfeff', '#0891b2', '#cffafe'),
  jina: providerSeed('Jina', 'J', '#fff7ed', '#f97316', '#ffd9bd'),
  kimi: modelSeed('Kimi', 'K', '#f0f7ff', '#2680eb', '#d5eaff'),
  lanyun: providerSeed('Lanyun', '蓝', '#eff6ff', '#2563eb', '#bfdbfe'),
  lmstudio: providerSeed('LM Studio', 'LM', '#eef2ff', '#6366f1', '#c7d2fe'),
  longcat: providerSeed('LongCat', 'LC', '#111827', '#ffffff'),
  minimax: providerSeed('MiniMax', 'M', '#f3e8ff', '#8b5cf6', '#e5d3ff'),
  'minimax-global': providerSeed('MiniMax', 'M', '#f3e8ff', '#8b5cf6', '#e5d3ff', 'minimax'),
  mistral: providerSeed('Mistral', 'M', '#fff7ed', '#f97316', '#fed7aa'),
  mimo: providerSeed('Xiaomi MiMo', 'MI', '#fff7ed', '#ea580c', '#fed7aa', 'xiaoyi'),
  modelscope: providerSeed('ModelScope', 'MS', '#eef2ff', '#4f46e5', '#c7d2fe'),
  moonshot: providerSeed('Moonshot', 'M', '#f0f7ff', '#2680eb', '#d5eaff'),
  newapi: providerSeed('New API', 'N', '#fdf2f8', '#db2777', '#fbcfe8'),
  nvidia: providerSeed('NVIDIA', 'NV', '#ecfccb', '#65a30d', '#d9f99d'),
  ocoolai: providerSeed('ocoolAI', 'O', '#111111', '#ffffff'),
  ollama: providerSeed('Ollama', 'O', '#ffffff', '#111827', '#e5e7eb'),
  openai: providerSeed('OpenAI', 'OA', '#101010', '#ffffff'),
  openrouter: providerSeed('OpenRouter', 'OR', '#111827', '#ffffff'),
  ovms: providerSeed('OpenVINO Model Server', 'OV', '#e0f2fe', '#0369a1', '#bae6fd', 'intel'),
  perplexity: providerSeed('Perplexity', 'P', '#e0f7fa', '#008ea3', '#b2ebf2'),
  ph8: providerSeed('PH8', 'PH', '#ecfdf5', '#059669', '#bbf7d0'),
  poe: providerSeed('Poe', 'P', '#f4f4f5', '#18181b', '#e4e4e7'),
  ppio: providerSeed('PPIO', 'P', '#eaf4ff', '#1d7df2', '#cfe6ff'),
  qiniu: providerSeed('Qiniu', '七', '#e0f2fe', '#0284c7', '#bae6fd'),
  qwen: modelSeed('Qwen', 'Q', '#6c63ff', '#ffffff'),
  silicon: providerSeed('Silicon', '硅', '#eef2ff', '#5b5ce2', '#dfe5ff'),
  sophnet: providerSeed('SophNet', 'S', '#f5f3ff', '#7c3aed', '#ddd6fe'),
  step: providerSeed('Step', 'S', '#f3f4f6', '#111827', '#e5e7eb'),
  'tencent-cloud-ti': providerSeed('Tencent Cloud TI', '腾', '#e0f2fe', '#0284c7', '#bae6fd'),
  // TokenHub 是腾讯云接替旧平台的入口，**复用腾讯云 logo**（同一品牌，`iconKey` 指向已有资源）。
  tokenhub: providerSeed('TokenHub', '腾', '#e0f2fe', '#0284c7', '#bae6fd', 'tencent-cloud-ti'),
  together: providerSeed('Together', 'T', '#f3f4f6', '#111827', '#e5e7eb'),
  tokenflux: providerSeed('TokenFlux', 'TF', '#effafa', '#0f8d91', '#d4f0ef'),
  tokenrhythm: providerSeed('TokenRhythm', 'TR', '#f5f3ff', '#6d28d9', '#ddd6fe'),
  vertexai: providerSeed('Vertex AI', 'V', '#ffffff', '#4285f4', '#e3e7ef'),
  vercel: providerSeed('Vercel', 'V', '#111827', '#ffffff'),
  voyage: providerSeed('Voyage', 'V', '#ecfeff', '#0891b2', '#cffafe'),
  xirang: providerSeed('Xirang', '熙', '#e0f2fe', '#0369a1', '#bae6fd'),
  'zero-one': providerSeed('01.AI', '01', '#f8fafc', '#0f172a', '#e2e8f0'),
  'z-ai': providerSeed('Z.ai', 'Z', '#f4f4f5', '#18181b', '#e4e4e7'),
  zhipu: providerSeed('ZhiPu', 'Z', '#e8f0ff', '#2b63f1', '#d4e1ff')
}

const providerAliases: Record<string, string> = {
  '302.ai': '302ai',
  '302-ai': '302ai',
  aionly: 'ai-only',
  aiionly: 'ai-only',
  alayanew: 'alayanew',
  'azure-openai': 'azureai',
  copilot: 'copilot',
  dashscope: 'bailian',
  gateway: 'vercel',
  gemini: 'google',
  huggingface: 'huggingface',
  lanyun: 'lanyun',
  minimaxglobal: 'minimax-global',
  moonshotai: 'moonshot',
  'new-api': 'newapi',
  ph8: 'ph8',
  stepfun: 'step',
  siliconflow: 'silicon',
  voyageai: 'voyage',
  yi: 'zero-one',
  zai: 'z-ai',
  'z-ai': 'z-ai'
}

const modelVisualPatterns: ReadonlyArray<[RegExp, string]> = [
  [/gpt-5\.2-pro/i, 'gpt-5-2-pro'],
  [/gpt-5\.2/i, 'gpt-5-2'],
  [/gpt-5\.1-chat/i, 'gpt-5-1-chat'],
  [/gpt-5\.1/i, 'gpt-5-1'],
  [/gpt-5-mini/i, 'gpt-5-mini'],
  [/gpt-5-chat/i, 'gpt-5-chat'],
  [/gpt-5/i, 'gpt-5'],
  [/gpt-image/i, 'gpt-image-1'],
  [/(claude)/i, 'claude'],
  [/(anthropic)/i, 'anthropic'],
  [/(deepseek)/i, 'deepseek'],
  [/(qwen|qwq|qvq|wan)/i, 'qwen'],
  [/(gpt-|gpt_|chatgpt|^o1|^o3|^o4|text-embedding|whisper|dall-e)/i, 'openai'],
  [/gemma/i, 'gemma'],
  [/(gemini|imagen|veo)/i, 'gemini'],
  [/(glm|chatglm|zhipu)/i, 'glm'],
  [/(kimi|moonshot)/i, 'kimi'],
  [/(minimax|abab)/i, 'minimax'],
  [/doubao|seedream|seedance/i, 'doubao'],
  [/hunyuan/i, 'hunyuan'],
  [/grok/i, 'grok'],
  [/mimo/i, 'mimo'],
  [/llama|meta-/i, 'meta'],
  [/mistral|mixtral|ministral/i, 'mistral'],
  [/jina/i, 'jina'],
  [/sonar|pplx/i, 'perplexity'],
  [/voyage/i, 'voyage'],
  [/ernie|wenxin/i, 'baidu-cloud']
]

const modelIconKeys = new Set([
  'aya',
  'claude',
  'codegeex',
  'doubao',
  'gemini',
  'gemma',
  'glm',
  'gpt-5',
  'gpt-5-1',
  'gpt-5-1-chat',
  'gpt-5-1-codex',
  'gpt-5-1-codex-mini',
  'gpt-5-2',
  'gpt-5-2-pro',
  'gpt-5-chat',
  'gpt-5-codex',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-image-1',
  'gpt-image-1-5',
  'gpt-oss-120b',
  'gpt-oss-20b',
  'grok',
  'hailuo',
  'hunyuan',
  'ibm',
  'kimi',
  'ling',
  'mimo',
  'nova',
  'palm',
  'qwen',
  'sensenova',
  'sora',
  'trinity'
])

function providerSeed(label: string, shortLabel: string, background: string, foreground: string, border?: string, iconKey?: string): VisualSeed {
  return {
    label,
    shortLabel,
    tone: { background, foreground, border },
    iconSet: 'provider',
    iconKey
  }
}

function modelSeed(label: string, shortLabel: string, background: string, foreground: string, border?: string, iconKey?: string): VisualSeed {
  return {
    label,
    shortLabel,
    tone: { background, foreground, border },
    iconSet: 'model',
    iconKey
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-')
}

function createShortLabel(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '?'
  const words = trimmed.split(/[\s._/-]+/).filter(Boolean)
  if (words.length >= 2) return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('')
  return trimmed.slice(0, Math.min(trimmed.length, 2)).toUpperCase()
}

function createFallbackTone(key: string): VisualTone {
  const palette = [
    ['#f1f5f9', '#475569', '#dbe2ea'],
    ['#e8f7ff', '#0f78a8', '#ccecff'],
    ['#f4ecff', '#7c3aed', '#e4d6ff'],
    ['#eaf8ef', '#15803d', '#cfeeda'],
    ['#fff1e6', '#c2410c', '#ffd9bd']
  ] as const
  const index = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length
  const [background, foreground, border] = palette[index]
  return { background, foreground, border }
}

function toIdentity(key: string, seed: VisualSeed): VisualIdentity {
  return {
    key,
    label: seed.label,
    shortLabel: seed.shortLabel ?? createShortLabel(seed.label),
    tone: seed.tone,
    iconSet: seed.iconSet,
    iconKey: seed.iconKey ?? key,
    isFallback: seed.isFallback
  }
}

export function resolveProviderVisual(providerId: string, providerName?: string): VisualIdentity {
  const normalizedId = normalizeKey(providerId)
  const aliasKey = providerAliases[normalizedId] ?? normalizedId
  const seed = providerVisuals[aliasKey]
  if (seed) return toIdentity(aliasKey, seed)

  const label = providerName?.trim() || providerId
  return toIdentity(normalizedId, {
    label,
    shortLabel: createShortLabel(label),
    tone: createFallbackTone(normalizedId),
    isFallback: true
  })
}

export function resolveModelVisual(
  modelId: string,
  modelName: string | undefined,
  providerId: string,
  providerName?: string
): VisualIdentity {
  const target = `${modelId} ${modelName ?? ''}`
  for (const [pattern, visualKey] of modelVisualPatterns) {
    if (pattern.test(target)) {
      const visual = resolveProviderVisual(visualKey)
      if (modelIconKeys.has(visualKey)) return { ...visual, key: visualKey, iconSet: 'model', iconKey: visualKey }
      return visual
    }
  }
  return resolveProviderVisual(providerId, providerName)
}

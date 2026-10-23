import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from '../providerPresets'
import { buildModelListUrl } from './remoteModelList'
import { resolveModelListShape } from './modelListShapes'

/**
 * 「其它厂商零变化」的 URL 护栏：44 家预设的主列表地址逐字固定。
 *
 * 其中 aihubmix 是**有意改动**（`/v1/models` → 富列表 `/api/v1/models`，见 modelListShapes），
 * 其余 54 条与改动前完全一致；`listPath` 缺省时仍走 `buildModelsUrl(baseUrl)`。
 */
const EXPECTED_MODEL_LIST_URLS: Readonly<Record<string, string>> = {
  silicon: 'https://api.siliconflow.cn/v1/models',
  tokenrhythm: 'https://tokenrhythm.studio/v1/models',
  aihubmix: 'https://aihubmix.com/api/v1/models',
  ocoolai: 'https://one.ocoolai.com/v1/models',
  aionly: 'https://llm.aiionly.com/v1/models',
  burncloud: 'https://ai.burncloud.com/v1/models',
  cephalon: 'https://cephalon.cloud/user-center/v1/model/models',
  lanyun: 'https://maas-api.lanyun.net/v1/models',
  ph8: 'https://ph8.co/v1/models',
  sophnet: 'https://www.sophnet.com/api/open-apis/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  poe: 'https://api.poe.com/v1/models',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/models',
  deepseek: 'https://api.deepseek.com/v1/models',
  ppio: 'https://api.ppio.com/openai/v1/models',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  minimax: 'https://api.minimaxi.com/v1/models',
  moonshot: 'https://api.moonshot.cn/v1/models',
  qiniu: 'https://api.qnaigc.com/v1/models',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/models',
  baichuan: 'https://api.baichuan-ai.com/v1/models',
  stepfun: 'https://api.stepfun.com/v1/models',
  modelscope: 'https://api-inference.modelscope.cn/v1/models',
  tokenhub: 'https://tokenhub.tencentmaas.com/v1/models',
  longcat: 'https://api.longcat.chat/openai/models',
  mimo: 'https://api.xiaomimimo.com/v1/models',
  zai: 'https://api.z.ai/api/paas/v4/models',
  'minimax-global': 'https://api.minimax.io/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  openai: 'https://api.openai.com/v1/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  groq: 'https://api.groq.com/openai/v1/models',
  together: 'https://api.together.xyz/v1/models',
  fireworks: 'https://api.fireworks.ai/inference/v1/models',
  nvidia: 'https://integrate.api.nvidia.com/v1/models',
  grok: 'https://api.x.ai/v1/models',
  hyperbolic: 'https://api.hyperbolic.xyz/v1/models',
  mistral: 'https://api.mistral.ai/v1/models',
  cerebras: 'https://api.cerebras.ai/v1/models',
  ovms: 'http://localhost:8000/v3/models',
  ollama: 'http://localhost:11434/v1/models',
  lmstudio: 'http://localhost:1234/v1/models',
  // 未配置主地址的本地网关：保持旧的相对路径推导（请求层会先报 invalid_base_url）。
  gpustack: '/v1/models',
  'new-api': 'http://localhost:3000/v1/models'
}

describe('preset model list URLs', () => {
  it('pins the same list URL for every preset except aihubmix', () => {
    const presets = createSystemProviderPresets()
    expect(presets).toHaveLength(44)
    expect(Object.keys(EXPECTED_MODEL_LIST_URLS)).toHaveLength(44)

    for (const preset of presets) {
      const expected = EXPECTED_MODEL_LIST_URLS[preset.id]
      expect(expected, `${preset.id} 未登记期望 URL`).toBeDefined()
      expect(buildModelListUrl(preset, resolveModelListShape(preset)), preset.id).toBe(expected)
    }
  })

  it('keeps gemini on the native envelope path', () => {
    const gemini = createSystemProviderPresets().find((preset) => preset.id === 'gemini')
    expect(gemini).toBeDefined()
    expect(buildModelListUrl(gemini!, resolveModelListShape(gemini!))).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models'
    )
  })
})

import { describe, expect, it } from 'vitest'

import type {
  ModelDefinition,
  ModelPricing,
  SafeModelProvider
} from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../../i18n/platformText'
import {
  MODEL_PICKER_CATEGORIES,
  buildModelPickerOptions,
  emptyModelPickerFilters,
  filterModelPickerGroups,
  isFreePricedModel,
  isMessagesCapableModel,
  matchesModelPickerQuery,
  matchesModelPickerOption,
  resolveModelPickerEmptyState,
  resolveModelPickerSelection,
  type ModelPickerCandidate,
  type ModelPickerConstraints
} from './modelPickerOptions'

/**
 * 标准化模型选择器的数据层契约：
 *  - 约束（协议 / 能力 / 已下线 / chip）在数据层生效，UI 只渲染；
 *  - 搜索是模糊匹配（`dsv3` ⇒ `deepseek-ai/DeepSeek-V3`）；
 *  - 同名模型不去重，`value` 恒为 `providerId:modelId`。
 */
const labels = platformText['en-US'].models

/** 智能体侧约束（与三个调用点一致）。 */
const AGENT_CONSTRAINTS = {
  requireCapabilities: ['chat'],
  protocols: ['messages'],
  showProtocolFilter: true
} as const
const zhLabels = platformText['zh-CN'].models

function provider(
  id: string,
  name: string,
  protocol: SafeModelProvider['endpoints'][number]['protocol'],
  models: ModelDefinition[]
): SafeModelProvider {
  return {
    id,
    name,
    endpoints: [{ protocol, baseUrl: `https://${id}.example.test` }],
    imageEndpoints: { generation: `https://${id}.example.test/images` },
    enabled: true,
    baseUrl: `https://${id}.example.test`,
    hasApiKey: true,
    apiKeyPreview: 'sk-**********test',
    isSystem: false,
    models
  }
}

function model(
  id: string,
  name: string,
  capabilities: ModelDefinition['capabilities'],
  extra: Partial<ModelDefinition> = {}
): ModelDefinition {
  return { id, name, capabilities, ...extra }
}

const pricing = (promptPerMillion: number, completionPerMillion: number, hasDiscount = false): ModelPricing => ({
  currency: 'USD',
  promptPerMillion,
  completionPerMillion,
  hasDiscount
})

/** 5 个可选模型（第 6 个已下线）+ 覆盖能力/协议/价格。 */
const alpha = provider('alpha', 'Alpha Cloud', 'chat-completions', [
  model('alpha-a1', 'Alpha Chat', { chat: true, tools: true }, { pricing: pricing(0, 0) }),
  model('alpha-a2', 'Alpha Vision', { chat: true, vision: true }, { pricing: pricing(2, 4) })
])
const beta = provider('beta', 'Beta Lab', 'messages', [
  model('beta-b1', 'Beta Reasoner', { chat: true, reasoning: true }, {
    chatProtocol: 'messages',
    pricing: pricing(1, 1)
  }),
  model('beta-b2', 'Beta Retired', { chat: true }, {
    chatProtocol: 'messages',
    probeReason: 'model_retired'
  })
])
const gamma = provider('gamma', 'Gamma Media', 'gemini', [
  model('gamma-g1', 'Gamma Video', { chat: false, videoGeneration: true }, { chatProtocol: 'gemini' })
])
const delta = provider('delta', 'Delta Images', 'responses', [
  model('delta-d1', 'Delta Image', { chat: false, imageGeneration: true }, {
    chatProtocol: 'responses',
    pricing: pricing(0, 2, true)
  })
])

const providers = [alpha, beta, gamma, delta]
const candidates: ModelPickerCandidate[] = [
  { providerId: 'alpha', model: alpha.models[0] },
  { providerId: 'alpha', model: alpha.models[1] },
  { providerId: 'beta', model: beta.models[0] },
  { providerId: 'beta', model: beta.models[1] },
  { providerId: 'gamma', model: gamma.models[0] },
  { providerId: 'delta', model: delta.models[0] }
]

function ids(constraints: ModelPickerConstraints): string[] {
  return buildModelPickerOptions(candidates, providers, constraints, labels).options.map((option) => option.value)
}

describe('buildModelPickerOptions constraints matrix', () => {
  it('keeps every available model for the assistant picker (retired excluded)', () => {
    expect(ids({ requireCapabilities: ['chat'] })).toEqual([
      'alpha:alpha-a1',
      'alpha:alpha-a2',
      'beta:beta-b1'
    ])
  })

  it('narrows the agent picker to messages-capable chat models', () => {
    expect(ids({ requireCapabilities: ['chat'], protocols: ['messages'], showProtocolFilter: true }))
      .toEqual(['beta:beta-b1'])
  })

  it('narrows the default agent model the same way', () => {
    expect(ids({ requireCapabilities: ['chat'], protocols: ['messages'] })).toEqual(['beta:beta-b1'])
  })

  it('narrows the image picker to imageGeneration models', () => {
    expect(ids({ requireCapabilities: ['imageGeneration'], showProtocolFilter: false }))
      .toEqual(['delta:delta-d1'])
  })

  it('rejects chat-only models from the image picker and image-only models from text pickers', () => {
    expect(ids({ requireCapabilities: ['imageGeneration'] })).not.toContain('alpha:alpha-a1')
    expect(ids({ requireCapabilities: ['chat'] })).not.toContain('delta:delta-d1')
    expect(ids({ requireCapabilities: ['chat'] })).not.toContain('gamma:gamma-g1')
  })

  it('drops retired models everywhere (count 0)', () => {
    const options = buildModelPickerOptions(candidates, providers, { protocols: ['messages'] }, labels)
    expect(options.options.some((option) => option.value === 'beta:beta-b2')).toBe(false)
    expect(options.options.map((option) => option.value)).toEqual(['beta:beta-b1'])
  })

  it('keeps the same model name from two providers as two options with different values', () => {
    const duplicated = [
      provider('one', 'One', 'chat-completions', [model('same', 'Shared Name', { chat: true })]),
      provider('two', 'Two', 'chat-completions', [model('same', 'Shared Name', { chat: true })])
    ]
    const options = buildModelPickerOptions(
      [
        { providerId: 'one', model: duplicated[0].models[0] },
        { providerId: 'two', model: duplicated[1].models[0] }
      ],
      duplicated,
      {},
      labels
    )
    expect(options.options.map((option) => option.value)).toEqual(['one:same', 'two:same'])
    expect(options.groups).toHaveLength(2)
  })

  it('exposes six category chips by default and only the declared ones when narrowed', () => {
    expect(buildModelPickerOptions(candidates, providers, {}, labels).categories.map((chip) => chip.key))
      .toEqual([...MODEL_PICKER_CATEGORIES])
    const narrowed = buildModelPickerOptions(candidates, providers, { categories: ['deal'] }, labels)
    expect(narrowed.categories.map((chip) => chip.key)).toEqual(['deal'])
    expect(narrowed.categories[0].count).toBe(2)
  })

  it('hides the protocol filter row and the footer when the call site says so', () => {
    const options = buildModelPickerOptions(candidates, providers, {
      showProtocolFilter: false,
      footer: false
    }, labels)
    expect(options.showProtocolFilter).toBe(false)
    expect(options.protocols).toEqual([])
    expect(options.footer).toBeNull()
    expect(buildModelPickerOptions(candidates, providers, {}, labels).footer).toEqual({})
  })

  it('groups by provider display name and sorts models inside a group by model name', () => {
    const options = buildModelPickerOptions(candidates, providers, {}, zhLabels)
    expect(options.groups[0]).toMatchObject({ providerId: 'alpha' })
    expect(options.groups[0].options.map((option) => option.modelName)).toEqual(['Alpha Chat', 'Alpha Vision'])
    expect(options.groups.map((group) => group.providerName)).toContain(zhLabels.providerNames.alpha ?? 'Alpha Cloud')
  })
})

describe('model picker search', () => {
  it('matches a separated model id from a compact keyword', () => {
    expect(matchesModelPickerQuery('deepseek-ai/deepseek-v3 siliconflow', 'dsv3')).toBe(true)
    expect(matchesModelPickerQuery('deepseek-ai/deepseek-v3 siliconflow', 'DEEPSEEK')).toBe(true)
    expect(matchesModelPickerQuery('deepseek v3', 'dsv3')).toBe(true)
    expect(matchesModelPickerQuery('deepseek v3', 'gpt5')).toBe(false)
  })

  it('ignores separator differences', () => {
    expect(matchesModelPickerQuery('deepseek-v3', 'deepseek v3')).toBe(true)
    expect(matchesModelPickerQuery('qwen 2.5 7b', 'qwen2.5')).toBe(true)
  })

  it('matches provider names so every model of that provider is returned', () => {
    const options = buildModelPickerOptions(candidates, providers, {}, labels)
    const matched = options.groups.flatMap((group) =>
      group.options.filter((option) =>
        matchesModelPickerOption(option, { ...emptyModelPickerFilters, query: 'Alpha Cloud' })
      )
    )
    expect(matched.map((option) => option.value)).toEqual(['alpha:alpha-a1', 'alpha:alpha-a2'])
  })

  it('searches model names and ids as well as provider names', () => {
    const options = buildModelPickerOptions(candidates, providers, {}, labels)
    const byModelName = options.options.filter((option) =>
      matchesModelPickerOption(option, { ...emptyModelPickerFilters, query: 'Reasoner' })
    )
    expect(byModelName.map((option) => option.value)).toEqual(['beta:beta-b1'])
    const byProviderId = options.options.filter((option) =>
      matchesModelPickerOption(option, { ...emptyModelPickerFilters, query: 'gamma' })
    )
    expect(byProviderId.map((option) => option.value)).toEqual(['gamma:gamma-g1'])
  })
})

describe('model picker category and protocol filters', () => {
  const options = buildModelPickerOptions(candidates, providers, {}, labels)

  it('keeps only models carrying the selected category (AND across selections)', () => {
    const tools = options.options.filter((option) =>
      matchesModelPickerOption(option, { ...emptyModelPickerFilters, categories: ['tools'] })
    )
    expect(tools.map((option) => option.value)).toEqual(['alpha:alpha-a1'])
    const freeReasoning = options.options.filter((option) =>
      matchesModelPickerOption(option, {
        ...emptyModelPickerFilters,
        categories: ['deal', 'reasoning']
      })
    )
    expect(freeReasoning).toEqual([])
  })

  it('classifies free models from zero pricing and stays empty without pricing data', () => {
    expect(isFreePricedModel(pricing(0, 0))).toBe(true)
    // 折扣不是免费：价格非 0 的折扣模型仍按付费处理。
    expect(isFreePricedModel(pricing(0, 2, true))).toBe(false)
    expect(isFreePricedModel(pricing(0, 2))).toBe(false)
    expect(isFreePricedModel(undefined)).toBe(false)
    const withoutPricing = buildModelPickerOptions(
      [{ providerId: 'alpha', model: model('no-price', 'No Price', { chat: true }) }],
      providers,
      {},
      labels
    )
    expect(withoutPricing.categories.find((chip) => chip.key === 'deal')?.count).toBe(0)
    expect(
      withoutPricing.options.filter((option) =>
        matchesModelPickerOption(option, { ...emptyModelPickerFilters, categories: ['deal'] })
      )
    ).toEqual([])
  })

  it('groups discounts and free models under the deal chip with distinct price tags', () => {
    const options = buildModelPickerOptions(candidates, providers, {}, labels)
    const byValue = Object.fromEntries(options.options.map((option) => [option.value, option]))

    // 0 价 = 免费标签；折扣优先让位于免费；纯折扣模型 = 折扣标签。
    expect(byValue['alpha:alpha-a1'].priceTag).toBe('free')
    expect(byValue['delta:delta-d1'].priceTag).toBe('discount')
    expect(byValue['delta:delta-d1'].categories).toContain('deal')
    expect(byValue['alpha:alpha-a2'].priceTag).toBeNull()
    expect(options.categories.find((chip) => chip.key === 'deal')).toEqual({ key: 'deal', count: 2 })
  })

  it('lets a manual free mark survive without pricing data', () => {
    const marked = provider('manual', 'Manual', 'chat-completions', [
      model('manual-free', 'Manual Free', { chat: true }, { freeOverride: true, pricing: pricing(8, 28) })
    ])
    const options = buildModelPickerOptions(
      [{ providerId: 'manual', model: marked.models[0] }],
      [marked],
      {},
      labels
    )
    expect(options.categories.find((chip) => chip.key === 'deal')).toEqual({ key: 'deal', count: 1 })
    expect(options.options[0].categories).toContain('deal')
    expect(options.options[0].priceTag).toBe('free')
  })

  it('keeps only models declaring the selected protocol and combines with categories', () => {
    const messages = filterModelPickerGroups(options.groups, {
      ...emptyModelPickerFilters,
      protocols: ['messages']
    })
    expect(messages.flatMap((group) => group.options.map((option) => option.value)))
      .toEqual(['beta:beta-b1'])
    const messagesWithTools = filterModelPickerGroups(options.groups, {
      ...emptyModelPickerFilters,
      protocols: ['messages'],
      categories: ['tools']
    })
    expect(messagesWithTools).toEqual([])
  })

  it('returns no groups when the keyword matches nothing', () => {
    expect(filterModelPickerGroups(options.groups, { ...emptyModelPickerFilters, query: 'zzz' })).toEqual([])
    expect(filterModelPickerGroups(options.groups, emptyModelPickerFilters)).toHaveLength(4)
  })
})

describe('call-site constraint matrix on a four-model fixture', () => {
  const four = [
    provider('p-chat', 'Chat', 'chat-completions', [
      model('m-chat', 'Chat Model', { chat: true }, { chatProtocol: 'chat-completions' })
    ]),
    provider('p-responses', 'Responses', 'responses', [
      model('m-responses', 'Responses Model', { chat: true }, { chatProtocol: 'responses' })
    ]),
    provider('p-gemini', 'Gemini', 'gemini', [
      model('m-gemini', 'Gemini Model', { chat: true }, { chatProtocol: 'gemini' })
    ]),
    provider('p-messages', 'Messages', 'messages', [
      model('m-messages', 'Messages Model', { chat: true }, { chatProtocol: 'messages' })
    ])
  ]
  const all = four.map((entry) => ({ providerId: entry.id, model: entry.models[0] }))

  it('keeps every protocol for the assistant picker but only messages for agent pickers', () => {
    expect(
      buildModelPickerOptions(all, four, { requireCapabilities: ['chat'] }, labels).options
    ).toHaveLength(4)
    expect(
      buildModelPickerOptions(all, four, AGENT_CONSTRAINTS, labels).options.map((option) => option.value)
    ).toEqual(['p-messages:m-messages'])
  })

  it('keeps only the image model for the image picker out of chat/image/video/embedding models', () => {
    const mixed = provider('p-mixed', 'Mixed', 'chat-completions', [
      model('m-chat-2', 'Chat', { chat: true }),
      model('m-image-2', 'Image', { chat: false, imageGeneration: true }),
      model('m-video-2', 'Video', { chat: false, videoGeneration: true }),
      model('m-embed-2', 'Embedding', { chat: false, embedding: true })
    ])
    const options = buildModelPickerOptions(
      mixed.models.map((entry) => ({ providerId: mixed.id, model: entry })),
      [mixed],
      { requireCapabilities: ['imageGeneration'], showProtocolFilter: false },
      labels
    )
    expect(options.options.map((option) => option.value)).toEqual(['p-mixed:m-image-2'])
    expect(options.protocols).toEqual([])
  })
})

describe('empty state reasons', () => {
  const emptyLabels = {
    pickerEmptyNoModels: labels.pickerEmptyNoModels,
    pickerEmptyNoMessages: labels.pickerEmptyNoMessages,
    pickerEmptyNoMessagesHint: labels.pickerEmptyNoMessagesHint,
    pickerEmptyNoImage: labels.pickerEmptyNoImage,
    pickerEmptyNoImageHint: labels.pickerEmptyNoImageHint,
    pickerEmptyNoMatch: labels.pickerEmptyNoMatch,
    pickerEmptyRetiredOnly: labels.pickerEmptyRetiredOnly
  }

  const chatOnly = provider('only-chat', 'Only Chat', 'chat-completions', [
    model('only-chat-1', 'Only Chat', { chat: true }, { chatProtocol: 'chat-completions' })
  ])
  const chatCandidates = [{ providerId: 'only-chat', model: chatOnly.models[0] }]

  it('explains that no model supports Messages for the agent picker', () => {
    const built = buildModelPickerOptions(chatCandidates, [chatOnly], {
      requireCapabilities: ['chat'],
      protocols: ['messages']
    }, labels)
    const empty = resolveModelPickerEmptyState(built, 0, emptyLabels)
    expect(empty).toEqual({
      reason: 'no-messages',
      title: labels.pickerEmptyNoMessages,
      hint: labels.pickerEmptyNoMessagesHint
    })
  })

  it('explains that no model supports image generation for the image picker', () => {
    const built = buildModelPickerOptions(chatCandidates, [chatOnly], {
      requireCapabilities: ['imageGeneration'],
      showProtocolFilter: false
    }, labels)
    expect(resolveModelPickerEmptyState(built, 0, emptyLabels)).toEqual({
      reason: 'no-image',
      title: labels.pickerEmptyNoImage,
      hint: labels.pickerEmptyNoImageHint
    })
  })

  it('falls back to the generic empty state for an unconstrained picker', () => {
    const built = buildModelPickerOptions([], [chatOnly], {}, labels)
    expect(resolveModelPickerEmptyState(built, 0, emptyLabels)).toEqual({
      reason: 'no-models',
      title: labels.pickerEmptyNoModels,
      hint: null
    })
  })

  it('reports retired-only and no-match separately', () => {
    const retired = provider('retired-co', 'Retired Co', 'chat-completions', [
      model('retired-1', 'Retired', { chat: true }, { probeReason: 'model_retired' })
    ])
    const retiredBuilt = buildModelPickerOptions(
      [{ providerId: 'retired-co', model: retired.models[0] }],
      [retired],
      {},
      labels
    )
    expect(resolveModelPickerEmptyState(retiredBuilt, 0, emptyLabels)?.reason).toBe('retired-only')

    const built = buildModelPickerOptions(chatCandidates, [chatOnly], {}, labels)
    expect(resolveModelPickerEmptyState(built, 0, emptyLabels)?.reason).toBe('no-match')
    expect(resolveModelPickerEmptyState(built, 1, emptyLabels)).toBeNull()
  })
})

describe('disabled providers', () => {
  const enabled = provider('enabled-co', 'Enabled Co', 'chat-completions', [
    model('enabled-a', 'Enabled A', { chat: true }),
    model('enabled-b', 'Enabled B', { chat: true, imageGeneration: true })
  ])
  const stopped = { ...provider('stopped-co', 'Stopped Co', 'messages', [
    model('stopped-a', 'Stopped A', { chat: true }, { chatProtocol: 'messages' }),
    model('stopped-b', 'Stopped B', { chat: true, imageGeneration: true }, { chatProtocol: 'messages' })
  ]), enabled: false }

  it('only lists models from enabled providers', () => {
    const options = buildModelPickerOptions(
      [...enabled.models.map((entry) => ({ providerId: 'enabled-co', model: entry })),
        ...stopped.models.map((entry) => ({ providerId: 'stopped-co', model: entry }))],
      [enabled, stopped],
      {},
      labels
    )
    expect(options.options.map((option) => option.value)).toEqual([
      'enabled-co:enabled-a',
      'enabled-co:enabled-b'
    ])
  })

  it('combines the enabled filter with capability, protocol and retired filters', () => {
    const candidates = [
      { providerId: 'enabled-co', model: enabled.models[0] },
      { providerId: 'enabled-co', model: enabled.models[1] },
      { providerId: 'stopped-co', model: stopped.models[0] },
      { providerId: 'stopped-co', model: stopped.models[1] }
    ]
    const image = buildModelPickerOptions(candidates, [enabled, stopped], {
      requireCapabilities: ['imageGeneration']
    }, labels)
    expect(image.options.map((option) => option.value)).toEqual(['enabled-co:enabled-b'])
    const messages = buildModelPickerOptions(candidates, [enabled, stopped], {
      protocols: ['messages']
    }, labels)
    expect(messages.options).toEqual([])
  })

  it('keeps a saved value from a disabled provider visible and flags it', () => {
    const selection = resolveModelPickerSelection('stopped-co:stopped-a', [], [enabled, stopped], labels)
    expect(selection).toMatchObject({
      modelName: 'Stopped A',
      providerName: 'Stopped Co',
      providerDisabled: true,
      outsideCandidates: true
    })
    expect(resolveModelPickerSelection('enabled-co:enabled-a', [], [enabled, stopped], labels)?.providerDisabled)
      .toBe(false)
  })
})

describe('isMessagesCapableModel', () => {
  const fourProtocols = [
    provider('p-chat', 'Chat', 'chat-completions', [
      model('m-chat', 'Chat Model', { chat: true }, { chatProtocol: 'chat-completions' })
    ]),
    provider('p-responses', 'Responses', 'responses', [
      model('m-responses', 'Responses Model', { chat: true }, { chatProtocol: 'responses' })
    ]),
    provider('p-gemini', 'Gemini', 'gemini', [
      model('m-gemini', 'Gemini Model', { chat: true }, { chatProtocol: 'gemini' })
    ]),
    provider('p-messages', 'Messages', 'messages', [
      model('m-messages', 'Messages Model', { chat: true }, { chatProtocol: 'messages' })
    ])
  ]

  it('keeps only the messages model for agent-side pickers', () => {
    expect(fourProtocols.map((entry) => isMessagesCapableModel(entry, entry.models[0])))
      .toEqual([false, false, false, true])
    const options = buildModelPickerOptions(
      fourProtocols.map((entry) => ({ providerId: entry.id, model: entry.models[0] })),
      fourProtocols,
      { protocols: ['messages'] },
      labels
    )
    expect(options.options.map((option) => option.value)).toEqual(['p-messages:m-messages'])
  })

  it('treats a declaration on the model or a passed probe on a messages endpoint as capability', () => {
    const declared = provider('p-declared', 'Declared', 'chat-completions', [
      model('m-declared', 'Declared', { chat: true }, { messagesSupport: 'yes' })
    ])
    const probed = provider('p-probed', 'Probed', 'chat-completions', [
      model('m-probed', 'Probed', { chat: true }, { probeStatus: 'passed' })
    ])
    expect(isMessagesCapableModel(declared, declared.models[0])).toBe(true)
    expect(isMessagesCapableModel(probed, probed.models[0])).toBe(false)
  })
})

describe('resolveModelPickerSelection', () => {
  const options = buildModelPickerOptions(candidates, providers, {}, labels)

  it('resolves the selected model name and provider display name', () => {
    expect(resolveModelPickerSelection('beta:beta-b1', options.options, providers, zhLabels))
      .toMatchObject({ modelName: 'Beta Reasoner', providerName: 'Beta Lab', outsideCandidates: false })
  })

  it('keeps a saved value that is outside the candidates instead of clearing it', () => {
    expect(resolveModelPickerSelection('missing:gone', options.options, providers, labels))
      .toMatchObject({ modelName: 'gone', outsideCandidates: true })
    const retired = resolveModelPickerSelection('beta:beta-b2', options.options, providers, labels)
    expect(retired).toMatchObject({ modelName: 'Beta Retired', outsideCandidates: true })
    expect(retired?.providerName).toBe('Beta Lab')
  })
})

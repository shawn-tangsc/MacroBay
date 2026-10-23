import type { ModelChatProtocol, ModelDefinition, ModelProvider } from './modelProviderTypes'
import { inferModelCapabilities, resolveModelCapabilities } from './modelCapabilityInference'
import { normalizeProviderChatEndpoints, resolveProviderPrimaryBase } from './providerChatEndpoints'
import type { PresetModelInput, PresetProtocolDeclaration, ProviderPresetInput } from './presets/presetTypes'
import { PRESET_GROUPS } from './presets/groups'
import type { ProviderCategoryId } from './presets/groups'
// `export ... from` 不建立本地绑定；解析函数要用真实的邀请链接表，所以单独 import 一份。
import { PROVIDER_REFERRAL_LINKS } from './providerReferralPrograms'

/**
 * 模型供应商预设的**唯一入口**（外部 40+ 处 import 这个模块，路径不变）。
 *
 * 结构：
 *  - 数据在 `presets/<category>.ts`（relay / domestic / international / local / gateway）；
 *  - 分组顺序与「分类 = 所在文件」的契约在 `presets/groups.ts`；
 *  - 邀请有礼在 `providerReferralPrograms.ts`；
 *  - 本文件只负责：类型 re-export、派生（分类 / 可达性 / id）、预设对象工厂。
 *
 * 分类与可达性都是**从预设数据派生**的，不再有平行的 id 清单：
 * 增删一家供应商只需改它所在的那个数据文件。
 */

export type { PresetModelInput, ProviderPresetInput } from './presets/presetTypes'
export type { ProviderCategoryId } from './presets/groups'
export {
  PROVIDER_REFERRAL_INACTIVE_IDS,
  PROVIDER_REFERRAL_LINKS,
  PROVIDER_REFERRAL_PROGRAMS,
  providerHasReferralLink,
  providerHasReferralProgram,
  providerIsRecommended,
  providerReferralRank
} from './providerReferralPrograms'
export type { ProviderReferralProgram } from './providerReferralPrograms'

/* ─────────────────────────────────────────────────────────────────────────────
 * PLAT-62：左栏供应商分组与可达性。
 *
 * 两者都是纯展示元数据：**不进入** ModelProvider 契约、不写设置、不做持久化。
 * 未收录的 id（自定义供应商）分类兜底 `gateway`、可达性兜底 `direct`。
 * ───────────────────────────────────────────────────────────────────────────── */

/** UI 组顺序：左栏按此顺序渲染组头，固定不随启用状态/搜索跳动。 */
export const PROVIDER_CATEGORY_ORDER: readonly ProviderCategoryId[] = [
  'relay',
  'domestic',
  'international',
  'local',
  'gateway'
]

/** 供应商 id → 分组；由「它在哪个预设文件里」派生。 */
export const PROVIDER_CATEGORY_BY_ID: Readonly<Record<string, ProviderCategoryId>> = Object.freeze(
  Object.fromEntries(
    PRESET_GROUPS.flatMap((group) =>
      group.presets.map((preset) => [preset.id, group.category] as const)
    )
  )
)

export function providerCategoryOf(providerId: string): ProviderCategoryId {
  return PROVIDER_CATEGORY_BY_ID[providerId] ?? 'gateway'
}

/**
 * PLAT-62 追加：可达性标签（国内直连 / 需代理）。
 *
 * 口径是「国内网络环境下是否通常需要代理访问」，属经验数据，可按需修正；
 * 唯一来源是各供应商配置里的 `requiresProxy: true`。
 */
export type ProviderReachability = 'direct' | 'proxy'

/** 只收录声明了 `requiresProxy` 的 id；其余（domestic 全部、国际站国内厂、local、new-api）走 direct 兜底。 */
export const PROVIDER_REACHABILITY_BY_ID: Readonly<Record<string, ProviderReachability>> = Object.freeze(
  Object.fromEntries(
    PRESET_GROUPS.flatMap((group) =>
      group.presets
        .filter((preset) => preset.requiresProxy === true)
        .map((preset) => [preset.id, 'proxy'] as const)
    )
  )
)

/**
 * 模型列表的协议声明覆盖情况 —— 唯一来源是各供应商配置里的 `protocolDeclaration`。
 * 未声明 = 还没测过（调用方据此不提示）。
 */
const PROVIDER_PROTOCOL_DECLARATION_BY_ID: Readonly<Record<string, PresetProtocolDeclaration>> = Object.freeze(
  Object.fromEntries(
    PRESET_GROUPS.flatMap((group) =>
      group.presets
        .filter((preset) => preset.protocolDeclaration !== undefined)
        .map((preset) => [preset.id, preset.protocolDeclaration!] as const)
    )
  )
)

export function providerProtocolDeclarationOf(providerId: string): PresetProtocolDeclaration | undefined {
  return PROVIDER_PROTOCOL_DECLARATION_BY_ID[providerId.trim()]
}

/**
 * 是否要在供应商详情顶部提示"这家拿不到可用协议、要去检测模型"。
 *
 * 判据按优先级：
 *  1. 预设显式声明 `protocolDeclaration`（实测结论）—— 以它为准；
 *  2. **没测过的供应商**看同步结果：有模型、但**没有任何一条**带 `declarationSource:
 *     'provider_list'` ⇒ 列表确实什么都没给（硅基流动就是这种），提示；
 *  3. 同步了、也确有逐模型声明 ⇒ 不提示；还没同步 ⇒ 不提示（不凭空断言）。
 *
 * 为什么需要第 2 条：41 家没测过的厂商不可能靠手工名单覆盖，但"列表给没给协议"在同步后
 * 是可以从数据本身读出来的。
 */
export function needsModelProtocolNotice(
  providerId: string,
  models: readonly Pick<ModelDefinition, 'declarationSource'>[] = []
): boolean {
  const declaration = providerProtocolDeclarationOf(providerId)
  if (declaration === 'single-hint' || declaration === 'none') return true
  if (declaration !== undefined) return false
  return models.length > 0 && !models.some((model) => model.declarationSource === 'provider_list')
}

export function providerReachabilityOf(providerId: string): ProviderReachability {
  return PROVIDER_REACHABILITY_BY_ID[providerId] ?? 'direct'
}

/**
 * 全局预设顺序 = 组顺序（relay → domestic → international → local → gateway），
 * 组内保持各数据文件的书写顺序。
 */
const systemProviderInputs: readonly ProviderPresetInput[] = PRESET_GROUPS.flatMap((group) => group.presets)

export const systemProviderIds = systemProviderInputs.map((provider) => provider.id)

export function isSystemProviderId(providerId: string): boolean {
  return (systemProviderIds as readonly string[]).includes(providerId)
}

/** provider id → 预设 key 页；只收录声明了 `websites.apiKey` 的家。 */
const PROVIDER_KEY_PAGE_BY_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    systemProviderInputs.flatMap((preset) =>
      preset.websites?.apiKey ? [[preset.id, preset.websites.apiKey] as const] : []
    )
  )
)

/**
 * 「获取密钥」入口的唯一解析口径（设置页「点击这里获取密钥」只读这一处）。
 *
 * 优先级：
 *  1. 我们自己的邀请链接（`PROVIDER_REFERRAL_LINKS`，产品 owner 指定的推广归属）；
 *  2. 预设里的普通 key 页（`websites.apiKey`，按 provider id 对齐）；
 *  3. 都没有（本地 / CLI 类，或自定义供应商）⇒ `undefined`，由 UI 回落到官网（极端兜底）。
 *
 * `referralLinks` 可注入（默认 `PROVIDER_REFERRAL_LINKS`），与 `providerHasReferralProgram`
 * 同口径：邀请码由 owner 陆续补，换链接只改数据，调用方与各家不同的拼接形式都不用碰。
 */
export function resolveProviderKeyUrl(
  providerId: string,
  referralLinks: Readonly<Record<string, string>> = PROVIDER_REFERRAL_LINKS
): string | undefined {
  return referralLinks[providerId] ?? PROVIDER_KEY_PAGE_BY_ID[providerId]
}

export function createSystemProviderPresets(): ModelProvider[] {
  return systemProviderInputs.map(createSystemProviderPreset)
}

function createSystemProviderPreset(preset: ProviderPresetInput): ModelProvider {
  // 端点清单由预设直接声明（`[0]` = 默认端点）；这里只做归一（trim + 去尾斜杠）。
  const endpoints = normalizeProviderChatEndpoints(preset.endpoints)
  // 默认端点 = `endpoints[0]`。预设模型自带协议（厂商声明优先，否则取默认端点），
  // 之后改端点顺序不会改动已存在的模型。
  // 网关型供应商：预设模型也直接带齐三条协议（与同步结果一致，避免同步前后标签不一致）。
  const allModelProtocols: readonly ModelChatProtocol[] | undefined =
    preset.protocolDeclaration === 'protocol-agnostic'
      ? ['chat-completions', 'responses', 'messages']
      : undefined
  const models = (preset.models ?? []).map((model) =>
    withPresetProtocols(
      createModelDefinition(preset.id, model, endpoints[0]?.protocol),
      endpoints[0]?.protocol,
      allModelProtocols
    ))

  return {
    id: preset.id,
    name: preset.name,
    endpoints,
    enabled: false,
    // 主地址由端点派生，不在预设里重复声明。
    baseUrl: resolveProviderPrimaryBase({ endpoints }),
    apiKey: '',
    isSystem: true,
    websites: preset.websites,
    models,
    defaultChatModelId: models.find((model) => resolveModelCapabilities(model).chat)?.id
  }
}

/**
 * 预设模型补齐协议集合：默认端点 + 网关型的"全部协议"。
 * 已有 `apiKey` 等用户/同步写入的值不在这里处理（合并见 `providerPresetMerge`）。
 */
function withPresetProtocols(
  model: ModelDefinition,
  defaultProtocol: ModelChatProtocol | undefined,
  allProtocols: readonly ModelChatProtocol[] | undefined
): ModelDefinition {
  if (allProtocols === undefined || model.capabilities.chat !== true) return model
  return { ...model, supportedProtocols: [...allProtocols] }
}

function createModelDefinition(
  providerId: string,
  model: PresetModelInput,
  chatProtocol?: ModelChatProtocol
): ModelDefinition {
  const capabilities = inferModelCapabilities({ id: model.id, capabilities: model.capabilities })
  return {
    id: model.id,
    name: model.name ?? model.id,
    group: model.group,
    provider: providerId,
    presetModel: true,
    capabilities,
    // 只有 chat 模型才写默认聊天协议（图片模型上写它只会干扰模型抽屉）。
    ...(chatProtocol && capabilities.chat ? { chatProtocol } : {})
  }
}

import type { MarketFactId } from '../../../contracts/factSources'
import type {
  ProviderDefinition,
  ProviderNoticeKind,
  SourceCategory,
  SourceDefinition,
  SourcePurpose
} from './providerRegistry'

/**
 * The two builders every provider definition is written with.
 *
 * They live apart from `providerRegistry.ts` for one reason: the registry is a data table, and the
 * builders are the two rules that table obeys (`panels` derived from `purposes`, `providerId` filled
 * by the provider). Keeping them next to a hundred data rows made the file grow past what a reader
 * can hold; nothing about the rules changed in the move.
 */

/** `src()` 的输入：`purposes` 必填（注册表作者不许漏），其余字段可省略走默认。 */
/**
 * `src()` 的输入：`purposes` 必填，`panels` **不许传**（它由 `purposes` 派生，传进来只会被静默覆盖）。
 *
 * `panels` 从类型上 `Omit` 掉，所以「顺手写一个 panels」是**编译错误**，不是运行期被悄悄改写——
 * 面板归属只有一个声明处（`purposes`），这条让第二份声明连写都写不出来。
 */
export type SourceInput = Omit<SourceDefinition, 'providerId' | 'purposes' | 'panels'> & { purposes: SourcePurpose[] }

/** `src()` 的输出：派生出 `panels`，`providerId` 由 `provider()` 补上。 */
export type SourceSeed = Omit<SourceInput, 'providerId'> & Pick<SourceDefinition, 'panels'>

export function src(input: Partial<Omit<SourceInput, 'purposes'>> & Pick<SourceInput, 'sourceId' | 'displayName' | 'purposes'>): SourceSeed {
  return {
    agents: ['crypto'],
    visibility: 'visible',
    collection: 'adapter',
    kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection: false },
    readiness: 'live',
    ...input,
    // 派生，不接收调用方的 panels：声明只看 `purposes` 一处。
    panels: input.purposes.flatMap((purpose) => purpose === 'dashboard' ? ['dashboard' as const] : purpose === 'calendar' ? ['economic-calendar' as const] : [])
  }
}

export function provider(input: {
  providerId: string
  displayName: string
  category: SourceCategory
  credential: 'none' | 'api-key'
  credentialSourceId?: string
  /** 详情页常显那一行凭据状态（四态）；与 notice 无关，不锁开关。 */
  credentialStateLine?: true
  /** 这个源能供哪些事实；见 `SourceDefinition.provides`。 */
  provides?: readonly MarketFactId[]
  /** 详情页头上方那条说明的**类别**（句子在文案表里，见 `ProviderNoticeKind`）。 */
  notice?: ProviderNoticeKind
  /** 官网地址：**有才画「官网」按钮**，没有就整个不出现（加源规范要求必须有）。 */
  website?: string
  /** 注册 / 获取 Key 的地址；与 `website` 相同则只画一颗按钮。 */
  signupUrl?: string
  sources: SourceSeed[]
}): ProviderDefinition {
  return {
    ...input,
    sources: input.sources.map((source) => ({ ...source, providerId: input.providerId }))
  }
}


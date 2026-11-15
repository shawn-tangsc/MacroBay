import type { ProviderView } from '../../../service/intelligence/application/sourceProjection'
import type { CollectionPolicyLabels } from './collectionPolicyLabels'

/**
 * 这一屏的**文案契约**、说明横幅的类别表、以及「这个源能不能测连接」那一条判断。
 *
 * 从 `ProviderDetail` 拆出来（505 → 400 出头）：三样都是**声明**，不含渲染；
 * 渲染文件里留着的应该是它自己那套状态机。
 */
/**
 * 只有**有件事要讲**的类别才有横幅。
 *
 * `verification-only` 刻意不在表里（用户 2026-11-13：「本版只验证密钥，不采集数据」这类
 * 讲我们内部做到哪一步的话不许进界面）。这个标记本身还在用：四态那一行与开关的显示都靠它。
 */
export const PROVIDER_NOTICE_KEYS: Readonly<Partial<Record<NonNullable<ProviderView['notice']>, string>>> = {
  'private-data-source': 'settings.intelligenceSources.providerNotices.privateDataSource'
}

export type ProviderDetailLabels = {
  sourceNames: Record<string, string>
  providerNames: Record<string, string>
  panelNames: Record<string, string>
  badges: { pending: string; advanced: string; calendar: string; proxy: string }
  status: { applied: string; notApplied: string }
  toggleSource: Readonly<{ enable: string; disable: string }>
  /** 页头那颗**整组**启停的可访问名（带来源名）。缺省时退回源开关那套说法。 */
  toggleProvider?: Readonly<{ enable: string; disable: string }>
  credentials: string
  website: string
  signup: string
  testConnection: string
  /** 行内连通性测试的三个短词；缺省时退回 `testConnection`（老调用点不受影响）。 */
  rowTest?: string
  rowTesting?: string
  rowTestOk?: string
  rowTestFailed?: string
  rowTestUnsupported?: string
  jobRegistered: string
  jobNotRegistered: string
  connectionSucceeded: string
  connectionFailed: string
  connectionUnsupported: string
  apiKey: { label: string; save: string; emptyHint: string; savedHint: string; revealFailed: string }
  /**
   * 设置页只说**短句**（这里不显示内容，用全句会承诺「先显示上次同步的内容」而这儿没有内容）。
   * 原因码、自动同步已停止、上次成功日期照原样给，由下面三个模板拼。
   */
  unavailableReasonCode: string
  /** ⓘ 的名字（与正文那句分开：一个是名字，一个是句子）。 */
  unavailableReasonCodeAria: string
  automaticSyncStopped: string
  lastSuccessfulSync: string
  /**
   * 健康四格已按用户 2026-11-12 删除；字段保留只为宿主契约兼容，界面不再读它。
   */
  health: unknown
}

/**
 * The one rule for the probe button, so a test can hold it without rendering the pane.
 *
 * 凭据是不是 API Key 不再影响它：那颗按钮已经移到**源名旁**、全屏只有这一颗
 * （用户 2026-11-10：行内动作跟着源名走），凭据块里只剩「保存并验证连接」。
 */
export function offersConnectionTest(provider: { credential: string; sources: ReadonlyArray<{ capabilities?: { testConnection?: boolean } }> }): boolean {
  return provider.sources.some((source) => source.capabilities?.testConnection === true)
}


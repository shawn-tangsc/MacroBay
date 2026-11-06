import type {
  AnalysisComparability,
  AnalysisDomain,
  AnalysisFreshness,
  MarketAnalysisDataAccessProfileId
} from './marketAnalysisContracts'

/**
 * 分析读到的证据：事实、证据引用、来源健康、以及它们相对上一次快照的变化。
 *
 * 单独一个文件，是因为它和「运行、结论、预测」不是一件事：证据的形状由采集与冻结决定，
 * 运行与结论的形状由编排与发布决定。混在一处时，两边任何一侧加字段都会让另一个 700 行的文件
 * 再长一截；分开以后各自只长自己那一块。原路径继续 re-export，104 处 import 一行不用改。
 */
export type AgentFact = Readonly<{
  factId: string
  domain: AnalysisDomain
  subject: string
  /**
   * What to *call* this fact when the subject is only its kind.
   *
   * Calendar facts are keyed by the observation they came from, so their subject is the kind
   * (`economic-indicator`) and their name lives in the calendar store. This carries that name for
   * display only: it is never part of `factId`, which is what keeps a naming change from becoming a
   * change the diff reports — every calendar fact would otherwise read as newly added.
   */
  subjectLabel?: string
  metric: string
  value: string | number | null
  unit: string | null
  sourceId: string
  sourceLabel: string
  observedAt: string | null
  asOf: string
  freshness: AnalysisFreshness
  confidence: number
  comparability: AnalysisComparability
  evidenceRefId: string | null
  /**
   * The public page a reader can open to check this value. Optional because facts written before
   * the policy path carried one stay valid; it never reaches the model prompt.
   */
  sourceUrl?: string
}>

export type AgentEvidenceRef = Readonly<{
  evidenceRefId: string
  sourceId: string
  sourceLabel: string
  itemId: string | null
  occurredAt: string | null
  publishedAt: string | null
  detectedAt: string | null
  computedAt: string | null
  visibleAt: string
  excerptHash: string
  /** The public page behind this evidence, when the projection knows one. */
  sourceUrl?: string
}>

export type SourceHealthFlag = Readonly<{
  sourceId: string
  status: 'healthy' | 'degraded' | 'failed' | 'paused'
  asOf: string
}>

/**
 * One fact-level difference between a frozen snapshot and its predecessor in the
 * same event group. `changed` keeps both values so the agent can state what moved
 * instead of only what is currently true.
 */
export type SnapshotFactChange = Readonly<{
  factId: string
  domain: AnalysisDomain
  metric: string
  /**
   * Display fields copied from the fact. They let a reader describe the change
   * ("BTC ETF 净流入", unit USD) instead of showing an internal fact id, and are
   * optional because snapshots frozen before they existed carry none.
   */
  subject?: string
  /** The subject's own name, when the subject is only its kind. Display only, never identity. */
  subjectLabel?: string
  unit?: string | null
  sourceLabel?: string
  kind: 'added' | 'removed' | 'changed'
  /** Present for `removed` and `changed`; the value carried by the predecessor. */
  previousValue?: string | number | null
  /** Present for `added` and `changed`; the value carried by this snapshot. */
  value?: string | number | null
}>

/**
 * Frozen record of what changed at publication time (product owner request:
 * every new conclusion must state which data moved). It is stored on the snapshot
 * and covered by `snapshotHash`, so a replay reproduces the same "what changed"
 * view without reading any mutable table.
 */
export type SnapshotChange = Readonly<{
  /** 1 for the first snapshot of an event group, then the predecessor's sequence + 1. */
  sequence: number
  previousSnapshotHash: string | null
  /** Sorted factId order; empty when the snapshot is the first one or nothing moved. */
  facts: readonly SnapshotFactChange[]
  /** Domains that entered `missingDomains` compared with the predecessor. */
  missingDomainsAdded: readonly AnalysisDomain[]
  /** Domains that left `missingDomains` compared with the predecessor. */
  missingDomainsRemoved: readonly AnalysisDomain[]
  caveatsAdded: readonly string[]
  caveatsRemoved: readonly string[]
  evidenceRefsAdded: readonly string[]
  evidenceRefsRemoved: readonly string[]
}>

export type EvidenceSnapshot = Readonly<{
  id: string
  /** 1 is a snapshot written before facts carried `sourceUrl`; new snapshots are written as 2. */
  schemaVersion: 1 | 2
  eventGroupId: string
  asOf: string
  dataCutoff: string
  snapshotHash: string
  profileId: MarketAnalysisDataAccessProfileId
  facts: readonly AgentFact[]
  missingDomains: readonly AnalysisDomain[]
  caveats: readonly string[]
  evidenceRefs: readonly AgentEvidenceRef[]
  sourceHealth: readonly SourceHealthFlag[]
  /**
   * What moved since the previous snapshot of the same event group.
   *
   * Optional on purpose: snapshots written before this record existed stay valid,
   * and `snapshotHash` deliberately does not cover it. Readers derive it from the
   * immutable predecessor when it is absent, so the value is auditable without a
   * hash migration that would invalidate persisted rows.
   */
  change?: SnapshotChange
  createdAt: string
  policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
}>

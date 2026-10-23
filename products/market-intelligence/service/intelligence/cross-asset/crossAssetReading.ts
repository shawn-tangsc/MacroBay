import { crossAssetContractPolicy } from '../../../contracts/crossAssetObservationContracts'
import { crossAssetFlatBand } from './crossAssetAnalytics'
import { crossAssetPolicy } from './crossAssetPolicy'

/**
 * The cross-market reading (design 142): which of five scenarios the chart currently looks like.
 *
 * 这不是模型结论，也不是"预测"：它只把图上那几条线在同一窗口里的走向，对照五个剧本，说"像哪一个"
 * 和"哪一个不像、因为哪条腿没走成"。因此它只依赖四件事：四条腿在该窗口的收益、产品自己的界线、
 * 相关性（只作背书）、相对收益（只作旁证）。
 *
 * 三条口径上的硬约束（设计 142 §3）：
 *
 * - **只有 24h 窗口给判读**：相关性恒为 24 小时 5 分钟收益算出来的，放在 1H/7D 的判读旁边就是把两个
 *   周期混进一句话——2026-10-15 那条"一行写了两个交易日"的日频行就是同类错误。
 * - **界线属于已有的 owner**（`crossAssetObservationPolicy.flatPercent`），并按窗口开方缩放；本模块
 *   不新增第二套数字。
 * - **不发明"相关性高/低"的阈值**：ρ 只作为背书随判读给出；"只有加密在动"靠的是三条宏观腿都没走，
 *   因此 ρ 不可用时它照样成立（把"没有背书"当成"低相关"才是错的）。
 */
/**
 * 这一族的字面量**只有契约一个 owner**（`crossAssetContractPolicy` 的 reading* 清单）：线协议校验器按同一批
 * 清单拒绝非法载荷，所以两边各写一份的后果是——某天悄悄分叉，然后**每一个快照都被 fail-closed 拒收**。
 * 独立评审 2f774501 发现这里此前确实各写了一份，而设计 142 §5.1 与契约注释都声称"服务侧从契约取"。
 *
 * 契约里不放的只有**条件表**（哪个剧本要求哪条腿怎么走）：那是行为，留在服务侧。
 */
export type CrossAssetReadingLeg = typeof crossAssetContractPolicy.readingLegs[number]
export type CrossAssetReadingDirection = typeof crossAssetContractPolicy.readingDirections[number]
export type CrossAssetReadingWindow = typeof crossAssetContractPolicy.ranges[number]
export type CrossAssetReadingScenarioId = typeof crossAssetContractPolicy.readingScenarios[number]
export type CrossAssetReadingNoticeId = typeof crossAssetContractPolicy.readingNotices[number]
export type CrossAssetReadingUndeterminedReason = typeof crossAssetContractPolicy.readingReasons[number]

export const crossAssetReadingPolicy = Object.freeze({
  /** The one window a reading is stated for. Anything else shows 该窗口不判读 rather than mixing horizons. */
  window: '24h' as const,
  /** How many "不像" entries a reader gets. 上限归契约：它同时是载荷边界，两处各写会分叉。 */
  maximumRefuted: crossAssetContractPolicy.maximumRefuted
})

/** The four legs, in reader order — also the order ties and refusals are reported in. Owner: the contract. */
export const crossAssetReadingLegs: readonly CrossAssetReadingLeg[] = crossAssetContractPolicy.readingLegs

type Condition = Readonly<{ leg: CrossAssetReadingLeg; direction: CrossAssetReadingDirection | readonly CrossAssetReadingDirection[] }>
type Scenario = Readonly<{ id: CrossAssetReadingScenarioId; conditions: readonly Condition[] }>

const condition = (leg: CrossAssetReadingLeg, direction: Condition['direction']): Condition => Object.freeze({ leg, direction })

/**
 * The five scenarios, in arbitration order (design 142 §3.2).
 *
 * The first four are mutually exclusive on (dollar, gold) — the two legs that say *why* risk assets moved —
 * and the fifth requires all three macro legs to be flat, so no two can ever both match. The order is
 * pinned anyway, because it is the rule a reader would get if the table ever grew a scenario.
 */
export const crossAssetReadingScenarios: readonly Scenario[] = Object.freeze([
  Object.freeze({ id: 'risk-off', conditions: Object.freeze([
    condition('dxy', 'up'), condition('gold', 'up'), condition('index', 'down'), condition('btc', 'down')]) }),
  Object.freeze({ id: 'discount-rate', conditions: Object.freeze([
    condition('dxy', 'up'), condition('gold', 'down'), condition('index', 'down'), condition('btc', 'down')]) }),
  Object.freeze({ id: 'risk-on', conditions: Object.freeze([
    condition('dxy', 'down'), condition('gold', 'up'), condition('index', 'up'), condition('btc', 'up')]) }),
  Object.freeze({ id: 'risk-on-recovery', conditions: Object.freeze([
    condition('dxy', 'down'), condition('gold', 'down'), condition('index', 'up'), condition('btc', 'up')]) }),
  Object.freeze({ id: 'crypto-specific', conditions: Object.freeze([
    condition('dxy', 'flat'), condition('gold', 'flat'), condition('index', 'flat'), condition('btc', Object.freeze(['up', 'down'] as const))]) })
])

export type CrossAssetReadingCorrelation =
  | Readonly<{ state: 'available'; value: number; sampleCount: number; expectedCount: number; window: '24h'; interval: '5m' }>
  | Readonly<{ state: 'unavailable'; reason: string }>

/**
 * What the caller hands in: the correlation the analytics computed, without a horizon. The resolver stamps
 * `24h`/`5m` onto it, so the horizon cannot be forgotten by whoever assembles the snapshot — it travels with
 * the number instead of being assumed by whoever reads it.
 */
export type CrossAssetReadingCorrelationInput =
  | Readonly<{ state: 'available'; value: number; sampleCount: number; expectedCount: number }>
  | Readonly<{ state: 'unavailable'; reason: string }>

export type CrossAssetReadingLegValue =
  | Readonly<{ state: 'available'; returnPercent: number }>
  | Readonly<{ state: 'unavailable'; reason: 'missing' | 'stale' | 'insufficient' | 'zero-variance' }>

export type CrossAssetReadingInput = Readonly<{
  window: CrossAssetReadingWindow
  legs: Readonly<Record<CrossAssetReadingLeg, CrossAssetReadingLegValue>>
  correlation: CrossAssetReadingCorrelationInput
  relativeReturns: Readonly<{ btcMinusIndex: number | null; ethMinusBtc: number | null }>
  /** Substitutions the sentence must admit to: `index-proxy`, `dxy-synthetic`, `gold-synthetic`. */
  notices: readonly CrossAssetReadingNoticeId[]
}>

export type CrossAssetReading =
  | Readonly<{
    state: 'judged'
    window: '24h'
    scenario: CrossAssetReadingScenarioId
    legs: readonly Readonly<{ leg: CrossAssetReadingLeg; direction: CrossAssetReadingDirection; returnPercent: number }>[]
    refuted: readonly Readonly<{ scenario: CrossAssetReadingScenarioId; leg: CrossAssetReadingLeg }>[]
    correlation: CrossAssetReadingCorrelation
    relativeReturns: Readonly<{ btcMinusIndex: number | null; ethMinusBtc: number | null }>
    notices: readonly CrossAssetReadingNoticeId[]
  }>
  | Readonly<{
    state: 'undetermined'
    reason: CrossAssetReadingUndeterminedReason
    leg?: CrossAssetReadingLeg
    /** 只有"认不出组合"时才带：缺腿/停更时根本没有完整的腿集可描述。 */
    legs?: readonly Readonly<{ leg: CrossAssetReadingLeg; direction: CrossAssetReadingDirection; returnPercent: number }>[]
    refuted: readonly Readonly<{ scenario: CrossAssetReadingScenarioId; leg: CrossAssetReadingLeg }>[]
  }>

/** The three-state direction of one leg: the rule the scenarios read, exported so it can be pinned directly. */
export function crossAssetLegDirection(leg: CrossAssetReadingLeg, returnPercent: number, window: CrossAssetReadingWindow): CrossAssetReadingDirection {
  const band = crossAssetFlatBand(leg, window)
  // The comparison is the observation key's own (`>` / `<`): exactly on the band is flat.
  return returnPercent > band ? 'up' : returnPercent < -band ? 'down' : 'flat'
}

function matches(direction: CrossAssetReadingDirection, expected: Condition['direction']): boolean {
  return Array.isArray(expected) ? (expected as readonly CrossAssetReadingDirection[]).includes(direction) : expected === direction
}

export function resolveCrossAssetReading(input: CrossAssetReadingInput): CrossAssetReading {
  if (input.window !== crossAssetReadingPolicy.window) return Object.freeze({ state: 'undetermined', reason: 'window-not-judged', refuted: Object.freeze([]) })
  for (const leg of crossAssetReadingLegs) {
    const value = input.legs[leg]
    // Missing first, then stale: a leg that never arrived cannot be judged by its age, and the reader is
    // told which leg stopped the reading rather than that "some data" is missing.
    if (value.state !== 'available') {
      const reason = value.reason === 'missing' ? 'legs-missing' : 'stale'
      return Object.freeze({ state: 'undetermined', reason, leg, refuted: Object.freeze([]) })
    }
  }
  const directions = Object.fromEntries(crossAssetReadingLegs.map(leg => {
    const value = input.legs[leg]
    return [leg, crossAssetLegDirection(leg, (value as { returnPercent: number }).returnPercent, input.window)]
  })) as Record<CrossAssetReadingLeg, CrossAssetReadingDirection>
  /** 四条腿各自的三态与读数：判读成立时是"哪条腿不符"的论据，认不出组合时就是那条兜底描述。 */
  const legReadings = Object.freeze(crossAssetReadingLegs.map(leg => Object.freeze({
    leg, direction: directions[leg], returnPercent: (input.legs[leg] as { returnPercent: number }).returnPercent
  })))
  const mismatches = (scenario: Scenario): readonly CrossAssetReadingLeg[] =>
    scenario.conditions.filter(value => !matches(directions[value.leg], value.direction)).map(value => value.leg)
  const selected = crossAssetReadingScenarios.find(scenario => mismatches(scenario).length === 0)
  /** Only the scenarios that are one leg away are worth naming: two or more legs off is plainly "not it". */
  const refuted = crossAssetReadingScenarios
    .filter(scenario => scenario.id !== selected?.id)
    .map(scenario => ({ scenario, mismatched: mismatches(scenario) }))
    .filter(value => value.mismatched.length === 1)
    .slice(0, crossAssetReadingPolicy.maximumRefuted)
    .map(value => Object.freeze({ scenario: value.scenario.id, leg: value.mismatched[0]! }))
  if (!selected) return Object.freeze({ state: 'undetermined', reason: 'no-match', refuted: Object.freeze(refuted), legs: legReadings })
  return Object.freeze({
    state: 'judged', window: crossAssetReadingPolicy.window, scenario: selected.id,
    legs: legReadings,
    refuted: Object.freeze(refuted), relativeReturns: input.relativeReturns,
    // The horizon travels with the number: the correlation is always the 24h/5m one, and the sentence must
    // be able to say so rather than leave the reader to assume it belongs to whatever window they are on.
    correlation: input.correlation.state === 'available'
      ? Object.freeze({ ...input.correlation, window: crossAssetReadingPolicy.window, interval: crossAssetPolicy.interval })
      : input.correlation,
    notices: Object.freeze([...input.notices])
  })
}

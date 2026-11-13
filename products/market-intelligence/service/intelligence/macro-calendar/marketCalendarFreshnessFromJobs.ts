import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy } from './narwhal-calendar/narwhalCalendarJob'

/**
 * **新鲜度改写**：删掉旧源之后，「数据新不新」的唯一依据就是**采集作业自己跑成什么样**。
 *
 * 原来是问旧源的采集批次（`readCollectionFreshness`）。旧源一删，那条路就只剩冻结的旧记录——
 * 界面会永久显示「很旧」，而实际数据每小时都在更新。所以改成看 Narwhal 的作业运行记录：
 *
 * - **两个数分开**：`lastRunAt` 是作业最近一次成功运行的时刻（「它跑没跑」），
 *   `lastWrittenAt` 是**真正写进数据**的时刻（「数据新旧」）。作业每分钟「成功」但源一直回
 *   重复内容时，前者很新、后者三天没动——只按运行记录算会显示成「刚更新」，那是假象。
 *   所以 `lastCollectedAt` **取真正写入数据的那个时刻**；运行时刻留作诊断（`lastRunAt`），
 *   两者差得离谱时由调用方打一行日志，而不是改这个数；
 * - 失败不算——「失败」与「没跑」在读者眼里是同一件事：这几天没有新数据；
 * - `sources` 三条按 `feedByKind` 对齐，**每条都给同一个时刻**：Narwhal 一次采集三类事件，
 *   拆成三个时刻就是编造；将来若真有按类采集，再让它们各自不同；
 * - 从未成功过 → `lastCollectedAt: null`（这是**事实**，不是失败）。
 *
 * 一条边界：作业运行时没资格回答「某个源是否启用」——这里不做启用判断，启用与否由调用方
 * 在注册表那层判，别在这儿再造第二处。
 */
/**
 * 标准表里最近一次**真正写入**的时刻（`mi_calendar_events.observed_at` 的最大值）。
 *
 * 表还没建（新库、或采集一次都没跑）→ `null`：那是「没有数据」这个事实，不是读不到。
 * 这里只读一个数，不判断启用、不解析行——新鲜度的口径只有这一处。
 */
export function readStandardTableLastWrittenAt(database: DatabaseSync): string | null {
  try {
    const row = database.prepare('select max(observed_at) as at from mi_calendar_events').get() as
      { at: string | null } | undefined
    return row?.at ?? null
  } catch { return null }
}

export type JobRunLike = Readonly<{ status?: string; completedAt?: string; startedAt?: string
  createdAt?: string; definitionId?: string }>

export function readCalendarFreshnessFromJobRuns(input: Readonly<{
  listRuns: (query: { definitionId: string }) => readonly JobRunLike[]
  /** 数据里最近一次真正写入的时刻（标准表 `max(observed_at)`）；没有数据就是 `null`。 */
  lastWrittenAt: string | null
  asOf: string
}>): Readonly<{ state: 'available'; asOf: string; lastCollectedAt: string | null
  sources: readonly { descriptorId: string; lastCollectedAt: string | null }[]
  lastRunAt: string | null }> {
  const completions: string[] = []
  for (const definitionId of [narwhalCalendarTickPolicy.definitionId, narwhalCalendarSweepPolicy.definitionId]) {
    for (const run of input.listRuns({ definitionId })) {
      if (run.status !== 'completed') continue
      const at = run.completedAt ?? run.startedAt ?? run.createdAt
      if (at === undefined) continue
      completions.push(at)
    }
  }
  const lastRunAt = completions.sort().at(-1) ?? null
  // **数据新旧看写入，不看运行**：运行成功但没写进任何行时，界面不能显示成「刚更新」。
  const lastCollectedAt = input.lastWrittenAt ?? lastRunAt
  return {
    state: 'available', asOf: input.asOf, lastCollectedAt,
    sources: marketCalendarPublicPolicy.feedByKind.map((descriptorId) => ({ descriptorId, lastCollectedAt })),
    lastRunAt
  }
}

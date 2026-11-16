import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy } from './narwhal-calendar/narwhalCalendarJob'
import { zeroXRouterCalendarSchedulerDefinitionIds } from './0xrouter-calendar/zeroXRouterCalendarScheduler'

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

/**
 * **当前真正在写的采集作业**（2026-11-16 修）。
 *
 * 原来只认 narwhal 的两个定义；narwhal 一停（最后一次完成 11-13），这个数就冻在 11-13，
 * 而 0xrouter 三路每分钟都在写（1180 次、最后一次 11-22:52）——于是「数据 8 分钟新」被算成
 * 「过期两天」，简报触发补采、补采又绑在 narwhal 上，最后写成「这次补采没有成功」。
 * 判定的输入必须是**当下在跑的那几条作业**，删源时这份清单自己会变短。
 */
export const calendarCollectionJobDefinitionIds: readonly string[] = Object.freeze([
  narwhalCalendarTickPolicy.definitionId,
  narwhalCalendarSweepPolicy.definitionId,
  ...zeroXRouterCalendarSchedulerDefinitionIds
])

/**
 * **判定只读一个数**（用户 2026-11-16 定死）：`select max(observed_at) from mi_calendar_events`。
 *
 * 今晚同一个坑摔了六次，根因只有一个：判定去问「作业叫什么名字」，而换源时作业名改过一次、
 * 两套 id 并存，每处按 id 找作业就漏一处。库里写了就是写了——与哪条作业、哪个来源无关。
 *
 * 采集尝试（attempts）**只作展示**：「最近一次尝试」那句话用它，不参与任何判定分支。
 */
export function readCalendarFreshnessFromJobRuns(input: Readonly<{
  /** 数据里最近一次真正写入的时刻（标准表 `max(observed_at)`）；**唯一判定输入**。 */
  lastWrittenAt: string | null
  asOf: string
  /** 展示输入：每路最近一次尝试（attempts 表）。不传就不出这个字段，不编。 */
  latestAttempts?: readonly Readonly<{ descriptorId: string
    latestAttempt?: { attemptedAt: string; state: string } }>[]
}>): Readonly<{ state: 'available'; asOf: string; lastCollectedAt: string | null
  sources: readonly { descriptorId: string; lastCollectedAt: string | null
    latestAttempt?: { attemptedAt: string; state: string } }[] }> {
  // 作业记录不再参与判定（判定的唯一依据是 `lastWrittenAt`）。
  /**
   * **过期只看「作业有没有跑成」，不看「这次有没有写进新行」**（Chief 2026-11-14 定）。
   *
   * 原来取的是「最后写入时刻」，于是源安静几小时没写新行，界面就写成「日历数据已过期」——
   * 而采集其实一直在正常跑。**源没有新数据 ≠ 采集失败**，这两件事必须分开：前者的答案是
   * 「今天没有新发布」，后者才是「我们没采到」。写入时刻仍然读（`input.lastWrittenAt`），
   * 但只在**作业从没跑成过**时兜底：那种情况下有数据也比「什么都没采过」诚实。
   */
  const lastCollectedAt = input.lastWrittenAt
  // **这份返回值是公共读数**：`isMarketCalendarFreshness` 用精确键集校验，多一个键整份就作废，
  // 简报于是只能显示「自动同步已停止」。诊断用的 `lastRunAt` 不塞进来——要它就在调用点单独算、
  // 单独记日志（「跑了」与「写入了」本来就是两个数，见上面那两条）。
  return {
    state: 'available', asOf: input.asOf, lastCollectedAt,
    // 报的是**采集描述符**（当下在采的三条），不是 `feedByKind` 里旧源的 feed id——
    // 后者会让整份读数被契约校验判成不可用，或者把一条停跑的源算进「最差」。
    sources: marketCalendarPublicPolicy.descriptors.map((descriptorId) => {
      const attempt = input.latestAttempts?.find((entry) => entry.descriptorId === descriptorId)?.latestAttempt
      return { descriptorId, lastCollectedAt, ...(attempt === undefined ? {} : { latestAttempt: attempt }) }
    })
  }
}

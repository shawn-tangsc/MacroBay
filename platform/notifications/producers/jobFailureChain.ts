import type { JobRunRecord } from '../../jobs/contracts/jobTypes'

import { jobFailureIdentityOf } from './jobFailureIdentity'

/**
 * P2「同一任务连续失败」的阈值：连续 **3** 次终态失败（平台需求 v2.4 §1 P2、契约 v2.11 §4.1）。
 *
 * 写在这里而不是散在生产者里：阈值是产品定的数，一处可改、可被测试与文档逐条对上。
 */
export const JOB_REPEATED_FAILURE_THRESHOLD = 3

/**
 * 数「连续终态失败」的段长。**从 run 台账取，不靠内存计数**——进程重启后计数归零会让
 * 一个坏了三天的任务永远到不了阈值。
 *
 * 五条规则（冻结文档只写了「连续 3 次终态失败」，数法在这里定一处，别处只引用）：
 *
 * 1. 只数 `failed`；
 * 2. 一次 `completed` 就清零——「连续」的含义就是中间没有成功过；
 * 3. `cancelled` 既不算成功也不算失败，跳过、计数不动（用户主动取消不是任务出错）；
 * 4. `queued` / `running` 不是结果，跳过；
 * 5. 入参必须是**同一任务定义、新到旧**的终态序列；**不按时间间隔清零**——每天跑一次的
 *    任务连坏三天正是 P2 要报的形状，用「两次失败隔太久就作废」会让它永远不响。
 */
export function countConsecutiveTerminalFailures(
  runs: readonly JobRunRecord[],
  identity?: string
): number {
  let count = 0
  for (const run of runs) {
    // 只数「同一个任务」：一次性作业的 definitionId 每次都变，按 id 数会让连续失败永远到不了阈值。
    if (identity !== undefined && jobFailureIdentityOf(run) !== identity) continue
    if (run.status === 'queued' || run.status === 'running' || run.status === 'cancelled') continue
    if (run.status === 'completed') break
    count += 1
  }
  return count
}

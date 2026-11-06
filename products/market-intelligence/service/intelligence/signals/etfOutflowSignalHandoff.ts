import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { notifyEtfOutflowSignals, type SignalNoticeSubmit } from './etfOutflowNotifier'

/**
 * 刷新服务的交接点：这一轮判出的信号，从这里交给通知。
 *
 * **不再叫分析**（2026-11-06 定，r9 08 §4.1）：分析的唯一入口是十五分钟扫描。推式留在这里会
 * 出现两个入口，而去重只会在事后拦一次，拦不住「谁先谁后」；应用在「采集写完、交接之前」崩掉
 * 时，推式丢掉的这一次也没有人补。扫描下一个 tick 从同一份数据重算，最多晚一步，且能自愈。
 *
 * 通知留在刷新路径的前提（缺一就一起迁到扫描）：通知只发「数据到了」、不携带分析结论。
 */
export function etfOutflowSignalHandoff(
  submit: SignalNoticeSubmit | undefined
): Readonly<{ handOffSignals: (signals: readonly ModuleSignal[]) => Promise<void> }> {
  return {
    async handOffSignals(signals) {
      // The analysis is not handed off here on purpose; see the comment above.
      await notifyEtfOutflowSignals(submit, signals)
    }
  }
}

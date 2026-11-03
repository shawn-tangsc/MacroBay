import type { ModuleSignal } from '../../../contracts/moduleSignal'
import type { SignalAnalysisService } from '../jobs/requestSignalAnalysis'
import { etfOutflowAnalysisRequests } from './etfOutflowSignal'
import { notifyEtfOutflowSignals, type SignalNoticeSubmit } from './etfOutflowNotifier'

/**
 * 刷新服务的交接点：这一轮判出的信号，从这里分给两个消费者。
 *
 * 通知与自动分析是两件事，所以各有各的入口：通知在自己的层里读出口开关（牌子没上、通知不发），
 * 分析由接收端判额度、去重与单飞。这里只做一件事——把同一份信号原样交给两边，谁都不在这层
 * 重判一次。
 *
 * 分析入口是**延迟取**的：刷新服务在装配时比分析运行时先建好，拿不到那个对象；传一个取值函数，
 * 调用发生时再取，既能晚绑定，也不必让装配文件为它长一行。
 *
 * 接收端抛错不升级成采集失败：没入队的调用由接收端自己把账本行翻成 `skipped`，
 * 这里吞掉，行情照常算「这一轮写好了」。
 */
export function etfOutflowSignalHandoff(
  submit: SignalNoticeSubmit | undefined,
  resolveAnalysis?: () => SignalAnalysisService | undefined
): Readonly<{ handOffSignals: (signals: readonly ModuleSignal[]) => Promise<void> }> {
  return {
    async handOffSignals(signals) {
      await notifyEtfOutflowSignals(submit, signals)
      const analyze = resolveAnalysis?.()
      if (!analyze) return
      // 一条一条交：同一天 BTC / ETH 是两条读数，接收端按各自的去重键记，合并与单飞归它。
      for (const request of etfOutflowAnalysisRequests(signals)) {
        try {
          await analyze(request)
        } catch {
          // 见上：一次入队失败不该把已经落库的行情判成失败。
        }
      }
    }
  }
}

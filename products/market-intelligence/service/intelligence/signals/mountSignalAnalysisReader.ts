import type { SignalAnalysisReader } from './attachModuleSignals'

/**
 * 把「分析到哪一步」的读口挂到公开查询上。
 *
 * 这一步单独成函数，是因为漏掉它不会有任何报错：卡片只是每次都读不到状态，读者看到的是
 * 一片红色感叹号。**挂载点式的依赖必须在装配层有一处被断言的调用**，否则测试里自己注入得好好的，
 * 生产环境从来没挂上，谁也不会发现。
 */
export function mountSignalAnalysisReader(input: Readonly<{
  addReader: (reader: SignalAnalysisReader) => void
  repository: Readonly<{
    listLatestSignalLedgerStates: SignalAnalysisReader['rows']
    getRunsByIds: SignalAnalysisReader['runs']
  }>
  /** 读者自己在设置里关了自动分析。 */
  analysisOffByReader: () => boolean | Promise<boolean>
}>): void {
  input.addReader({
    rows: changeHashes => input.repository.listLatestSignalLedgerStates(changeHashes),
    runs: runIds => input.repository.getRunsByIds(runIds),
    analysisOffByReader: input.analysisOffByReader
  })
}

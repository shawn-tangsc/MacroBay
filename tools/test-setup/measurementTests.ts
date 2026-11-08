/**
 * 测量型用例：断言的是「受控环境下的资源足迹」，不是功能对错。
 *
 * 和几百个功能用例挤在同一个并发池里时，量到的是机器的忙闲程度——同一提交第一次红、重跑就绿
 * （`marketCalendarEventRepository` 的 256MiB 足迹就这么红过）。它们单独成一个 project、串行跑：
 * 仍然是必过断言，只是不再和别人抢 CPU。
 *
 * 不许做的事：删掉、改成警告、把阈值调大。前两个丢掉信号，第三个改尺子。
 *
 * 放在这里而不是 `vitest.config.ts` 里，是因为**测试预算门禁**（`scripts/check-test-budget.mts`）
 * 要按同一份清单把这些文件从「≤15 秒/文件」的口径里排除：两处各写一份，早晚一份改了另一份不知道。
 */
export const MEASUREMENT_TESTS = [
  'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarEventRepository.test.ts',
  'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarStorageReclaim.test.ts',
  'products/market-intelligence/service/intelligence/macro-calendar/bls-ics-manual/blsManualIcsImportService.test.ts',
  // 这条测的是「有界」本身：往 512 条的账本里灌 513 条、每条带 60 个事件键和一段超长摘要，
  // 量的就是上限处的裁剪代价，不是功能对错。单跑三次 4.92s / 7.05s（超时）/ 2.63s，
  // 2.6–7 秒的抖动随机器而定，5 秒默认值下必然偶发红。
  'products/market-intelligence/service/intelligence/macro-calendar/macroCalendarProviderRuntime.test.ts',
  // 通道的「有界清理代价」：同一提交在这台机器量到 780ms / 1107ms，代码路径没动，动的是负载。
  // 断言保留绝对预算（1 秒），但改成同机连续三次取中位，并且串行跑。
  'platform/ai/agent-platform/channels/ChannelInboundPaginationCost.test.ts',
  // 这条扫全仓 import 图（读上千个文件），单跑 1.4 秒、并发时撞 5 秒默认预算：它量的是文件系统，
  // 不是功能。两条都按同一口径进串行池，功能断言仍留在主 run。
  'platform/ai/agent-platform/channels/channelTestSupportBoundary.test.ts',
  // 「10 万条回执 + 1 万条工作项」的分页预算：同机实测 899ms–2552ms，量的是有界扫描的代价。
  // 5 秒默认预算下并发时会撞线，而这条断言要的是绝对预算，不是负载。
  'platform/ai/agent-platform/channels/ChannelInboundService.test.ts',
  // 「5000 条审计上限的清理」：同机单跑 3.2s–16.2s（事件循环被清理页占满），并发下必然超 5 秒。
  // 它量的是清理代价，功能断言另有覆盖。
  'platform/ai/agent-platform/channels/slack/SlackRuntimeManager.test.ts'
] as const

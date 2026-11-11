import IntelligenceRunLogSettingsSection from '../../settings/run-log/index'

/**
 * 配置抽屉「运行日志」那一屏：**设置页那份只读表格的同一块实现**（`variant="embed"`）。
 *
 * 为什么复用而不是复制：它只读——一张带筛选与分页的表格，没有写入口。复制只会让两边的筛选、
 * 分页、失败句各分叉；这和「来源与采集沿用设置页那套」同一个理由。
 *
 * 内嵌版由那个页面自己给（`embed`：不套页外框、不画页边距），这里只负责把它放进抽屉。
 */
export function RunLogDrawerPanel(): React.ReactElement {
  return <IntelligenceRunLogSettingsSection variant="embed" />
}

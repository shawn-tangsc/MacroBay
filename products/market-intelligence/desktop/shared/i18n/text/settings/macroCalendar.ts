/* 只搬位置，不改句子：本条文案归这个文件独占，改之前先看清它属于哪条线。 */
export const macroCalendarText = {
  'zh-CN': {
  title: '宏观日历',
  description: '启用后采集固定的官方日程。',
  loading: '加载中…',
  unavailable: '设置暂不可用，请重试。',
  runNow: '立即运行', testConnection: '测试连接', testingConnection: '正在测试…', connection: { succeeded: '连接已验证。', failed: '无法验证连接，请重试。' },
  schedule: { macro: '每 {hours} 小时在上次完成后运行；启动时补跑一次；可立即运行。' },
  runNowFeedback: { queued: '运行请求已排队，尚未确认采集完成。', skipped: '本次运行未排队，请确认提供方已启用后重试。', failed: '无法提交运行请求，请重试。', 'completed-succeeded': '采集已完成，可打开日历查看刷新后的日程。', 'completed-failed': '采集未成功完成，请查看提供方健康状态后稍后重试。' },
  failureCount: '连续失败',
  lastCompletedAt: '最近完成',
  providers: { 'macro-calendar-fed': 'Federal Reserve Board (Fed)', 'macro-calendar-bea': '美国经济分析局（BEA）' },
  blsCard: { title: '美国劳工统计局（BLS）', description: '官方发布日程与就业数据同步。', status: '官方采集' },
  blsSchedule: {
    action: '同步官方 BLS 日程', pending: '正在同步官方 BLS 日程…',
    feedback: {
      schedule: { updated: '日程已更新', unchanged: '日程已是最新', unavailable: '日程暂不可用' },
      cpi: { updated: 'CPI 值已更新', current: 'CPI 值已是最新', 'not-required': 'CPI 暂无需补抓', unavailable: 'CPI 值暂不可用' },
      employment: { updated: '就业值已更新', current: '就业值已是最新', 'not-required': '就业暂无需补抓', unavailable: '就业值暂不可用' }
    }
  },
  pendingFeeds: { title: '待接入', hint: '尚未接入，不可配置。', coinMarketCal: 'CoinMarketCal' },
  marketCalendar: {
    title: '市场日历', description: '由产品定时任务采集；在与官方日程建立关联前，事件标记为未验证。', refresh: '立即刷新', refreshing: '正在刷新市场日历…', succeeded: '市场日历已刷新。', failed: '市场日历刷新失败。', owner: '市场 · 未验证',
    feeds: { 'macro-calendar-0xrouter-economic-data': '经济数据', 'macro-calendar-0xrouter-financial-events': '金融事件', 'macro-calendar-0xrouter-central-bank-activities': '央行活动' }
  },
  health: { 'never-run': '尚未运行', healthy: '正常', degraded: '需关注', failed: '失败' }
},
  'en-US': {
  title: 'Macro Calendar',
  description: 'Enable fixed official schedule collection.',
  loading: 'Loading…',
  unavailable: 'Settings are unavailable. Try again.',
  runNow: 'Run now', testConnection: 'Test connection', testingConnection: 'Testing…', connection: { succeeded: 'Connection verified.', failed: 'Connection could not be verified. Try again.' },
  schedule: { macro: 'Every {hours} hours after the last completed run; startup catch-up; Run now available.' },
  runNowFeedback: { queued: 'The run request was queued; collection completion is not yet confirmed.', skipped: 'This run was not queued. Confirm the provider is enabled, then try again.', failed: 'The run request could not be submitted. Try again.', 'completed-succeeded': 'Collection completed. Open the calendar to view the refreshed schedule.', 'completed-failed': 'Collection did not complete successfully. Review provider health and try again later.' },
  failureCount: 'Consecutive failures',
  lastCompletedAt: 'Last completed',
  providers: { 'macro-calendar-fed': 'Federal Reserve Board (Fed)', 'macro-calendar-bea': 'Bureau of Economic Analysis (BEA)' },
  blsCard: { title: 'Bureau of Labor Statistics (BLS)', description: 'Official release schedule and employment values.', status: 'Official collection' },
  blsSchedule: {
    action: 'Sync official BLS schedule', pending: 'Syncing the official BLS schedule…',
    feedback: {
      schedule: { updated: 'Schedule updated', unchanged: 'Schedule is current', unavailable: 'Schedule unavailable' },
      cpi: { updated: 'CPI updated', current: 'CPI current', 'not-required': 'CPI not required', unavailable: 'CPI unavailable' },
      employment: { updated: 'Employment updated', current: 'Employment current', 'not-required': 'Employment not required', unavailable: 'Employment unavailable' }
    }
  },
  pendingFeeds: { title: 'Pending connection', hint: 'Not connected yet and not configurable.', coinMarketCal: 'CoinMarketCal' },
  marketCalendar: {
    title: 'Market calendar', description: 'Collected by a product job; events stay unverified until an official link exists.', refresh: 'Refresh now', refreshing: 'Refreshing the market calendar…', succeeded: 'Market calendar refreshed.', failed: 'Market calendar refresh failed.', owner: 'Market · unverified',
    feeds: { 'macro-calendar-0xrouter-economic-data': 'Economic data', 'macro-calendar-0xrouter-financial-events': 'Financial events', 'macro-calendar-0xrouter-central-bank-activities': 'Central bank activities' }
  },
  health: { 'never-run': 'Never run', healthy: 'Healthy', degraded: 'Needs attention', failed: 'Failed' }
}
} as const

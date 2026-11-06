/**
 * 通知文案的**唯一定义**：主进程（发桌面通知前解析）与渲染层（`platformText` re-export）
 * 都从这里取，不各写一份。
 *
 * 为什么记录里存键 + 参数而不是句子（架构师 2026-11-02 裁定）：
 *
 * 1. 同一句话只允许有一处定义——存句子等于在主进程放第二张表；
 * 2. **存句子会让切换语言对历史通知无效**：用户切到英文后，旧通知仍是中文，因为那句话已经
 *    写进记录里了。只有存键，才能做到「切了语言，历史也跟着变」；
 * 3. 桌面通知确实要在主进程发，所以主进程需要文案——但那是**解析器**的需要，不是**存储**的需要。
 */
export type NotificationCopyLanguage = 'zh-CN' | 'en-US'

export type NotificationCopyTable = {
  'notification.taskFailed.title': string
  'notification.taskFailed.body': string
  'notification.taskFailed.open': string
  /** 「今天一共发生过 N 次」；只在合并过（次数 > 1）时出现。 */
  'notification.occurrenceCount': string
  /** 熔断聚合记录的稳定标识；界面按 `collapsedCount` 出文案，不直接显示这句。 */
  'notification.aggregate.title': string
  /**
   * 解析失败的兜底句（平台需求 v2.19 §12 三，逐字）：中心列表、条目详情、桌面通知、应用内提示
   * **四个表面同一句**。它不是任何事件的文案，是「有一件事发生了但我说不清」时唯一能说的话。
   */
  'notification.fallback.title': string
  /** 发送测试通知：只用来验证链路，不描述任何业务事实。 */
  'notification.test.title': string
  'notification.test.body': string
  'notification.event.platform.job.failed-terminal.title': string
  'notification.event.platform.job.failed-terminal.body': string,
  'notification.event.platform.job.failed-terminal.reason': string
  'notification.event.platform.job.repeated-failed.title': string
  'notification.event.platform.job.repeated-failed.body': string,
  'notification.event.platform.job.repeated-failed.reason': string
  'notification.event.platform.analysis.quota-exhausted.title': string
  'notification.event.platform.analysis.quota-exhausted.body': string,
  'notification.event.platform.analysis.quota-exhausted.reason': string
  'notification.event.platform.provider.credential-invalid.title': string
  'notification.event.platform.provider.credential-invalid.body': string,
  'notification.event.platform.provider.credential-invalid.reason': string
  'notification.event.platform.provider.credential-recovered.title': string
  'notification.event.platform.provider.credential-recovered.body': string,
  'notification.event.platform.provider.credential-recovered.reason': string
  'notification.event.platform.channel.push-suspended.title': string
  'notification.event.platform.channel.push-suspended.body': string,
  'notification.event.platform.channel.push-suspended.reason': string
  'notification.event.platform.channel.push-resumed.title': string
  'notification.event.platform.channel.push-resumed.body': string,
  'notification.event.platform.channel.push-resumed.reason': string
  'notification.event.platform.desktop.blocked.title': string
  'notification.event.platform.desktop.blocked.body': string,
  'notification.event.platform.desktop.blocked.reason': string
  'notification.event.platform.channel.connection-lost.title': string
  'notification.event.platform.channel.connection-lost.body.network': string
  'notification.event.platform.channel.connection-lost.body.proxy': string
  'notification.event.platform.channel.connection-lost.reason': string
  'notification.event.platform.analysis.manual-failed.title': string
  'notification.event.platform.analysis.manual-failed.body': string,
  'notification.event.platform.analysis.manual-failed.reason': string
  /**
   * P9 的动作文案。**这条必须和上面三个键一起登记**：动作标签解析不到时投递层会**整条丢掉这个按钮**，
   * 而文案门禁只查标题/正文/理由，查不到这一个——缺了不会红，读者只是发现失败通知里没有入口。
   */
  'notification.event.platform.analysis.manual-failed.open': string
  /** 通道暂停事件里的动作：去设置检查。 */
  'notification.channelCheck.action': string
  /** 通用动作：去设置（来源两条等产品事件的动作标签）。 */
  'notification.action.open-settings': string
  /** 日报失败事件的动作：打开日报。 */
  'notification.action.open-briefing': string
  /** 桌面 / 通道投递的五个原因句（P7 五种可显示事实；S15 逐键 grep）。 */
  'notification.deliveryReason.desktopDisabled': string
  'notification.deliveryReason.pushUnavailable': string
  'notification.deliveryReason.systemUnsupported': string
  'notification.deliveryReason.handedToSystem': string
  'notification.deliveryReason.sendFailedUnknown': string
}

/** 通知文案的键闭集：写错一个键编译不过，不靠评审。 */
export type NotificationCopyKey = keyof NotificationCopyTable

/** 键必须能被这里解析；解析不到就是缺键，不是“回退成原文”。 */
export const notificationCopy: Readonly<Record<NotificationCopyLanguage, NotificationCopyTable>> = Object.freeze({
  'zh-CN': Object.freeze({
    'notification.taskFailed.title': '任务失败：{taskName}',
    'notification.taskFailed.body': '运行过程中出错，这一次没有完成。',
    'notification.taskFailed.open': '打开任务',
    'notification.occurrenceCount': '共 {count} 次',
    'notification.aggregate.title': '同类通知较多',
    'notification.fallback.title': '有一条新通知，点开看详情',
    'notification.test.title': '测试通知',
    'notification.test.body': '如果你看到这条，说明通知管道是通的；桌面通知没弹出，多半是系统没有放行。',
    'notification.event.platform.job.failed-terminal.title': "任务失败：{taskName?}",
    'notification.event.platform.job.failed-terminal.body': "这一次没有跑完。点开可以看到它停在哪一步。",
    'notification.event.platform.job.failed-terminal.reason': '这个任务不会再自动重试，点开可以看到它停在哪一步。',
    'notification.event.platform.job.repeated-failed.title': "任务连续失败",
    'notification.event.platform.job.repeated-failed.body': "{taskName?}已连续 3 次跑到失败；先看清楚它在哪出错，再决定要不要继续跑。",
    'notification.event.platform.job.repeated-failed.reason': '同一个任务连续三次失败，先看清楚它在哪出错，再决定要不要继续跑。',
    'notification.event.platform.analysis.quota-exhausted.title': "今天的分析次数用完了",
    'notification.event.platform.analysis.quota-exhausted.body': "今天已用 {used} 次，上限 {limit} 次；之后再发起分析会被拒绝，已有的报告不受影响。",
    'notification.event.platform.analysis.quota-exhausted.reason': '分析调用到了当天的上限，在那之前发起分析会被拒绝。',
    'notification.event.platform.provider.credential-invalid.title': "{provider} 的密钥失效了",
    'notification.event.platform.provider.credential-invalid.body': "保存的密钥已经不被接受，去设置里重新填一把才能继续调用。",
    'notification.event.platform.provider.credential-invalid.reason': '保存的 Key 已经不被该供应商接受，重新填一把才能继续调用。',
    'notification.event.platform.provider.credential-recovered.title': "{provider} 恢复了",
    'notification.event.platform.provider.credential-recovered.body': "之前被拒的密钥现在能正常调用，不需要再做什么。",
    'notification.event.platform.provider.credential-recovered.reason': '之前被拒的 Key 现在能正常调用，不需要再做什么。',
    'notification.event.platform.channel.push-suspended.title': "已暂停推送到手机",
    'notification.event.platform.channel.push-suspended.body': "这个通道连续 3 次没发出去，30 分钟内不再尝试；到点后第一次发送成功会自动恢复。",
    'notification.event.platform.channel.push-suspended.reason': '这个通道现在发不出消息，等它恢复正常后投递会接着走。',
    'notification.event.platform.channel.push-resumed.title': "推送到手机恢复了",
    'notification.event.platform.channel.push-resumed.body': "通道重新能发消息，之后的推送会照常发出。",
    'notification.event.platform.channel.push-resumed.reason': '之前暂停的通道重新能发消息了。',
    'notification.event.platform.desktop.blocked.title': "桌面通知没有弹出来",
    'notification.event.platform.desktop.blocked.body': "这条本该弹在桌面上，但没有弹出来。",
    'notification.event.platform.desktop.blocked.reason': "桌面通知没有弹出来。",
    'notification.event.platform.channel.connection-lost.title': "频道连不上：{channel}",
    'notification.event.platform.channel.connection-lost.body.network': "自动重连一直没成功，{channel} 现在收不到新消息：这台机器连不上网络。网络恢复后连接会自己接上，不用再点一次启用。",
    'notification.event.platform.channel.connection-lost.body.proxy': "自动重连一直没成功，{channel} 现在收不到新消息：代理这一跳没连上（代理没开、端口不对或隧道被拒）。修好代理后连接会自己接上，不用再点一次启用。",
    'notification.event.platform.channel.connection-lost.reason': '自动重连连续失败才提醒一次，同一次断开不会反复提醒；重新连上后状态行与操作记录里能看到。',
    'notification.event.platform.analysis.manual-failed.title': "你点的那次分析没完成",
    'notification.event.platform.analysis.manual-failed.body': "你刚才点的那次分析没成：{reason}。这次没有产生结论，之前的结果不受影响。",
    'notification.event.platform.analysis.manual-failed.reason': '只有你自己点的那次失败才回一条，同一次运行不会重复提醒；原因和重试入口在运行记录里。',
    'notification.event.platform.analysis.manual-failed.open': '打开运行记录',
    'notification.channelCheck.action': '去设置检查',
    'notification.action.open-settings': '去设置',
    'notification.action.open-briefing': '打开日报',
    'notification.deliveryReason.desktopDisabled': '桌面通知已在设置里关闭',
    'notification.deliveryReason.pushUnavailable': '这条没接通投递通道',
    'notification.deliveryReason.systemUnsupported': '这台系统不支持桌面通知',
    'notification.deliveryReason.handedToSystem': '已推送到系统，未确认显示',
    'notification.deliveryReason.sendFailedUnknown': '发送失败，系统没有给出原因。',
  }),
  'en-US': Object.freeze({
    'notification.taskFailed.title': 'Task failed: {taskName}',
    'notification.taskFailed.body': 'It hit an error and did not finish this run.',
    'notification.taskFailed.open': 'Open task',
    'notification.occurrenceCount': '{count} occurrences',
    'notification.aggregate.title': 'Many similar notifications',
    'notification.fallback.title': 'A new notification arrived — open it for details.',
    'notification.test.title': 'Test notification',
    'notification.test.body': 'If you can see this, the pipeline works; if no desktop banner appeared, the system is probably blocking it.',
    'notification.event.platform.job.failed-terminal.title': "Task failed: {taskName?}",
    'notification.event.platform.job.failed-terminal.body': "This run did not finish. Open it to see which step it stopped at.",
    'notification.event.platform.job.failed-terminal.reason': 'This task will not retry on its own; open it to see which step it stopped at.',
    'notification.event.platform.job.repeated-failed.title': "A task keeps failing",
    'notification.event.platform.job.repeated-failed.body': "{taskName?}has failed three runs in a row; see what it is failing on before it runs again.",
    'notification.event.platform.job.repeated-failed.reason': 'The same task has failed three times in a row; see what it is failing on before it runs again.',
    'notification.event.platform.analysis.quota-exhausted.title': "Today's analysis quota is used up",
    'notification.event.platform.analysis.quota-exhausted.body': "Used {used} of {limit} analyses today; further requests will be refused and existing reports are unaffected.",
    'notification.event.platform.analysis.quota-exhausted.reason': 'Analysis calls have reached the day\'s limit; further requests are refused until it resets.',
    'notification.event.platform.provider.credential-invalid.title': "The key for {provider} stopped working",
    'notification.event.platform.provider.credential-invalid.body': "The saved key is no longer accepted; enter a new one in settings to keep using the provider.",
    'notification.event.platform.provider.credential-invalid.reason': 'The saved key is no longer accepted; enter a new one to keep calling the provider.',
    'notification.event.platform.provider.credential-recovered.title': "The key for {provider} works again",
    'notification.event.platform.provider.credential-recovered.body': "The provider accepts the saved key again; nothing needs doing.",
    'notification.event.platform.provider.credential-recovered.reason': 'The provider accepts the saved key again; nothing needs doing.',
    'notification.event.platform.channel.push-suspended.title': "Sending to your phone is paused",
    'notification.event.platform.channel.push-suspended.body': "This channel failed three times in a row; no attempts for 30 minutes. The first successful send after that resumes it.",
    'notification.event.platform.channel.push-suspended.reason': 'This channel cannot send right now; delivery continues once it works again.',
    'notification.event.platform.channel.push-resumed.title': "Sending to your phone is back",
    'notification.event.platform.channel.push-resumed.body': "The channel can send again; later notifications go through as usual.",
    'notification.event.platform.channel.push-resumed.reason': 'The channel that was paused can send messages again.',
    'notification.event.platform.desktop.blocked.title': "The desktop notification did not appear",
    'notification.event.platform.desktop.blocked.body': "This was supposed to show up on your desktop, but it did not.",
    'notification.event.platform.desktop.blocked.reason': "The desktop notification did not appear.",
    'notification.event.platform.channel.connection-lost.title': "Channel unreachable: {channel}",
    'notification.event.platform.channel.connection-lost.body.network': "Automatic reconnection has kept failing, so {channel} is not receiving new messages: this machine cannot reach the network. The connection reconnects by itself once the network is back, so you do not need to enable it again.",
    'notification.event.platform.channel.connection-lost.body.proxy': "Automatic reconnection has kept failing, so {channel} is not receiving new messages: the proxy hop could not be reached (proxy off, wrong port, or tunnel refused). The connection reconnects by itself once the proxy is fixed, so you do not need to enable it again.",
    'notification.event.platform.channel.connection-lost.reason': 'Shown once after automatic reconnection fails; one outage never repeats, and the status row shows it once the channel reconnects.',
    'notification.event.platform.analysis.manual-failed.title': 'The analysis you started did not finish',
    'notification.event.platform.analysis.manual-failed.body': 'The analysis you started did not finish: {reason}. Nothing was published this time, and earlier results are unaffected.',
    'notification.event.platform.analysis.manual-failed.reason': 'Only a failure of a run you started yourself is reported, once per run; the cause and a retry are in the run log.',
    'notification.event.platform.analysis.manual-failed.open': 'Open run log',
    'notification.channelCheck.action': 'Check settings',
    'notification.action.open-settings': 'Open settings',
    'notification.action.open-briefing': 'Open briefing',
    'notification.deliveryReason.desktopDisabled': 'Desktop notifications are turned off in settings.',
    'notification.deliveryReason.pushUnavailable': 'This notification has no delivery channel connected.',
    'notification.deliveryReason.systemUnsupported': 'This system does not support desktop notifications.',
    'notification.deliveryReason.handedToSystem': 'Handed to the system; display is unconfirmed.',
    'notification.deliveryReason.sendFailedUnknown': 'Sending failed and the system gave no reason.',
  })
})

/**
 * 解析一句文案。`{name}` 占位缺参时**保留原样可见**——删掉会得到「任务失败：」这种读得通
 * 但指错对象的话；保留占位至少能看出哪里缺了。
 */
export function resolveNotificationCopyText(
  language: NotificationCopyLanguage,
  template: string,
  params: Readonly<Record<string, string>> = {}
): string {
  return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => params[name] ?? placeholder)
}

export function notificationCopyText(language: NotificationCopyLanguage, key: keyof NotificationCopyTable): string {
  return notificationCopy[language][key]
}

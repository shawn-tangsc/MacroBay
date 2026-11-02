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
  /** 熔断聚合记录的稳定标识；界面按 `collapsedCount` 出文案，不直接显示这句。 */
  'notification.aggregate.title': string
  /** 发送测试通知：只用来验证链路，不描述任何业务事实。 */
  'notification.test.title': string
  'notification.test.body': string
  'notification.event.platform.job.failed-terminal.title': string
  'notification.event.platform.job.failed-terminal.reason': string
  'notification.event.platform.job.repeated-failed.title': string
  'notification.event.platform.job.repeated-failed.reason': string
  'notification.event.platform.analysis.quota-exhausted.title': string
  'notification.event.platform.analysis.quota-exhausted.reason': string
  'notification.event.platform.provider.credential-invalid.title': string
  'notification.event.platform.provider.credential-invalid.reason': string
  'notification.event.platform.provider.credential-recovered.title': string
  'notification.event.platform.provider.credential-recovered.reason': string
  'notification.event.platform.channel.push-suspended.title': string
  'notification.event.platform.channel.push-suspended.reason': string
  'notification.event.platform.channel.push-resumed.title': string
  'notification.event.platform.channel.push-resumed.reason': string
  'notification.event.platform.desktop.blocked.title': string
  'notification.event.platform.desktop.blocked.reason': string
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
    'notification.aggregate.title': '同类通知较多',
    'notification.test.title': '测试通知',
    'notification.test.body': '如果你看到这条，说明通知管道是通的；桌面通知没弹出，多半是系统没有放行。',
    'notification.event.platform.job.failed-terminal.title': '任务已停止',
    'notification.event.platform.job.failed-terminal.reason': '这个任务不会再自动重试，点开可以看到它停在哪一步。',
    'notification.event.platform.job.repeated-failed.title': '任务连续失败',
    'notification.event.platform.job.repeated-failed.reason': '同一个任务连续三次失败，先看清楚它在哪出错，再决定要不要继续跑。',
    'notification.event.platform.analysis.quota-exhausted.title': '今天的分析额度用完了',
    'notification.event.platform.analysis.quota-exhausted.reason': '分析调用到了当天的上限，在那之前发起分析会被拒绝。',
    'notification.event.platform.provider.credential-invalid.title': '供应商拒绝了这把 Key',
    'notification.event.platform.provider.credential-invalid.reason': '保存的 Key 已经不被该供应商接受，重新填一把才能继续调用。',
    'notification.event.platform.provider.credential-recovered.title': 'Key 恢复可用了',
    'notification.event.platform.provider.credential-recovered.reason': '之前被拒的 Key 现在能正常调用，不需要再做什么。',
    'notification.event.platform.channel.push-suspended.title': '通道投递已暂停',
    'notification.event.platform.channel.push-suspended.reason': '这个通道现在发不出消息，等它恢复正常后投递会接着走。',
    'notification.event.platform.channel.push-resumed.title': '通道投递恢复了',
    'notification.event.platform.channel.push-resumed.reason': '之前暂停的通道重新能发消息了。',
    'notification.event.platform.desktop.blocked.title': '系统不允许桌面通知',
    'notification.event.platform.desktop.blocked.reason': '系统设置里关掉了本应用的桌面通知，应用内的提醒不受影响。',
    'notification.deliveryReason.desktopDisabled': '桌面通知已在设置里关闭',
    'notification.deliveryReason.pushUnavailable': '这条没接通投递通道',
    'notification.deliveryReason.systemUnsupported': '这台系统不支持桌面通知',
    'notification.deliveryReason.handedToSystem': '已推送到系统，未确认显示',
    'notification.deliveryReason.sendFailedUnknown': '发送失败，原因没有上报',
  }),
  'en-US': Object.freeze({
    'notification.taskFailed.title': 'Task failed: {taskName}',
    'notification.taskFailed.body': 'It hit an error and did not finish this run.',
    'notification.taskFailed.open': 'Open task',
    'notification.aggregate.title': 'Many similar notifications',
    'notification.test.title': 'Test notification',
    'notification.test.body': 'If you can see this, the pipeline works; if no desktop banner appeared, the system is probably blocking it.',
    'notification.event.platform.job.failed-terminal.title': 'A task has stopped',
    'notification.event.platform.job.failed-terminal.reason': 'This task will not retry on its own; open it to see which step it stopped at.',
    'notification.event.platform.job.repeated-failed.title': 'A task keeps failing',
    'notification.event.platform.job.repeated-failed.reason': 'The same task has failed three times in a row; see what it is failing on before it runs again.',
    'notification.event.platform.analysis.quota-exhausted.title': 'Today\'s analysis quota is used up',
    'notification.event.platform.analysis.quota-exhausted.reason': 'Analysis calls have reached the day\'s limit; further requests are refused until it resets.',
    'notification.event.platform.provider.credential-invalid.title': 'The provider rejected the key',
    'notification.event.platform.provider.credential-invalid.reason': 'The saved key is no longer accepted; enter a new one to keep calling the provider.',
    'notification.event.platform.provider.credential-recovered.title': 'The key works again',
    'notification.event.platform.provider.credential-recovered.reason': 'The provider accepts the saved key again; nothing needs doing.',
    'notification.event.platform.channel.push-suspended.title': 'Channel delivery is paused',
    'notification.event.platform.channel.push-suspended.reason': 'This channel cannot send right now; delivery continues once it works again.',
    'notification.event.platform.channel.push-resumed.title': 'Channel delivery is back',
    'notification.event.platform.channel.push-resumed.reason': 'The channel that was paused can send messages again.',
    'notification.event.platform.desktop.blocked.title': 'System settings block desktop notifications',
    'notification.event.platform.desktop.blocked.reason': 'Desktop notifications for this app are off in system settings; in-app reminders are unaffected.',
    'notification.deliveryReason.desktopDisabled': 'Desktop notifications are turned off in settings.',
    'notification.deliveryReason.pushUnavailable': 'This notification has no delivery channel connected.',
    'notification.deliveryReason.systemUnsupported': 'This system does not support desktop notifications.',
    'notification.deliveryReason.handedToSystem': 'Handed to the system; display is unconfirmed.',
    'notification.deliveryReason.sendFailedUnknown': 'Sending failed and the reason was not reported.',
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

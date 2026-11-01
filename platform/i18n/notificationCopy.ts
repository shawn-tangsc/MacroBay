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
}

/** 通知文案的键闭集：写错一个键编译不过，不靠评审。 */
export type NotificationCopyKey = keyof NotificationCopyTable

/** 键必须能被这里解析；解析不到就是缺键，不是“回退成原文”。 */
export const notificationCopy: Readonly<Record<NotificationCopyLanguage, NotificationCopyTable>> = Object.freeze({
  'zh-CN': Object.freeze({
    'notification.taskFailed.title': '任务失败：{taskName}',
    'notification.taskFailed.body': '运行过程中出错，这一次没有完成。',
    'notification.taskFailed.open': '打开任务',
    'notification.aggregate.title': '同类通知较多'
  }),
  'en-US': Object.freeze({
    'notification.taskFailed.title': 'Task failed: {taskName}',
    'notification.taskFailed.body': 'It hit an error and did not finish this run.',
    'notification.taskFailed.open': 'Open task',
    'notification.aggregate.title': 'Many similar notifications'
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

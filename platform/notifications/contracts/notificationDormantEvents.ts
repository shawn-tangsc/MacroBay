/**
 * 本版**明确不发**的事件（契约 §12.1 的 `dormant`）。
 *
 * 一条事件被登记、被批准、却没有任何代码提交它，就是一个永远不响的入口——今晚已经栽过四次
 * （额度、凭据失效/恢复、桌面没弹出来）。所以「不发」必须显式写在这里，并回答三件事：
 * 谁认领、为什么现在不发、什么条件复活。
 *
 * **不许写布尔**：写个 `true` 等于给「我不想写生产者」开后门。
 * 现在 16 条事件全部有生产者，所以这张表是空的——空表本身也是一种断言。
 */
export type DormantNotificationEvent = {
  /** 认领这条事件的产品或线，写具体名字，不许写「平台」。 */
  owner: string
  /** 为什么现在不发（一句话，写事实不写计划）。 */
  reason: string
  /** 什么条件下复活（可判定的条件，不许写「以后再说」）。 */
  reviveWhen: string
}

export const DORMANT_NOTIFICATION_EVENTS: Readonly<Record<string, DormantNotificationEvent>> = Object.freeze({})

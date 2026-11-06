import { navigateTo } from '@platform/workspace/navigation/navigationRequest'

/**
 * 「去对话」的唯一入口（R87）。
 *
 * 事件契约（照 `openModelServiceSettings` 的形态写死）：`app-shell:navigate`，detail 只有两种：
 *
 * | 目的地 | detail | 谁需要 |
 * |---|---|---|
 * | 智能体对话页 | `{ navKey: 'agents' }` | 任务自动化「还没有任务」——任务在那里建 |
 * | AI 助手页 | `{ navKey: 'assistants' }`，带话题时多一个 `assistant: { assistantId, topicId }` | 「打开助手」类动作 |
 *
 * **不要把目的地写成 `settings` 或别的页**：这条路只回答「读者下一步要去跟谁说话」。要某人的
 * 设置页走 `openProductSettingsPanel`，要内置设置页走平台 `navigateTo`。
 *
 * 为什么包一层而不让调用点自己 `dispatchEvent`：detail 形状是壳层的内部约定（`AppShell` 的
 * `applyNavigation`），调用点每抄一次就多一份会漂的副本；`openConversation` 与
 * `openProductSettingsPanel` 是它的两个具名出口，写错了在这里红，不在别人的点击里静默。
 */
export type ConversationTarget =
  | { page: 'agents' }
  | { page: 'assistants'; assistant?: Readonly<{ assistantId: string; topicId: string }> }

/** 默认去智能体对话页：任务自动化那四处空态的下一步就是「去对话让助手建任务」。 */
export function openConversation(target: ConversationTarget = { page: 'agents' }): void {
  if (target.page === 'agents') {
    navigateTo({ page: 'agents' })
    return
  }
  navigateTo(
    target.assistant === undefined
      ? { page: 'assistants' }
      : { page: 'assistants', assistant: target.assistant }
  )
}

import type { SelectProps } from 'antd'

/**
 * 任务自动化里筛选/状态/策略控件的固定宽度。
 * 宽度必须与选中值无关（否则 antd Select 会按内容自适应，切换选项就抖动、弹层也被压缩成「全…」）。
 * 数值与 `styles.css` 中的类一一对应，由 `taskAutomationControlWidths.test.ts` 守护。
 */
export const TASK_AUTOMATION_CONTROL_WIDTHS = {
  /** 名称搜索 Input：资源任务与我的定时任务共用。 */
  name: 240,
  source: 220,
  registration: 150,
  status: 150,
  policy: 180
} as const

export const TASK_AUTOMATION_CONTROL_CLASSES = {
  name: 'task-automation-search',
  source: 'task-automation-filter-source',
  registration: 'task-automation-filter-registration',
  status: 'task-automation-filter-status',
  policy: 'task-automation-filter-policy'
} as const

export const TASK_AUTOMATION_SOURCE_POPUP_CLASS = 'task-automation-filter-source-popup'

/**
 * 来源下拉弹层：`popupMatchSelectWidth={false}` 让弹层按内容测宽（长产品名不被压成省略号），
 * `minWidth` 保证它至少与 220px 的触发器同宽，不会出现比触发器更窄的弹层。
 */
export const TASK_AUTOMATION_SOURCE_POPUP_PROPS = {
  popupMatchSelectWidth: false,
  classNames: { popup: { root: TASK_AUTOMATION_SOURCE_POPUP_CLASS } },
  styles: { popup: { root: { minWidth: TASK_AUTOMATION_CONTROL_WIDTHS.source } } }
} satisfies SelectProps

import { useCallback } from 'react'

import type { AppLanguage } from '../../../settings/schema/appSettings'
import { useShellLanguage } from '../../shell/ShellLanguageContext'
import { STATE_VIEW_TEXT_KEYS, type StateViewTextKey } from './StateView'

/**
 * `ui.state.*` 的唯一一处拥有者（架构师 2026-11-02 裁定）：**句子归 `platform/ui`**。
 *
 * 这份文案原先住在 `apps/desktop-shell` 的 `platformText.ts`，而组件在 `platform/ui`——
 * 产品要一句状态文案，只能去 app 层借解析函数，借不到就自己抄一份键表。三家同时卡在这里不是
 * 巧合：**拥有者和使用者隔着一条依赖方向**。所以键表连句子一起搬进来，组件、hook、产品读同一份。
 *
 * 规矩：
 * - 未知键返回**空串**，不回退键名：回退键名会把 `ui.state.empty.reason.not-yet` 念给读屏用户。
 *   空串时调用方整条不渲染，缺键在测试里现形。
 * - 句子只写在这张表里，产品与组件都不造句；`ui.state.` 字面量也不许出现在 `apps/`、`products/`
 *   下（守卫拦着），要引用就取这里的常量。
 */

/** 动作键常量表：产品给 `action.labelKey` 时从这里取，不写字面量。 */
export const STATE_VIEW_ACTION_KEYS = {
  create: 'ui.state.action.create',
  clear_filter: 'ui.state.action.clear-filter',
  bind_target: 'ui.state.action.bind-target',
  enable: 'ui.state.action.enable',
  retry: 'ui.state.action.retry',
  check_source: 'ui.state.action.check-source',
  install: 'ui.state.action.install',
  save: 'ui.state.action.save',
  open_settings: 'ui.state.action.open-settings',
  select_target: 'ui.state.action.select-target',
  restart_app: 'ui.state.action.restart-app',
  open_system_settings: 'ui.state.action.open-system-settings',
  widen_time_window: 'ui.state.action.widen-time-window',
  focus_form: 'ui.state.action.focus-form',
  open_assistant: 'ui.state.action.open-assistant'
} as const

type StateViewCopy = Record<StateViewTextKey, string>

const ZH_CN: StateViewCopy = {
      'ui.state.loading': '正在加载',
      'ui.state.empty': '这里还没有内容',
      'ui.state.empty.reason.never-created': '从来没有创建过，先创建一个',
      'ui.state.empty.reason.filtered-out': '有数据，但被当前筛选挡住了',
      'ui.state.empty.reason.no-target-bound': '目标还没有绑定，先绑定一个',
      'ui.state.empty.reason.nothing-enabled': '一个都还没有启用，先启用一个',
      'ui.state.empty.reason.none-installed': '你还没有添加过任何一项',
      'ui.state.empty.reason.no-target-selected': '还没有选中一个目标，先选一个',
      'ui.state.empty.reason.not-yet': '还没有发生过；等有数据进来后这里就会出现',
      'ui.state.empty.reason.older-than-window': '有数据，但都在这段时间之外',
      'ui.state.empty.reason.nothing-in-window': '这段时间里确实没有记录',
      'ui.state.error': '读取失败',
      'ui.state.error.reason.unreadable': '数据没有读出来，可以重试',
      'ui.state.error.reason.unavailable': '数据源本身不可用，先检查来源设置',
      'ui.state.error.reason.operation-failed': '这次操作没有成功，可以重试',
      'ui.state.error.reason.needs-restart': '需要重启应用之后才能继续',
      'ui.state.disabled': '这个功能当前不可用',
      'ui.state.disabled.reason.capability-not-wired': '这项能力平台侧还没接通，不是你的问题；现在没有可做的操作',
      'ui.state.disabled.reason.target-disabled': '目标已经被停用，先重新启用',
      'ui.state.disabled.reason.precondition-unsaved': '还没有保存，保存之后才能配置',
      'ui.state.permission': '没有查看权限',
      'ui.state.permission.reason.not-granted': '这项由系统设置控制，要在系统设置里开启',
      'ui.state.error.details': '技术详情',
      'ui.state.action.create': '创建',
      'ui.state.action.clear-filter': '清除筛选',
      'ui.state.action.bind-target': '去绑定',
      'ui.state.action.enable': '去启用',
      'ui.state.action.retry': '重试',
      'ui.state.action.check-source': '检查来源',
      'ui.state.action.install': '去安装',
      'ui.state.action.save': '保存 agent',
      'ui.state.action.open-settings': '打开设置',
      'ui.state.action.select-target': '选择目标',
      'ui.state.action.restart-app': '重启应用',
      'ui.state.action.open-system-settings': '去系统设置',
      'ui.state.action.widen-time-window': '扩大时间范围',
      'ui.state.action.focus-form': '填写表单',
      'ui.state.action.open-assistant': '打开助手',
}

const EN_US: StateViewCopy = {
      'ui.state.loading': 'Loading',
      'ui.state.empty': 'Nothing here yet',
      'ui.state.empty.reason.never-created': 'Nothing has ever been created — create one first',
      'ui.state.empty.reason.filtered-out': 'There is data, but the current filter hides it',
      'ui.state.empty.reason.no-target-bound': 'No target is bound yet — bind one first',
      'ui.state.empty.reason.nothing-enabled': 'Nothing is enabled yet — enable one first',
      'ui.state.empty.reason.none-installed': 'You have not added any yet',
      'ui.state.empty.reason.no-target-selected': 'No target is selected yet — pick one',
      'ui.state.empty.reason.not-yet': 'This has not happened yet; it appears here once data arrives',
      'ui.state.empty.reason.older-than-window': 'There is data, but all of it falls outside this time range',
      'ui.state.empty.reason.nothing-in-window': 'There really are no records in this time range',
      'ui.state.error': 'Could not read',
      'ui.state.error.reason.unreadable': 'The data could not be read — you can retry',
      'ui.state.error.reason.unavailable': 'The data source itself is unavailable — check the source settings',
      'ui.state.error.reason.operation-failed': 'That action did not go through — you can retry',
      'ui.state.error.reason.needs-restart': 'The app needs a restart before this can continue',
      'ui.state.disabled': 'This is not available right now',
      'ui.state.disabled.reason.capability-not-wired': 'This capability is not wired up on the platform side yet; nothing is wrong on your side, and there is nothing to do here',
      'ui.state.disabled.reason.target-disabled': 'The target is turned off — turn it back on',
      'ui.state.disabled.reason.precondition-unsaved': 'Not saved yet — save it first, then you can configure it',
      'ui.state.permission': 'No permission to view',
      'ui.state.permission.reason.not-granted': 'This is controlled by system settings; turn it on there',
      'ui.state.error.details': 'Details',
      'ui.state.action.create': 'Create',
      'ui.state.action.clear-filter': 'Clear filter',
      'ui.state.action.bind-target': 'Bind a target',
      'ui.state.action.enable': 'Enable',
      'ui.state.action.retry': 'Retry',
      'ui.state.action.check-source': 'Check source',
      'ui.state.action.install': 'Install',
      'ui.state.action.save': 'Save the agent',
      'ui.state.action.open-settings': 'Open settings',
      'ui.state.action.select-target': 'Choose a target',
      'ui.state.action.restart-app': 'Restart the app',
      'ui.state.action.open-system-settings': 'Open system settings',
      'ui.state.action.widen-time-window': 'Widen the time range',
      'ui.state.action.focus-form': 'Fill in the form',
      'ui.state.action.open-assistant': 'Open the assistant',
}

const COPY: Record<AppLanguage, StateViewCopy> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

/** 纯函数：给定语言与键返回句子；未登记的键返回空串（不回退键名）。 */
export function resolveStateViewText(language: AppLanguage, key: StateViewTextKey): string {
  return COPY[language]?.[key] ?? ''
}

/**
 * 产品与组件取状态文案的唯一入口。语言取自 `ShellLanguageProvider`（壳层已提供），
 * 产品不许自己传语言参数，也不许自带键表。
 */
export function useStateViewText(): (key: StateViewTextKey) => string {
  const language = useShellLanguage()
  return useCallback((key: StateViewTextKey) => resolveStateViewText(language, key), [language])
}

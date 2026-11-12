import { useCallback } from 'react'

import type { AppLanguage } from '../../../settings/schema/appSettings'
import { useShellLanguage } from '../../shell/ShellLanguageContext'

/**
 * `helpTrigger` 自己的文案表，就一句：那颗 ⓘ 的读屏名。
 *
 * 为什么在组件旁边而不在 `apps/desktop-shell` 的 `platformText.ts`：句子归 `platform/ui`。
 * `ui.state.*` 与 `ui.drawer.close` 都按这个结构落在组件目录（组件与产品读同一份），
 * 这里沿用，理由不重复第二遍。
 *
 * 为什么不再让调用方把句子塞进来：那颗按钮是**同一个动作**（打开说明），名字就该是同一句
 * 「查看说明」；以前 `helpTrigger` 用一个自造的 `resolveText` 把浮层正文当成按钮名，
 * 于是同一个 ⓘ 在不同页面读出不同的话，而键 `ui.help.trigger` 实际在任何文案表里都不存在。
 */

export const HELP_TRIGGER_KEY = 'ui.help.trigger' as const

type HelpTriggerTextKey = typeof HELP_TRIGGER_KEY

const ZH_CN: Record<HelpTriggerTextKey, string> = { 'ui.help.trigger': '查看说明' }
const EN_US: Record<HelpTriggerTextKey, string> = { 'ui.help.trigger': 'Show details' }

const COPY: Record<AppLanguage, Record<HelpTriggerTextKey, string>> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

/**
 * 纯函数：给定语言返回 ⓘ 的读屏名。**不认识键就取那句平台句，绝不返回空串**——
 * 这个名字是那颗按钮唯一的名字，空串等于一个没有名字的按钮。
 * 收 `string` 是为了能直接交给 `IconButton.resolveText`（它的签名是 `(key: string) => string`）。
 */
export function resolveHelpTriggerText(language: AppLanguage, key: string = HELP_TRIGGER_KEY): string {
  return COPY[language]?.[key as HelpTriggerTextKey] ?? ZH_CN[HELP_TRIGGER_KEY]
}

/** 组件自己用的入口：语言取自壳层，调用方不传、也不许覆盖。 */
export function useHelpTriggerText(): (key: string) => string {
  const language = useShellLanguage()
  return useCallback((key: string) => resolveHelpTriggerText(language, key), [language])
}

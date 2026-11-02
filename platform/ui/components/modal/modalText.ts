import { useCallback } from 'react'

import type { AppLanguage } from '../../../settings/schema/appSettings'
import { useShellLanguage } from '../../shell/ShellLanguageContext'

/**
 * 弹窗自己的文案表，就一句：关闭键的读屏名。
 *
 * 与 `drawer/drawerText.ts` 同结构、同理由：句子归 `platform/ui`，组件内不 import 壳层的
 * `platformText`，也不从调用方的 `resolveText` 借。关闭键是按钮**唯一的名字**，而调用方的
 * 解析器对未知键按约定返回空串——走那条路，按钮就会没有名字。
 */

export const MODAL_CLOSE_KEY = 'ui.modal.close' as const

type ModalTextKey = typeof MODAL_CLOSE_KEY

const ZH_CN: Record<ModalTextKey, string> = { 'ui.modal.close': '关闭弹窗' }
const EN_US: Record<ModalTextKey, string> = { 'ui.modal.close': 'Close dialog' }

const COPY: Record<AppLanguage, Record<ModalTextKey, string>> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

/** 纯函数：给定语言返回关闭键的读屏名。兜底取中文，不会返回空串。 */
export function resolveModalText(language: AppLanguage, key: ModalTextKey = MODAL_CLOSE_KEY): string {
  return COPY[language]?.[key] ?? ZH_CN[MODAL_CLOSE_KEY]
}

/** 组件自己用的入口：语言取自壳层，调用方不传、也不许覆盖。 */
export function useModalText(): (key?: ModalTextKey) => string {
  const language = useShellLanguage()
  return useCallback((key: ModalTextKey = MODAL_CLOSE_KEY) => resolveModalText(language, key), [language])
}

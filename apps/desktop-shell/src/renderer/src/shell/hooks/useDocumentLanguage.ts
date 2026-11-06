import { useEffect } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'

/**
 * `<html lang>` 跟着界面语言走：**一处设置，壳层根上写一次**。
 *
 * 为什么必须有：`index.html` 里写死了 `zh-CN`，切到英文界面后内容变英文、这个属性却没人改，
 * 读屏就会拿中文语音念英文句子，断行与拼写检查也跟着错。属性说一种语言、内容说另一种，
 * 验收时还会把人引到错误的结论上（曾经据此误判「中文界面出了英文文案」）。
 *
 * 为什么是 hook 而不是壳层里的一段 effect：壳层根是体积基线文件（只减不增），
 * 这条行为本身只有一处、也不依赖壳层的任何状态，放这里既守住门禁也守住「一处设置」。
 */
export function useDocumentLanguage(language: AppLanguage): void {
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
}

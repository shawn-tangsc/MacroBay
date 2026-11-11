import { ChevronRight } from 'lucide-react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import './processingEntryCard.css'

/**
 * 「采集与数据 › 舆情」右边那张**入口卡**：整卡可点，打开配置抽屉的「内容处理」那一屏
 * （用户 2026-11-12：「舆情下面有个卡片，做跳转就行了」；界面设计 2026-11-12 签字）。
 *
 * 为什么不是把两块设置搬进来：翻译偏好与情绪评分都是**全局单份**设置，且属于另一屏的分区；
 * 这里只回答两件事——**这是什么**（翻译偏好、情绪评分）、**点它去哪**（整卡可点 → 内容处理屏）。
 * 范围解释留在目的屏，卡上只用「全局」两个字承担，不挂 ⓘ（整卡可点时 ⓘ 会变成嵌套可点元素）。
 *
 * 交互只有**一个**：整卡 `role="button"` + `tabIndex=0` + Enter/Space，卡内可聚焦元素为 0。
 * 跳转走宿主给的现成回调（页面层就是 `openConfigDrawer({ menu: 'processing' })`），不新开通道。
 */
export function ProcessingEntryCard({ onOpen }: Readonly<{ onOpen: () => void }>): React.ReactElement {
  const language = useShellLanguage()
  const copy = productText[language].pages.intelligence.portal.dashboard.configDrawer
  const translation = productText[language].settings.intelligenceSources.translationPreferences
  return <section
    aria-label={copy.processingEntryAria}
    className="business-card business-card--entry"
    data-business-card="processing-entry"
    onClick={onOpen}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    }}
    role="button"
    style={{ ['--module-span' as string]: 1 }}
    tabIndex={0}>
    <div className="business-card__title">
      {copy.menus.processing}
      <span className="business-card__entry-scope">{copy.scopeGlobal}</span>
      <ChevronRight aria-hidden="true" className="business-card__entry-chevron" size={13} />
    </div>
    {/* 卡体两行**纯文本**：字段名就是这两块设置本身，不加箭头、不加控件。 */}
    <div className="business-card__entry-fields">
      <span className="business-card__entry-field">{translation.title}</span>
      <span className="business-card__entry-field">{copy.groups.sentimentScoring}</span>
    </div>
  </section>
}
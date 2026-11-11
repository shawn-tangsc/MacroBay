import { ChevronRight } from 'lucide-react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import './processingEntryRow.css'

/**
 * 「采集与数据 › 舆情」卡内部、四个源行之后的一行收尾：**整行可点**，打开配置抽屉的「内容处理」屏
 * （用户 2026-11-11 改判：不再是网格里的一张小卡，而是这张卡自己的一行；界面设计定形态）。
 *
 * 一行只回答「去哪」：左「内容处理」+ 11/muted 的辅助词「翻译偏好 · 情绪评分」+ 右端箭头；
 * 辅助词单行、窄了省略号截断。不画边框/圆角/底色，只有上缘一条发丝线与整行淡底悬停——和卡里
 * 其它行同一家族。
 *
 * 交互只有**一个**：整行 `role="button"` + `tabIndex=0` + Enter/Space，行内可聚焦元素 0。
 * 跳转走宿主给的现成回调（页面层就是 `openConfigDrawer({ menu: 'processing' })`），不新开通道。
 */
export function ProcessingEntryRow({ onOpen }: Readonly<{ onOpen: () => void }>): React.ReactElement {
  const language = useShellLanguage()
  const copy = productText[language].pages.intelligence.portal.dashboard.configDrawer
  return <div
    aria-label={copy.processingEntryAria}
    className="business-card__processing-entry"
    data-processing-entry="true"
    onClick={onOpen}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen()
    }}
    role="button"
    tabIndex={0}>
    <span className="business-card__processing-entry-title">{copy.menus.processing}</span>
    {/* 辅助词是两块设置的**字段名**，一个字面量都没有：两个键 + 一个分隔符。
        不合成一句 `…Hint` 文案——那会被正文说明句门禁判成说明（键名自己承认是 Hint），
        而这里要说的确实是「有哪两块」，不是解释。 */}
    <span className="business-card__processing-entry-hint">{copy.groups.translation} · {copy.groups.sentimentScoring}</span>
    <ChevronRight aria-hidden="true" className="business-card__processing-entry-chevron" size={13} />
  </div>
}

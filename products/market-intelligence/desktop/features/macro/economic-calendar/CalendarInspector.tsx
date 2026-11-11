import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { resolvePanelText } from '@platform/ui/components/side-panel'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'

/**
 * The event detail as a **platform drawer** — the shell only, no styles of its own.
 *
 * 用户 2026-11-11：承载方式从「新页面 / 独立详情」改成抽屉，**里面的样子必须和原来一模一样**。
 * 所以这里不摆任何字段：正文仍是 `CalendarDetailSurface` 那一份（`EconomicCalendarEventDetail`），
 * 这个文件只决定它被装进哪只抽屉——`contentPadding: 'flush'` 不引入新内距，标题沿用同一把键，
 * 宽度归平台四档（`size="large"` 640，超宽屏 `94vw` 由组件里那张表定，调用点不写宽度）。
 *
 * 为什么 `inline` 而不是 `modal`：读者打开详情是为了**对着日历读**，所以日历要留在背后、可点，
 * 点另一行就是换内容。`modal` 会加遮罩并锁焦点，与需求相反。`inline` 的三条焦点规则由平台抽屉
 * 给：打开不动焦点、Esc 挂在 document、关闭不动焦点——最后一条正是这里的责任：读者 Tab 进抽屉后
 * 按 Esc 闭合，焦点会落到 body，所以关闭时由**宿主**把焦点还给被点的那一行（`returnFocusTo`）。
 * 抽屉自己不去猜锚点：那一行在日历页和看板卡上不是同一个元素。
 *
 * 覆盖层（不进流）由 `economicCalendar.css` 的 `.mi-calendar-detail-layer` 给：抽屉是绝对定位的
 * 覆盖层而不是网格子项，所以开/关不会改变七列周视图的列宽（R34）。
 */

/** 一档形态，调用点不许各写一份：宽度取平台 `large`，位置在左，无遮罩。 */
export const CalendarDetailPanelPolicy = Object.freeze({ mode: 'inline' as const, side: 'left' as const, size: 'large' as const })

/** One title for both entry points (this page and the dashboard's calendar card). */
const DETAIL_TITLE_KEY = 'pages.intelligence.portal.calendar.details.title'

/**
 * 播报句沿用平台侧面板那一句（「当前显示：{title}（{when}）」）：同一件事只有一句文案，
 * 抽屉换了个壳不换说法。键由 `resolvePanelText` 解析，不在这里写句子。
 */
const SHOWING_KEY = 'ui.panel.showing' as const

/** 播报去抖：连点三条只播最后一条。 */
const ANNOUNCE_DEBOUNCE_MS = 400

export function CalendarInspector({ open, contentId, when, onClose, returnFocusTo, children }: {
  open: boolean
  contentId?: string
  when?: string
  onClose: () => void
  /**
   * 焦点归还：抽屉关闭时把焦点还给「被点的那一行」。**由宿主给**——那一行在本页是日历的行，
   * 在看板是卡上的行，抽屉不猜。不给就只关闭（`inline` 本来也不抢焦点）。
   */
  returnFocusTo?: (contentId: string) => HTMLElement | null
  children: ReactNode
}): ReactElement | null {
  const resolveText = useProductTextKey()
  // 播报：`inline` 不移动焦点，读屏就收不到「内容变了」，所以由抽屉自己播一句，只播标题与时刻。
  // 按 `contentId` 判重（标题只用来播）：同一场会议一天两行，按标题判重就会漏播。
  const [announcement, setAnnouncement] = useState('')
  const announcedId = useRef<string | null>(null)
  const showingLabel = resolvePanelText(useShellLanguage(), SHOWING_KEY)
  const titleRef = useRef('')
  titleRef.current = resolveText(DETAIL_TITLE_KEY)
  useEffect(() => {
    if (!open) {
      // 重开是新的一轮：复位门闩，否则关闭再打开同一条会一声不响。
      announcedId.current = null
      return
    }
    if (contentId === undefined) return
    if (announcedId.current === contentId) return
    const timer = setTimeout(() => {
      announcedId.current = contentId
      setAnnouncement(fillLabelParams(showingLabel, { title: titleRef.current, when: when ?? '' }))
    }, ANNOUNCE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, contentId, when, showingLabel])

  // 关闭时归还焦点。`contentId` 在宿主的关闭回调里已经被清掉，所以这里记最后一次显示的那条。
  const lastContentId = useRef<string | undefined>(undefined)
  if (open && contentId !== undefined) lastContentId.current = contentId
  const wasOpen = useRef(open)
  useEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    if (!closed) return
    const id = lastContentId.current
    lastContentId.current = undefined
    if (id === undefined) return
    returnFocusTo?.(id)?.focus()
  }, [open, returnFocusTo])

  // 没有身份就没有抽屉：缺少 id 或时刻，播报说不出「哪一条变了」，一只静默换内容的抽屉
  // 正是这条策略要防的失败。
  if (!open || contentId === undefined || when === undefined) return null
  return (
    <div className="mi-calendar-detail-layer" data-calendar-detail-layer>
      <Drawer
        className="mi-calendar-detail"
        contentPadding="flush"
        header="titled"
        mode={CalendarDetailPanelPolicy.mode}
        onClose={onClose}
        open
        resolveText={resolveText}
        side={CalendarDetailPanelPolicy.side}
        size={CalendarDetailPanelPolicy.size}
        titleKey={DETAIL_TITLE_KEY}>
        {/* 只给读屏：视觉上不占位，也不该被发现「这里多了一行」。 */}
        <span aria-live="polite" className="drawer__sr-only" role="status">{announcement}</span>
        <div className="mi-calendar-detail-container" data-calendar-detail-container>{children}</div>
      </Drawer>
    </div>
  )
}

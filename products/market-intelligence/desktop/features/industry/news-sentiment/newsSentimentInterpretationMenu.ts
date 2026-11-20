import type { MenuItem } from '@platform/ui/components/menu'

import type { NewsInterpretationReadView } from '../../../shared/ipc/newsInterpretationClient'

/**
 * 右键菜单里的「AI 解读」那一项：**四态文字 + 可点判据**（R37）。
 *
 * - 读不到 / 还没读到 / `in-flight` → 置灰，文字仍是动作名；`in-flight` 不附原因（是「正在跑」不是「不能跑」）；
 * - 有解读且证据指纹一致 → 「查看 AI 解读」（可点，打开右栏那一节）；
 * - 有解读但证据指纹变了 → 「再次解读」（可点；真正的触发在下一笔接）；
 * - `none` → 「AI 解读」（可点；同上）。
 *
 * 只返回这一项；翻译项由调用方自己拼——菜单不再被翻译开关绑住。
 */
const OPEN = 'pages.intelligence.portal.newsSentiment.drawer.menuInterpretation'
const VIEW = 'pages.intelligence.portal.newsSentiment.drawer.menuInterpretationView'
const AGAIN = 'pages.intelligence.portal.newsSentiment.drawer.menuInterpretationAgain'
const UNREADABLE = 'mi.aiInterpretation.menuUnreadable'

export function newsInterpretationMenuItem(view: NewsInterpretationReadView | undefined, loading: boolean): MenuItem {
  // 读不到要给理由（禁用项必须说清为什么不能点）；正在跑与短暂加载不附原因。
  if (view !== undefined && view.state === 'unreadable') {
    return { key: 'interpretation', labelKey: UNREADABLE, disabled: true }
  }
  if (loading || view === undefined || view.state === 'in-flight') {
    return { key: 'interpretation', labelKey: OPEN, disabled: true }
  }
  if (view.state === 'none') return { key: 'interpretation', labelKey: OPEN }
  const unchanged = view.evidenceFingerprint !== undefined
    && view.evidenceFingerprint === view.currentEvidenceFingerprint
  return {
    key: 'interpretation',
    labelKey: unchanged ? VIEW : AGAIN
  }
}

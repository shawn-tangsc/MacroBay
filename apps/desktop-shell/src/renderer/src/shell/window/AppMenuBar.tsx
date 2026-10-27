import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { platformText } from '../../i18n/platformText'
import { readRendererPlatform } from './windowPlatform'

/**
 * Owner: apps/desktop-shell renderer / window（**自绘标题栏里的应用菜单条**，仅 Windows）。
 *
 * 为什么需要它：Windows 主窗改成 `frame: false` 之后，OS 不再绘制菜单栏，Alt 也唤不出菜单
 * （`autoHideMenuBar` 的原生菜单条属于被去掉的那一层）。应用菜单本身（`buildAppMenu` →
 * `Menu.setApplicationMenu`）不能因此消失，否则编辑菜单里的撤销/复制/粘贴、视图里的缩放、
 * 窗口关闭这些既有入口就全没了。
 *
 * 做法：渲染层只画**顶层标签**，点开时让 Main 用 `menu.popup()` 弹出**同一份原生子菜单**——
 * 命令、role、快捷键、勾选态全部仍由 Main 的菜单表决定，这里没有第二套命令表，也没有任意命令入口。
 * 顶栏本身是拖动区，菜单条必须 `no-drag`，否则点不开。
 *
 * 平台边界：macOS 的系统菜单在屏幕顶部，窗口里不重复画（返回 `null`）。
 */
type MenuEntry = { index: number; label: string; visible: boolean }

export function AppMenuBar(): React.ReactElement | null {
  const platform = readRendererPlatform()
  const language = useShellLanguage()
  const [entries, setEntries] = useState<readonly MenuEntry[]>([])
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (platform !== 'win32') return
    const api = typeof window === 'undefined' ? undefined : window.platform?.window?.menu
    if (!api) return
    let cancelled = false
    /** 只从 Main 读顶层标签：渲染层不持有菜单表，菜单改了（含运行期重建）自动跟上。 */
    const reload = (): void => {
      void api.list()
        .then((list) => { if (!cancelled) setEntries(Array.isArray(list) ? list as MenuEntry[] : []) })
        .catch(() => { /* 读不到菜单就只留一个空菜单条：绝不伪造一份命令表 */ })
    }
    reload()
    // 菜单重建广播（`buildAppMenu` 是唯一定义点，改一次两个平台一起生效）
    const unsubscribe = typeof api.onChanged === 'function' ? api.onChanged(reload) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [platform])

  // 非 Windows 一律不画（hooks 已无条件调用完，提前返回不破坏 hooks 顺序）
  if (platform !== 'win32') return null

  const open = (entry: MenuEntry, element: Element): void => {
    const api = window.platform?.window?.menu
    if (!api) return
    // 菜单弹出点＝按钮左下角（窗口内容坐标 = DIP，Main 侧只做取整与夹紧）
    const rect = element.getBoundingClientRect()
    setOpenIndex(entry.index)
    void api.popup(entry.index, Math.round(rect.left), Math.round(rect.bottom))
      .catch(() => false)
      .then((opened) => { if (opened !== true) setOpenIndex(null) })
      .finally(() => setOpenIndex((current) => (current === entry.index ? null : current)))
  }

  return (
    <nav className="app-menu" aria-label={platformText[language].windowChrome.menu} data-app-menu="true">
      {entries.map((entry) => (
        <button
          key={entry.index}
          type="button"
          className="app-menu-item"
          data-menu-index={entry.index}
          data-open={openIndex === entry.index ? 'true' : 'false'}
          aria-haspopup="menu"
          aria-expanded={openIndex === entry.index}
          onClick={(event) => open(entry, event.currentTarget)}>
          {entry.label}
        </button>
      ))}
    </nav>
  )
}

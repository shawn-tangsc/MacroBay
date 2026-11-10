import { useRef, useState } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { IconButton } from '@platform/ui/components/icon-button'
import { Info } from 'lucide-react'

import { DRAWER_MENUS, DRAWER_PREVIEW_SCREENS, type ConfigDrawerMenu, type PreviewControl } from './drawerPreviewRows'
import './configDrawer.css'

/**
 * 产品内「配置」抽屉——**纯静态版式**（用户 2026-11-10：先只做样子，一行数据都不接）。
 *
 * 职责只有一件：把六个菜单和每屏的行摆出来。没有 IPC、没有数据、没有副作用。
 * 「不接数据」由 `ConfigSettingsDrawer.test.tsx` 的守卫验（抽屉目录不许出现数据层 import），
 * 不是靠这句话。
 *
 * 左栏是**竖排按钮 + `aria-current`**，不是 `role="tab"`：平台 `Tabs` 只有横排，硬套会改形态；
 * 菜单是导航不是页签。上下键在导航内移动，Enter/Space 由按钮自己处理。
 *
 * 关闭三种方式都由平台 `Drawer` 给：Esc、右上关闭钮、点遮罩。
 *
 * TODO(0.4.3-preview): 数据接入后删除本文件的静态分支与 `drawerPreviewRows.ts`。
 */
export type ConfigSettingsDrawerProps = {
  open: boolean
  onClose: () => void
  initialMenu?: ConfigDrawerMenu
}

/** 值是占位符：这一版不带任何数据，也不许编数字。 */
const EMPTY_VALUE = '—'

export function ConfigSettingsDrawer({ open, onClose, initialMenu = 'sources' }: ConfigSettingsDrawerProps): React.ReactElement {
  const [menu, setMenu] = useState<ConfigDrawerMenu>(initialMenu)
  const navRef = useRef<HTMLElement>(null)
  const screen = DRAWER_PREVIEW_SCREENS.find((candidate) => candidate.menu === menu)
  const menuLabel = (key: ConfigDrawerMenu): string => key
  const resolveText = (key: string): string => key === 'configDrawer.title' ? 'Settings' : key === 'ui.drawer.close' ? 'Close' : ''

  // 上下键在导航内移动；Home/End 跳首尾。焦点跟着走，读屏才跟得上。
  const move = (delta: number): void => {
    const index = DRAWER_MENUS.indexOf(menu)
    const next = (index + delta + DRAWER_MENUS.length) % DRAWER_MENUS.length
    setMenu(DRAWER_MENUS[next]!)
    navRef.current?.querySelectorAll<HTMLElement>('.config-drawer__nav-item')[next]?.focus()
  }

  return <Drawer
    mode="modal"
    onClose={onClose}
    open={open}
    resolveText={resolveText}
    size="wide"
    titleKey="configDrawer.title">
    <div className="config-drawer">
      <nav
        aria-label={menuLabel(menu)}
        className="config-drawer__nav"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
        }}
        ref={navRef}>
        {DRAWER_MENUS.map((key, index) => <button
          aria-current={key === menu ? 'true' : undefined}
          className="config-drawer__nav-item"
          key={key}
          onClick={() => setMenu(key)}
          type="button">
          <span className="config-drawer__nav-index">{index + 1}</span>
          {/* 菜单名走 i18n 键；文案表补上之前显示键名，不写死中文。 */}
          {key}
        </button>)}
      </nav>
      <section aria-label={menuLabel(menu)} className="config-drawer__pane">
        <h2 className="config-drawer__pane-title">{menu}</h2>
        {screen?.groups.map((group, groupIndex) => <div className="config-drawer__group" key={`${menu}:${groupIndex}`}>
          {group.titleKey === undefined ? null : <div className="config-drawer__group-title">{group.titleKey}</div>}
          {group.rows.map((row) => <div className="config-drawer__row" key={row.key}>
            <span className="config-drawer__label">{row.labelKey}</span>
            <span className="config-drawer__value">{EMPTY_VALUE}</span>
            <PreviewControlView control={row.control} info={row.info === true} />
          </div>)}
        </div>)}
      </section>
    </div>
  </Drawer>
}

/** 控件只画外观：不带行为、不带值。 */
function PreviewControlView({ control, info }: { control: PreviewControl; info: boolean }): React.ReactElement | null {
  const glyph = control === 'switch'
    ? <span aria-hidden="true" className="config-drawer__switch" />
    : control === 'select' || control === 'multiSelect'
      ? <span aria-hidden="true" className={`config-drawer__select${control === 'multiSelect' ? ' config-drawer__select--multi' : ''}`} />
      : control === 'number'
        ? <span aria-hidden="true" className="config-drawer__number" />
        : null
  return <>
    {glyph}
    {info ? <IconButton ariaLabelKey="configDrawer.info" icon={Info} onSelect={() => undefined} resolveText={(key) => key} size="sm" /> : null}
  </>
}

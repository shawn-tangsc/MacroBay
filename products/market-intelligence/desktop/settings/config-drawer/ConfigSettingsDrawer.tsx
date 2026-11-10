import { useRef, useState } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { IconButton } from '@platform/ui/components/icon-button'
import { Info } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { productText } from '../../shared/i18n/productText'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { DRAWER_MENUS, DRAWER_PREVIEW_SCREENS, type ConfigDrawerMenu, type PreviewControl } from './drawerPreviewRows'
import type { DrawerRowView, DrawerScreenView } from './drawerScreenView'
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
  /** 通知屏视图：**宿主读好再传**，抽屉不自己取数；不传则保留静态版式。 */
  notificationsView?: DrawerScreenView<DrawerRowView>
  /** 行键与平台键的解析入口（文案）。 */
  resolveText?: (key: string) => string
}

/** 值是占位符：这一版不带任何数据，也不许编数字。 */
const EMPTY_VALUE = '—'

export function ConfigSettingsDrawer({
  open,
  onClose,
  initialMenu = 'sources',
  notificationsView,
  resolveText: resolveTextProp
}: ConfigSettingsDrawerProps): React.ReactElement {
  const copy = productText[useShellLanguage()].pages.intelligence.portal.dashboard.configDrawer
  const [menu, setMenu] = useState<ConfigDrawerMenu>(initialMenu)
  const navRef = useRef<HTMLElement>(null)
  const screen = DRAWER_PREVIEW_SCREENS.find((candidate) => candidate.menu === menu)
  const menuLabel = (key: ConfigDrawerMenu): string => copy.menus[key]
  /** 行标签：清单里存的是 `configDrawer.rows.<name>` 的完整路径，这里取最后一段查文案。 */
  const rowLabel = (labelKey: string): string => {
    const name = labelKey.split('.').at(-1) ?? labelKey
    return (copy.rows as Record<string, string>)[name] ?? labelKey
  }
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
          {menuLabel(key)}
        </button>)}
      </nav>
      <section aria-label={menuLabel(menu)} className="config-drawer__pane">
        <h2 className="config-drawer__pane-title">{menuLabel(menu)}</h2>
        {menu === 'notifications' && notificationsView !== undefined
          ? (<NotificationsScreen resolveText={resolveTextProp ?? ((key: string) => key)} view={notificationsView} />)
          : screen?.groups.map((group, groupIndex) => <div className="config-drawer__group" key={`${menu}:${groupIndex}`}>
          {group.titleKey === undefined ? null : <div className="config-drawer__group-title">{group.titleKey}</div>}
          {group.rows.map((row) => <div className="config-drawer__row" key={row.key}>
            <span className="config-drawer__label">{rowLabel(row.labelKey)}</span>
            <span className="config-drawer__value">{EMPTY_VALUE}</span>
            <PreviewControlView control={row.control} info={row.info === true} />
          </div>)}
        </div>)}
      </section>
    </div>
  </Drawer>
}

/**
 * 通知屏：**只渲染宿主传来的视图**。每屏根节点带 `data-drawer-screen`，用例据此分辨四态——
 * 只断「没报错」抓不到「看起来渲染了、其实什么都没出来」。
 */
function NotificationsScreen({ view, resolveText }: {
  view: DrawerScreenView<DrawerRowView>
  resolveText: (key: string) => string
}): React.ReactElement {
  if (view.state === 'loading') {
    return (<div data-drawer-screen="loading"><LoadingState ariaLabel={resolveText('ui.loading.label')} /></div>)
  }
  if (view.state === 'error') {
    return (
      <div data-drawer-screen="error">
        <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: view.onRetry }}
          reasonCode="unreadable"
          resolveText={resolveText}
          state="error" />
      </div>
    )
  }
  if (view.rows.length === 0) {
    // `not-yet`：确实还没有、也没有可做的动作（要求挂动作的码在这里语义不对）。
    return (<div data-drawer-screen="empty"><StateView reasonCode="not-yet" resolveText={resolveText} state="empty" /></div>)
  }
  return (
    <div data-drawer-screen="ready">
      {view.rows.map((row) => (
        <div className={row.disabled === true ? 'config-drawer__row is-disabled' : 'config-drawer__row'} data-drawer-row={row.key} key={row.key}>
          <span className="config-drawer__label">{resolveText(row.key)}</span>
          <span className="config-drawer__value">{row.value ?? '—'}</span>
          {row.action === undefined ? null : (
            <button className="config-drawer__row-action" disabled={row.action.disabled === true} onClick={row.action.onSelect} type="button">
              {resolveText(row.action.labelKey)}
            </button>
          )}
        </div>
      ))}
    </div>
  )
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

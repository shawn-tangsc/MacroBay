import { Fragment, useRef, useState } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { Popover } from '@platform/ui/components/popover'
import { IconButton } from '@platform/ui/components/icon-button'
import { Info } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { productText } from '../../shared/i18n/productText'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { SourcesStaticScreen } from './SourcesStaticScreen'
import { DRAWER_MENUS, DRAWER_PREVIEW_SCREENS, type ConfigDrawerMenu, type PreviewControl } from './drawerPreviewRows'
import type { DrawerPlatformTarget, DrawerPlatformValues, DrawerRowView, DrawerScreenView, DrawerSourceRow, DrawerSourcesView } from './drawerScreenView'
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
  /**
   * 通知：**宿主渲染好的整块**（设置页「通知」那一屏的同一块实现，不带页标题与页边距）。
   *
   * 与 `sourcesPanel` 同一条边界：内容与读写都在宿主那边，抽屉只把它放进这一屏。
   */
  notificationsPanel?: React.ReactNode
  /** 来源与采集：源列表由宿主读好（现成 `getPanelView`），抽屉只渲染。 */
  sourcesView?: DrawerSourcesView
  /**
   * 来源与采集：**宿主渲染好的「左树 + 右详情」整块**。
   *
   * 抽屉目录不许 import 数据层（有守卫），所以这块由宿主用设置页同一套组件渲染好再交进来；
   * 抽屉只负责把它放进两栏。传了它就不再用下面的静态版或扁平列表。
   */
  sourcesPanel?: React.ReactNode
  /** 选中一条源（右侧详情区等 S1 落地再接）。 */
  onSelectSource?: (sourceId: string) => void
  /** 分析屏视图（简报线给的 `useDrawerAnalysisView`）：两行值已是成句文案，原样渲染。 */
  analysisView?: DrawerScreenView<DrawerRowView>
  /** 日报屏视图（`useDrawerBriefingView`，五行只读），宿主读好传进来。 */
  briefingView?: DrawerScreenView<DrawerRowView>
  /** 平台与模型那一屏的当前值：**宿主读好再传**，缺键就是「读不到」。 */
  platformValues?: DrawerPlatformValues
  /** 行尾「去平台设置」跳转：走宿主给的导航入口，抽屉不拼路由。 */
  onOpenPlatformSettings?: (target: DrawerPlatformTarget) => void
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
  notificationsPanel,
  analysisView,
  briefingView,
  sourcesView,
  sourcesPanel,
  onSelectSource,
  platformValues,
  onOpenPlatformSettings,
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
  /** 分组标题：与行一样，清单里存完整路径，这里取最后一段查文案——**不许把键名印到屏幕上**。 */
  const groupLabel = (titleKey: string): string => {
    const name = titleKey.split('.').at(-1) ?? titleKey
    return (copy.groups as Record<string, string>)[name] ?? titleKey
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
    /* 这一屏是三栏（菜单 + 列表 196 + 详情）：`wide`(860) 下详情只剩一半，所以用 `full`(1040)。 */
    size="full"
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
        {menu === 'sources' && sourcesPanel !== undefined
          ? (<div className="config-drawer__split">{sourcesPanel}</div>)
          : null}
        {menu === 'sources' && sourcesPanel === undefined && sourcesView === undefined
          ? (<SourcesStaticScreen />)
          : null}
        {menu === 'sources' && sourcesPanel === undefined && sourcesView !== undefined
          ? (<SourcesScreen
            labels={{ enabled: copy.rows.enabled }}
            onSelect={onSelectSource}
            resolveText={resolveTextProp ?? ((key: string) => key)}
            values={{ on: copy.values.autoOn, off: copy.values.autoOff }}
            view={sourcesView} />)
          : null}
        {menu === 'analysis' && analysisView !== undefined
          ? (<NotificationsScreen resolveText={resolveTextProp ?? ((key: string) => key)} view={analysisView} />)
          : null}
        {menu === 'briefing' && briefingView !== undefined
          ? (<NotificationsScreen resolveText={resolveTextProp ?? ((key: string) => key)} view={briefingView} />)
          : null}
        {menu === 'notifications' && notificationsPanel !== undefined
          ? notificationsPanel
          : null}
        {menu === 'notifications' && notificationsPanel === undefined && notificationsView !== undefined
          ? (<NotificationsScreen resolveText={resolveTextProp ?? ((key: string) => key)} view={notificationsView} />)
          : null}
        {menu === 'platform' && platformValues !== undefined
          ? (<PlatformScreen
            onOpen={onOpenPlatformSettings}
            resolveText={resolveTextProp ?? ((key: string) => key)}
            values={platformValues} />)
          : null}
        {(menu === 'briefing' && briefingView !== undefined) || (menu === 'notifications' && (notificationsView !== undefined || notificationsPanel !== undefined)) || (menu === 'analysis' && analysisView !== undefined) || (menu === 'platform' && platformValues !== undefined) || menu === 'sources'
          ? null
          : screen?.groups.map((group, groupIndex) => <div className="config-drawer__group" key={`${menu}:${groupIndex}`}>
          {group.titleKey === undefined ? null : <div className="config-drawer__group-title">{groupLabel(group.titleKey)}</div>}
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
          <span className="config-drawer__label">
            {resolveText(row.key)}
            {/* 原因只进 ⓘ：正文只留状态词。 */}
            {row.reason === undefined ? null : (
              <Popover
                content={<span>{row.reason}</span>}
                trigger={(triggerProps) => (
                  <IconButton {...triggerProps} ariaLabelKey="configDrawer.rowReason" icon={Info} onSelect={() => undefined} resolveText={(key: string) => (key === 'configDrawer.rowReason' ? row.reason ?? '' : '')} size="sm" />
                )} />
            )}
          </span>
          {/* 值列三选一：真值 / 状态词（拿不到 + 原因）/ 单个 `—`（确实没有）。
              留有值的空位是不允许的——「留白」只属演示态，会随数据接上收敛掉。 */}
          <span className="config-drawer__value">{row.value ?? row.emptyLabel ?? '—'}</span>
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

/**
 * 来源与采集：**只渲染宿主读来的源列表**（宿主用现成 `getSettingsView`）。
 *
 * 四态**都在同一副两栏骨架里**（列表 196 + 详情 + 间距 12）——加载时不能塌成一栏。
 * 「读不到」是错误态 + 重试，「确实没有源」是空态，两者必须能分开断言。
 */
function SourcesScreen({ view, resolveText, onSelect, labels, values }: {
  view: DrawerSourcesView
  resolveText: (key: string) => string
  onSelect?: (sourceId: string) => void
  /** 详情区那两行：标签与「开/关」两个字都由外层给，屏内不新造文案。 */
  labels: Readonly<{ enabled: string }>
  values: Readonly<{ on: string; off: string }>
}): React.ReactElement {
  // 空态与就绪态都来自 `ready`，但两者在页面上是两件事：空态不画列表，只画空状态。
  const screen = view.state === 'ready' && view.rows.length === 0 ? 'empty' : view.state
  // 没选过就落在第一个源上：右侧不再是「—」，读者一眼能看到某个源现在什么样。
  const [pickedId, setPickedId] = useState<string | undefined>(undefined)
  // 只有 `ready` 才有 rows：加载/错误/空态下不能去读它。
  const readyRows = view.state === 'ready' ? view.rows : []
  const selected = readyRows.find((row) => row.sourceId === pickedId) ?? readyRows[0]
  const setPicked = setPickedId

  const frame = (detail: React.ReactNode, list: React.ReactElement | null): React.ReactElement => (
    <div data-drawer-screen={screen} data-drawer-screen-name="sources">
      <div className="config-drawer__split">
        <div className="config-drawer__source-list">{list}</div>
        <div className="config-drawer__detail">{detail}</div>
      </div>
    </div>
  )

  if (view.state === 'loading') {
    return frame(<LoadingState ariaLabel={resolveText('ui.loading.label')} />, null)
  }
  if (view.state === 'error') {
    return frame(
      <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: view.onRetry }}
        reasonCode="unreadable"
        resolveText={resolveText}
        state="error" />,
      null
    )
  }
  if (view.rows.length === 0) {
    // `not-yet`：确实还没有源；要求挂动作的码在这里语义不对。
    return frame(<StateView reasonCode="not-yet" resolveText={resolveText} state="empty" />, null)
  }
  return frame(
    <SourceDetail source={selected} labels={labels} values={values} />,
    <>
      {view.rows.map((source, index) => (
        <Fragment key={source.sourceId}>
          {/* 供应商分组：三十多个源平铺就是一堵名字墙；同名分组只画一次标题。 */}
          {source.groupName !== undefined && source.groupName !== view.rows[index - 1]?.groupName
            ? <div className="config-drawer__source-group">{source.groupName}</div>
            : null}
          <button
            aria-current={source.sourceId === selected?.sourceId ? 'true' : undefined}
            className="config-drawer__source-item"
            data-drawer-source={source.sourceId}
            onClick={() => { setPicked(source.sourceId); onSelect?.(source.sourceId) }}
            type="button">
            <span className="config-drawer__source-name">{source.name}</span>
            {source.statusLabel === undefined ? null : (
              <span className="config-drawer__source-status">{source.statusLabel}</span>
            )}
          {/* 行尾点：none 不画；ring 空心环、warn 实心黄、bad 实心红。 */}
          {source.healthMarker === undefined || source.healthMarker === 'none'
            ? null
            : <span className={`config-drawer__source-dot config-drawer__source-dot--${source.healthMarker}`} />}
          </button>
        </Fragment>
      ))}
    </>
  )
}

/**
 * 详情区：选中那个源的三条事实。
 *
 * 没有选中时不画任何东西——以前这里挂的是一个「—」标题，读者看到会以为整块坏了。
 * 只列事实，不给动作：这一列是「看看它现在什么样」，不是第二个设置面。
 */
function SourceDetail({ source, labels, values }: {
  source: DrawerSourceRow | undefined
  labels: Readonly<{ enabled: string }>
  values: Readonly<{ on: string; off: string }>
}): React.ReactElement | null {
  if (source === undefined) return null
  return (
    <div data-drawer-source-detail={source.sourceId}>
      <div className="config-drawer__group-title">{source.name}</div>
      {source.statusLabel === undefined ? null : (
        <p className="config-drawer__source-detail-status">{source.statusLabel}</p>
      )}
      <div className="config-drawer__row">
        <span className="config-drawer__label">{labels.enabled}</span>
        <span className="config-drawer__value">{source.enabled ? values.on : values.off}</span>
      </div>
    </div>
  )
}

/**
 * 平台与模型：**只读 + 跳转**，一个字都不写。
 *
 * 这一屏最容易把「没读到」画成「没设置」：所以值缺失时显示「读不到」，不是空白。
 * 跳转走宿主给的入口（平台基本设置 / 模型服务页），抽屉不拼路由。
 */
const PLATFORM_ROWS: readonly { key: string; value: keyof DrawerPlatformValues; target: DrawerPlatformTarget }[] = [
  { key: 'configDrawer.rows.timeZone', value: 'timeZone', target: 'preferences' },
  { key: 'configDrawer.rows.language', value: 'language', target: 'preferences' },
  { key: 'configDrawer.rows.theme', value: 'theme', target: 'preferences' },
  { key: 'configDrawer.rows.proxy', value: 'proxy', target: 'preferences' },
  { key: 'configDrawer.rows.modelService', value: 'modelService', target: 'models' }
]

function PlatformScreen({ values, onOpen, resolveText }: {
  values: DrawerPlatformValues
  onOpen?: (target: DrawerPlatformTarget) => void
  resolveText: (key: string) => string
}): React.ReactElement {
  return (
    <div data-drawer-screen="ready">
      {PLATFORM_ROWS.map((row) => {
        const value = values[row.value]
        return (
          <div className="config-drawer__row" data-drawer-row={row.value} key={row.value}>
            <span className="config-drawer__label">{resolveText(row.key)}</span>
            {/* 缺值 = 读不到，不是「没设置」；空白会把两件事画成一件。 */}
            <span className="config-drawer__value">{value ?? resolveText('configDrawer.unreadable')}</span>
            {onOpen === undefined ? null : (
              <button className="config-drawer__row-action" onClick={() => onOpen(row.target)} type="button">
                {resolveText('configDrawer.openPlatformSettings')}
              </button>
            )}
          </div>
        )
      })}
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

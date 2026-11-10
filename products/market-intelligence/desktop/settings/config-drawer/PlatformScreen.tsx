import { Button } from 'antd'

import { SettingsRow } from '@platform/ui/components/settings-row'
import { SettingsSection } from '@platform/ui/components/settings-section'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { SettingsInfo } from '../settingsInfo'
import type { DrawerPlatformTarget, DrawerPlatformValues } from './drawerScreenView'

/**
 * 平台与模型：**只读 + 跳转**，一个字都不写。
 *
 * 形状照设置页（本轮规格）：四个区块，区块标题 13/650 + 行 44 + 发丝线；
 * **每块标题右侧一颗**「去平台设置」（全屏最多四颗），行内不再放动作。
 * 读不到 = 状态词 + ⓘ（原因进浮层），并给整屏「重新读取」；**整屏都读不到才用错误态**。
 * 跳转走宿主给的入口（平台基本设置 / 模型服务页），抽屉不拼路由。
 */
type PlatformSection = Readonly<{
  id: 'languageTime' | 'appearance' | 'network' | 'modelService'
  titleKey: string
  target: DrawerPlatformTarget
  rows: ReadonlyArray<{ key: string; value: keyof DrawerPlatformValues }>
}>

const PLATFORM_SECTIONS: readonly PlatformSection[] = [
  {
    id: 'languageTime',
    titleKey: 'configDrawer.sections.languageTime',
    target: 'preferences',
    rows: [
      { key: 'configDrawer.rows.language', value: 'language' },
      { key: 'configDrawer.rows.timeZone', value: 'timeZone' }
    ]
  },
  {
    id: 'appearance',
    titleKey: 'configDrawer.sections.appearance',
    target: 'preferences',
    rows: [{ key: 'configDrawer.rows.theme', value: 'theme' }]
  },
  {
    id: 'network',
    titleKey: 'configDrawer.sections.network',
    target: 'preferences',
    rows: [{ key: 'configDrawer.rows.proxy', value: 'proxy' }]
  },
  {
    id: 'modelService',
    titleKey: 'configDrawer.sections.modelService',
    target: 'models',
    rows: [{ key: 'configDrawer.rows.modelService', value: 'modelService' }]
  }
]

const PLATFORM_ROW_COUNT = PLATFORM_SECTIONS.reduce((total, section) => total + section.rows.length, 0)

export function PlatformScreen({ values, onOpen, onRetry, resolveText }: {
  values: DrawerPlatformValues
  onOpen?: (target: DrawerPlatformTarget) => void
  /** 整屏「重新读取」：读，不是保存。没给就不画按钮（不留假控件）。 */
  onRetry?: () => void
  resolveText: (key: string) => string
}): React.ReactElement {
  const missingRows = PLATFORM_SECTIONS
    .flatMap((section) => section.rows)
    .filter((row) => values[row.value] === undefined)
  const allMissing = missingRows.length === PLATFORM_ROW_COUNT

  // 整屏都读不到：错误态 + 真重试。**没有重试入口时不画错误态**——错误态不带动作就是假控件，
  // 也不满足 `stateViewCallSiteGuard`（错误态必须有动作）。宿主接上 `reload` 后这条分支才生效。
  if (allMissing && onRetry !== undefined) {
    return (
      <div data-drawer-screen="error">
        <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }}
          reasonCode="unreadable"
          resolveText={resolveText}
          state="error" />
      </div>
    )
  }

  const sectionAction = (target: DrawerPlatformTarget): React.ReactNode =>
    onOpen === undefined ? undefined : (
      <Button
        className="text-action"
        data-platform-section-action={target}
        onClick={() => onOpen(target)}>
        {resolveText('configDrawer.openPlatformSettings')}
      </Button>
    )

  return (
    <div className="config-drawer__platform" data-drawer-screen="ready">
      {missingRows.length > 0 && onRetry !== undefined ? (
        // 局部读不到：一行状态词 + 一次「重新读取」。**读不到不是脏**，跟保存无关。
        <p className="config-drawer__platform-notice" data-platform-partial role="status">
          <span>{resolveText('configDrawer.unreadable')}</span>
          <Button className="text-action" data-platform-retry onClick={onRetry}>
            {resolveText('configDrawer.retry')}
          </Button>
        </p>
      ) : null}
      {PLATFORM_SECTIONS.map((section) => (
        <div data-platform-section={section.id} key={section.id}>
          <SettingsSection action={sectionAction(section.target)} title={resolveText(section.titleKey)}>
            {section.rows.map((row) => {
              const value = values[row.value]
              return (
                <SettingsRow
                  controlWrapperClassName={value === undefined
                    ? 'config-drawer__value config-drawer__value--with-info'
                    : 'config-drawer__value'}
                  copyClassName="config-drawer__label"
                  key={row.value}
                  label={resolveText(row.key)}
                  rowAttributes={{ 'data-drawer-row': row.value }}
                  rowClassName="config-drawer__row">
                  {value === undefined ? (
                    <>
                      {/* 缺值 = 读不到，不是「没设置」；原因只进 ⓘ，正文只留状态词。 */}
                      <span>{resolveText('configDrawer.unreadable')}</span>
                      <span data-drawer-info>
                        <SettingsInfo
                          ariaLabelKey="configDrawer.unreadableReasonAria"
                          labelKeys={['configDrawer.unreadableReason']}
                          resolveText={resolveText} />
                      </span>
                    </>
                  ) : value}
                </SettingsRow>
              )
            })}
          </SettingsSection>
        </div>
      ))}
    </div>
  )
}


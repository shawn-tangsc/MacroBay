import type { PlatformText } from '../../../i18n/platformText'

export type WebSearchSettingsTab = 'policy' | 'providers'

type WebSearchSettingsTabsProps = {
  labels: PlatformText['webSearch']
  active: WebSearchSettingsTab
  onChange: (tab: WebSearchSettingsTab) => void
}

/**
 * PLAT-60：页面级两个二级 Tab（策略 / 供应商）。
 * Tab 选中态是组件内 state，不写进 settings，也不复制到别的组件。
 */
export function WebSearchSettingsTabs({
  labels,
  active,
  onChange
}: WebSearchSettingsTabsProps): React.ReactElement {
  const tabs: Array<{ key: WebSearchSettingsTab; label: string }> = [
    { key: 'policy', label: labels.policyTab },
    { key: 'providers', label: labels.providersTab }
  ]

  return (
    <div className="web-search-settings-tabs" role="tablist" aria-label={labels.title}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          tabIndex={0}
          data-web-search-tab={tab.key}
          className={active === tab.key ? 'web-search-settings-tab on' : 'web-search-settings-tab'}
          onClick={() => onChange(tab.key)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

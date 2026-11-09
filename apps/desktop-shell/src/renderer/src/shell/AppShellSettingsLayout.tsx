import type { ReactNode } from 'react'

import type { AppSettings, AppSettingsPatch, NetworkSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../i18n/platformText'
import type { ProxySelfTestResult, ProxySelfTestView } from './proxySelfTestDisplay'
import type { ProviderConnectionCheckResult } from './ProviderConnectionCheckDrawer'
import type { GeneratedProductSettingsEntry } from '@platform/product-registry/types'
import { groupShellSettingsPanels } from './navigation/mergeShellNavigation'
import { findProductSettingsEntry } from './navigation/mergeShellNavigation'
import { isBuiltInSettingsPanelId } from './navigation/builtInNavEntries'
import { AboutSettingsPage } from './settings/about/AboutSettingsPage'
import { AssistantLibrarySettingsPage } from './settings/assistants/AssistantLibrarySettingsPage'
import { ChannelSettingsPage } from './settings/channels/ChannelSettingsPage'
import { NotificationSettingsScreen } from './settings/NotificationSettingsScreen'
import { StorageCacheSettingsPage } from './settings/storage-cache/StorageCacheSettingsPage'
import { TaskAutomationSettingsPage } from './settings/task-automation/TaskAutomationSettingsPage'
import { WebSearchSettingsPage } from './settings/web-search/WebSearchSettingsPage'
import { AppShellPreferencesPane } from './AppShellPreferencesPane'
import { ProductContributionHost } from './workspace/ProductContributionHost'
import { ModelServiceDefaultModelsSection } from './model-service/ModelServiceDefaultModelsSection'
import { ModelServiceLoadSurface } from './model-service/ModelServiceLoadSurface'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { useModelServiceProviders } from './model-service/useModelServiceProviders'

export type AppShellSettingsLayoutProps = {
  t: PlatformText
  settings: AppSettings
  noticeText: string | null
  resolveText: (key: string) => string
  settingsPanelKey: string
  onSelectPanel: (panelKey: string) => void
  navGroups: ReturnType<typeof groupShellSettingsPanels>
  productSettingsEntries: readonly GeneratedProductSettingsEntry[]
  providersState: ReturnType<typeof useModelServiceProviders>['state']
  providers: readonly SafeModelProvider[]
  onReloadProviders: () => void
  onUpdateSettings: (patch: AppSettingsPatch) => Promise<void>
  onUpdateNetworkSettings: (patch: Partial<NetworkSettings>) => Promise<void>
  onDraftSettingsChange: React.Dispatch<React.SetStateAction<AppSettings>>
  onRunProxySelfTest: () => Promise<void>
  onManageAssistants: () => void
  focusEntityId: string | null
  appInfoName: string
  proxySelfTest: { running: boolean; result: ProxySelfTestResult | null }
  proxySelfTestView: ProxySelfTestView | null
  modelService: ReactNode
}

export function AppShellSettingsLayout(props: AppShellSettingsLayoutProps): React.ReactElement {
  const {
    t, settings, noticeText, resolveText: preferencesText, settingsPanelKey, onSelectPanel, navGroups: settingsNavGroups,
    productSettingsEntries, providersState, providers, onReloadProviders: reloadProviders,
    onUpdateSettings: updateSettings, onUpdateNetworkSettings: updateNetworkSettings,
    onDraftSettingsChange: setSettings, onRunProxySelfTest: runProxySelfTest, onManageAssistants,
    focusEntityId, appInfoName, proxySelfTest, proxySelfTestView, modelService
  } = props
  const productSettingsEntry = findProductSettingsEntry(settingsPanelKey, productSettingsEntries)
  const setSettingsPanelKey = onSelectPanel
  const setActiveNavKey = (_key: string): void => onManageAssistants()

  return (
      <div className="settings-layout">
        <aside className="settings-nav" aria-label={t.nav.settings}>
          {settingsNavGroups.map((group) => (
            <section key={group.id} className="settings-nav-group" aria-label={group.title ?? undefined}>
              {group.title ? <div className="settings-nav-group-title">{group.title}</div> : null}
              {group.panels.map((panel) => {
                const Icon = panel.icon
                return (
                  <button
                    key={panel.key}
                    type="button"
                    className={settingsPanelKey === panel.key ? 'settings-nav-item active' : 'settings-nav-item'}
                    onClick={() => setSettingsPanelKey(panel.key)}>
                    <Icon size={17} />
                    <span>{panel.label}</span>
                  </button>
                )
              })}
            </section>
          ))}
        </aside>

        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'models' ? (
          // 供应商列表是这一页的启动读数：等 / 读不到 / 有数据（刷新失败保留旧表）都由它统一判。
          <ModelServiceLoadSurface
            language={settings.language}
            state={providersState}
            onRetry={() => void reloadProviders()}>
            <div className="model-service-with-defaults" data-model-service-with-defaults>
              <ModelServiceDefaultModelsSection
                labels={t.models}
                providers={providers}
                values={settings.modelDefaults}
                onChange={(field, value) => {
                  void updateSettings({ modelDefaults: { ...settings.modelDefaults, [field]: value } })
                }}
              />
              {modelService}
            </div>
          </ModelServiceLoadSurface>
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'assistant-library' ? (
          <AssistantLibrarySettingsPage language={settings.language} onManageAssistants={() => setActiveNavKey('assistants')} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'web-search' ? (
          <WebSearchSettingsPage language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'storage-cache' ? (
          <StorageCacheSettingsPage language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'task-automation' ? (
          <TaskAutomationSettingsPage language={settings.language} focusTaskId={focusEntityId} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'channels' ? (
          <ChannelSettingsPage language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'preferences' ? (
          <AppShellPreferencesPane
            text={t}
            settings={settings}
            noticeText={noticeText}
            resolveText={preferencesText}
            proxySelfTest={proxySelfTest}
            proxySelfTestView={proxySelfTestView}
            onUpdateSettings={updateSettings}
            onUpdateNetworkSettings={updateNetworkSettings}
            onDraftSettingsChange={setSettings}
            onRunProxySelfTest={runProxySelfTest}
          />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'notifications' ? (
          <NotificationSettingsScreen title={t.settings.notifications} notice={noticeText} language={settings.language} />
        ) : null}
        {isBuiltInSettingsPanelId(settingsPanelKey) && settingsPanelKey === 'about' ? <AboutSettingsPage settings={settings} onUpdateSettings={updateSettings} productName={appInfoName} /> : null}
        {productSettingsEntry ? (
          <ProductContributionHost
            language={settings.language}
            load={productSettingsEntry.load} focusEntityId={focusEntityId}
          />
        ) : null}
      </div>

  )
}

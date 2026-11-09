import { Globe2, Languages, Palette } from 'lucide-react'
import { Button, Input, Select } from 'antd'

import { Segmented } from '@platform/ui/components/segmented'
import type { AppLanguage, AppSettings, AppSettingsPatch, NetworkSettings, ProxyMode, ThemeMode } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../i18n/platformText'
import { proxyAddressUsesImplicitSocks5 } from './proxySettingsNotice'
import type { ProxySelfTestResult, ProxySelfTestView } from './proxySelfTestDisplay'
import { SettingInfoPopover } from './settings/SettingInfoPopover'
import { TimeZonePreference } from './settings/TimeZonePreference'
import {
  LANGUAGE_LABEL_KEYS,
  LANGUAGE_SEGMENTED_KEY,
  THEME_LABEL_KEYS,
  THEME_SEGMENTED_KEY,
  languageOptions,
  proxyModeOptions,
  themeOptions
} from './shellOptionTables'

/**
 * 基础设置（偏好）面板。从 `AppShell.tsx` 原样搬出：DOM、类名与文案键一字未改，
 * 本组件只接收外壳算好的值与回调，自己不留任何状态。
 *
 * 留在外壳里的三件事：`settings`（外壳的单一设置来源）、`updateSettings`（唯一写入路径）、
 * `preferencesText`（与 `Segmented` 共用的解析器）。
 */
export type AppShellPreferencesPaneProps = {
  text: PlatformText
  settings: AppSettings
  noticeText: string | null
  resolveText: (key: string) => string
  proxySelfTest: { running: boolean; result: ProxySelfTestResult | null }
  proxySelfTestView: ProxySelfTestView | null
  onUpdateSettings: (patch: AppSettingsPatch) => Promise<void>
  onUpdateNetworkSettings: (patch: Partial<NetworkSettings>) => Promise<void>
  /** 输入框逐字更新草稿，失焦时才写库——与外壳原来的 `setSettings` 是同一个函数。 */
  onDraftSettingsChange: React.Dispatch<React.SetStateAction<AppSettings>>
  onRunProxySelfTest: () => Promise<void>
}

export function AppShellPreferencesPane(props: AppShellPreferencesPaneProps): React.ReactElement {
  const {
    text: t,
    settings,
    noticeText,
    resolveText: preferencesText,
    proxySelfTest,
    proxySelfTestView,
    onUpdateSettings: updateSettings,
    onUpdateNetworkSettings: updateNetworkSettings,
    onDraftSettingsChange: setSettings,
    onRunProxySelfTest: runProxySelfTest
  } = props

  return (

      <section className="settings-detail-pane preferences-pane">
        <div className="section-heading">
          <span>{t.settings.basicSettings}</span>
          {noticeText ? <small>{noticeText}</small> : null}
        </div>

        <div className="preference-section">
          <div className="preference-heading">
            <Languages size={18} />
            <span>{t.preferences.language}</span>
          </div>
          <Segmented
            ariaLabelKey={LANGUAGE_SEGMENTED_KEY}
            items={languageOptions.map((option) => ({
              value: option.value,
              labelKey: LANGUAGE_LABEL_KEYS[option.value]
            }))}
            value={settings.language}
            onChange={(value) => void updateSettings({ language: value as AppLanguage })}
            resolveText={preferencesText}
          />
        </div>

        <TimeZonePreference
          language={settings.language}
          value={settings.timeZone}
          onChange={(value) => void updateSettings({ timeZone: value })}
        />

        <div className="preference-section">
          <div className="preference-heading">
            <Palette size={18} />
            <span>{t.preferences.displayStyle}</span>
          </div>
          <Segmented
            ariaLabelKey={THEME_SEGMENTED_KEY}
            items={themeOptions.map((option) => ({
              value: option.value,
              labelKey: THEME_LABEL_KEYS[option.value],
              icon: option.icon
            }))}
            value={settings.themeMode}
            onChange={(value) => void updateSettings({ themeMode: value as ThemeMode })}
            resolveText={preferencesText}
          />
        </div>

        <div className="preference-section">
          <div className="preference-heading">
            <Globe2 size={18} />
            <span>{t.preferences.proxyMode}</span>
            {/*
              * 说明句收进标题旁的 ⓘ（设置页每行只许「字段名 / 当前值 / 控件 / 状态」四类文本）。
              * 是移出 DOM，不是藏：正文里已经没有这句话，读屏与全选都拿不到它。
              */}
            <SettingInfoPopover
              hintKey="proxyRequestHint"
              infoLabelKey="proxyRequestHintInfo"
              resolveText={preferencesText}
            />
          </div>
          <Select<ProxyMode>
            className="preference-select"
            value={settings.network.proxyMode}
            options={proxyModeOptions.map((option) => ({
              value: option.value,
              label: t.preferences[option.labelKey]
            }))}
            onChange={(value) => void updateNetworkSettings({ proxyMode: value })}
          />
          <div className="preference-proxy-probe">
            <Button
              className="ant-secondary-button"
              size="small"
              loading={proxySelfTest.running}
              disabled={proxySelfTest.running}
              data-proxy-self-test
              onClick={() => void runProxySelfTest()}>
              {proxySelfTest.running ? t.preferences.proxySelfTestRunning : t.preferences.proxySelfTest}
            </Button>
            {proxySelfTestView !== null ? (
              <p
                className={`preference-proxy-probe-result ${proxySelfTestView.tone}`}
                data-proxy-self-test-result
                data-tone={proxySelfTestView.tone}>
                {proxySelfTestView.line}
                {proxySelfTestView.hint !== null ? (
                  <>
                    <br />
                    <span className="preference-proxy-probe-hint">{proxySelfTestView.hint}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {settings.network.proxyMode === 'custom' ? (
            <div className="preference-fields">
              <label className="preference-field">
                <span>{t.preferences.proxyAddress}</span>
                <Input
                  value={settings.network.proxyUrl}
                  placeholder={t.preferences.proxyAddressPlaceholder}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      network: { ...current.network, proxyUrl: event.target.value }
                    }))
                  }
                  onBlur={(event) => void updateNetworkSettings({ proxyUrl: event.target.value.trim() })}
                />
                {proxyAddressUsesImplicitSocks5(settings.network.proxyUrl) ? (
                  <p className="preference-hint" data-proxy-implicit-protocol>
                    {t.preferences.proxySocks5Implicit}
                  </p>
                ) : null}
              </label>
              <label className="preference-field">
                <span>{t.preferences.proxyBypassRules}</span>
                <Input
                  value={settings.network.proxyBypassRules}
                  placeholder={t.preferences.proxyBypassPlaceholder}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      network: { ...current.network, proxyBypassRules: event.target.value }
                    }))
                  }
                  onBlur={(event) =>
                    void updateNetworkSettings({ proxyBypassRules: event.target.value.trim() })
                  }
                />
              </label>
            </div>
          ) : null}
        </div>

      </section>
  )
}

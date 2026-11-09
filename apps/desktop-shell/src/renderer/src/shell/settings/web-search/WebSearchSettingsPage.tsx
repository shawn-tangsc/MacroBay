import { useEffect, useState } from 'react'
import { Button } from 'antd'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WebSearchProviderId, WebSearchSettings } from '@platform/ai/web-search/contracts/webSearchContracts'
import { LoadingState } from '@platform/ui/components/loading'
import { Tabs } from '@platform/ui/components/tabs'
import { StateView } from '@platform/ui/components/state'
import { platformText } from '../../../i18n/platformText'
import { WebSearchPolicyPage } from './WebSearchPolicyPage'
import { WebSearchProvidersPage } from './WebSearchProvidersPage'

import { WebSearchSummaryChips } from './WebSearchSummaryChips'
import { useWebSearchSettings } from './useWebSearchSettings'

export type WebSearchSettingsTab = 'policy' | 'providers'

/** 页签的键：`Tabs` 只收键，句子由这一页的解析器给。 */
const TAB_KEY_POLICY = 'webSearch.tab.policy'
const TAB_KEY_PROVIDERS = 'webSearch.tab.providers'

type WebSearchSettingsPageProps = {
  language: AppLanguage
}

/**
 * PLAT-60：把「策略（全局行为）」与「供应商（连接/凭据）」拆成两个二级 Tab。
 * 页面头部与摘要 chips 两页共用；Tab 选中态只是组件内 state，不写 settings。
 */
export function WebSearchSettingsPage({ language }: WebSearchSettingsPageProps): React.ReactElement {
  const labels = platformText[language].webSearch
  const webSearch = useWebSearchSettings()
  const [tab, setTab] = useState<WebSearchSettingsTab>('policy')
  const [policyDraft, setPolicyDraft] = useState<WebSearchSettings | null>(null)
  const [openProviderId, setOpenProviderId] = useState<WebSearchProviderId | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (webSearch.settings) setPolicyDraft(webSearch.settings)
  }, [webSearch.settings])

  if (webSearch.loading) {
    return (
      <section className="settings-workspace web-search-settings">
        <div className="web-search-loading">
          <LoadingState label={platformText[language].status.loading} />
        </div>
      </section>
    )
  }

  if (webSearch.error || !webSearch.settings) {
    // 「没读出来」不等于「这里没有内容」：用 error 态而不是空态，并给一个真的重试。
    // 原始异常只进日志（`useWebSearchSettings` 已经打在 catch 里），不上屏。
    return (
      <section className="settings-workspace web-search-settings">
        <div className="web-search-loading">
          <StateView
            state="error"
            reasonCode="unreadable"
            action={{ labelKey: 'ui.state.action.retry', onSelect: () => void webSearch.reload() }}
          />
        </div>
      </section>
    )
  }

  const settings = webSearch.settings
  const policyDraftValue = policyDraft ?? settings
  const dirty = JSON.stringify(policyDraftValue) !== JSON.stringify(settings)
  const stateText = saveError ?? (dirty ? labels.unsaved : labels.saved)

  async function savePolicy(): Promise<void> {
    if (!dirty || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await webSearch.updateSettings(policyDraftValue)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function openDefaultProvider(providerId: WebSearchProviderId): void {
    setTab('providers')
    setOpenProviderId(providerId)
  }

  return (
    <section className="settings-workspace web-search-settings">
      <main className="web-search-detail-pane" data-web-search-settings-page>
        <header className="web-search-page-header">
          <div>
            <h1>{labels.title}</h1>
            <p>{labels.subtitle}</p>
          </div>
        </header>

        {/*
          * 页签用平台 `Tabs`（手写 `role="tab"` 是缺陷）。
          * 动作条属于**面板**、不属于 tablist：它是「这一页能做什么」，切页签就跟着换；
          * 没有动作的页签不渲染动作条、也不占位（供应商页只有内容，没有保存）。
          */}
        <Tabs
          ariaLabelKey={TAB_KEY_PROVIDERS}
          items={[
            { value: 'policy', labelKey: TAB_KEY_POLICY },
            { value: 'providers', labelKey: TAB_KEY_PROVIDERS }
          ]}
          onChange={(value) => setTab(value as WebSearchSettingsTab)}
          panels={{
            policy: (
              <div className="web-search-panel">
                <div className="web-search-panel-actions">
                  <span className={dirty || saveError ? 'web-search-save-state dirty' : 'web-search-save-state'}>
                    {stateText}
                  </span>
                  <Button
                    className="ant-primary-button"
                    loading={saving}
                    disabled={!dirty || saving}
                    onClick={() => void savePolicy()}>
                    {labels.savePolicy}
                  </Button>
                </div>
                <WebSearchSummaryChips
                  labels={labels}
                  settings={webSearch.settings}
                  providers={webSearch.providers}
                  onSelectProvider={openDefaultProvider}
                />
                <WebSearchPolicyPage
                  labels={labels}
                  settings={policyDraftValue}
                  providers={webSearch.providers}
                  onChange={(patch) => setPolicyDraft((current) => ({ ...(current ?? settings), ...patch }))}
                />
              </div>
            ),
            providers: (
              <div className="web-search-panel">
                <WebSearchSummaryChips
                  labels={labels}
                  settings={webSearch.settings}
                  providers={webSearch.providers}
                  onSelectProvider={openDefaultProvider}
                />
                <WebSearchProvidersPage
                  labels={labels}
                  providers={webSearch.providers}
                  settings={webSearch.settings}
                  openProviderId={openProviderId}
                  onOpenProvider={setOpenProviderId}
                  onCloseProvider={() => setOpenProviderId(null)}
                  onSaveProvider={async (input) => {
                    await webSearch.updateProvider(input)
                  }}
                  onCheckProvider={webSearch.checkProvider}
                  onRevealApiKey={webSearch.revealApiKey}
                />
              </div>
            )
          }}
          resolveText={(key) => (key === TAB_KEY_POLICY ? labels.policyTab : labels.providersTab)}
          value={tab}
        />
      </main>
    </section>
  )
}

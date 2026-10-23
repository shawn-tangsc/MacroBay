import { useEffect, useState } from 'react'
import { Button, Empty, Spin } from 'antd'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WebSearchProviderId, WebSearchSettings } from '@platform/ai/web-search/contracts/webSearchContracts'
import { platformText } from '../../../i18n/platformText'
import { WebSearchPolicyPage } from './WebSearchPolicyPage'
import { WebSearchProvidersPage } from './WebSearchProvidersPage'
import { WebSearchSettingsTabs, type WebSearchSettingsTab } from './WebSearchSettingsTabs'
import { WebSearchSummaryChips } from './WebSearchSummaryChips'
import { useWebSearchSettings } from './useWebSearchSettings'

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
          <Spin />
        </div>
      </section>
    )
  }

  if (webSearch.error || !webSearch.settings) {
    return (
      <section className="settings-workspace web-search-settings">
        <div className="web-search-loading">
          <Empty description={webSearch.error ?? labels.loadFailed} />
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
          <div className="web-search-page-actions">
            <span className={dirty || saveError ? 'web-search-save-state dirty' : 'web-search-save-state'}>
              {stateText}
            </span>
            <Button
              className="ant-primary-button"
              autoInsertSpace={false}
              loading={saving}
              disabled={!dirty || saving}
              onClick={() => void savePolicy()}>
              {labels.savePolicy}
            </Button>
          </div>
        </header>

        <WebSearchSettingsTabs labels={labels} active={tab} onChange={setTab} />
        <WebSearchSummaryChips
          labels={labels}
          settings={webSearch.settings}
          providers={webSearch.providers}
          onSelectProvider={openDefaultProvider}
        />

        {tab === 'policy' ? (
          <WebSearchPolicyPage
            labels={labels}
            settings={policyDraftValue}
            providers={webSearch.providers}
            onChange={(patch) => setPolicyDraft((current) => ({ ...(current ?? settings), ...patch }))}
          />
        ) : (
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
        )}
      </main>
    </section>
  )
}

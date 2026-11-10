import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { productText } from '../../shared/i18n/productText'
import type { SourceFilter } from '../../settings/intelligence-sources/SettingsSourceTree'
import { SourcesSettingsPane } from '../../settings/intelligence-sources/SourcesSettingsPane'
import { useIntelligenceSourcesSettings } from '../../settings/intelligence-sources/useIntelligenceSourcesSettings'
import { useIntelligenceTranslationSettings } from '../../settings/intelligence-sources/useIntelligenceTranslationSettings'

/**
 * 配置抽屉「来源与采集」那两栏：**设置页同一块实现**（`SourcesSettingsPane`）。
 *
 * 为什么放在页面这一层：抽屉目录有一条守卫，不许它 import 数据层；所以由这里把读写读好、
 * 把两栏渲染好，作为一块节点交给抽屉，抽屉只负责放进布局。抄外观不是复用——两处各画一遍，
 * 迟早一边加了四格健康、另一边没加。
 *
 * 这个组件只在抽屉打开、且停在「来源与采集」时才挂载，所以那几个 hook 的读也只在这时发生。
 */
export function DashboardSourcesPanel(): React.ReactElement {
  const language = useShellLanguage()
  const t = productText[language].settings.intelligenceSources
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const settings = useIntelligenceSourcesSettings(t)
  const translation = useIntelligenceTranslationSettings(t.translationPreferences)
  const { settingsView, runSourceNow, toggleSourceEnabled, setDraftDirty, profiles, definitions, updateSourceProfile } = settings
  // 采集策略：每源一份 profile；是否支持情绪分析由源定义决定（同一个事实只读一处）。
  const policyProfiles: Readonly<Record<string, IntelligenceSourceProfile>> = Object.fromEntries(
    profiles.map((profile) => [profile.sourceId, profile])
  )
  const supportsSentimentById: Readonly<Record<string, boolean>> = Object.fromEntries(
    definitions.map((definition) => [definition.sourceId, definition.supportsSentiment === true])
  )
  const supportsRunNowById: Readonly<Record<string, boolean>> = Object.fromEntries(
    definitions.map((definition) => [definition.sourceId, definition.supportsRunNow])
  )

  // 没选过就落在第一个供应商上：右栏不该是一片空白。
  useEffect(() => {
    if (selectedProviderId !== undefined || settingsView === undefined) return
    const first = settingsView.groups.flatMap((group) => group.providers)[0]
    if (first !== undefined) setSelectedProviderId(first.providerId)
  }, [settingsView, selectedProviderId])

  return <SourcesSettingsPane
    filter={sourceFilter}
    onFilterChange={setSourceFilter}
    onSelectProvider={(providerId) => setSelectedProviderId(providerId)}
    selectedProviderId={selectedProviderId}
    surface={{
      text: t,
      policy: { labels: t.collectionPolicy, onChange: updateSourceProfile, profiles: policyProfiles, supportsSentimentById },
      supportsRunNowById,
      onRunNow: runSourceNow,
      onToggleSource: toggleSourceEnabled,
      onDraftChange: setDraftDirty,
      ...(language !== 'en-US'
        ? {
          translation: {
            settings: translation.settings,
            loading: translation.loading,
            moduleStatus: translation.moduleStatus,
            modelProviders: translation.modelProviders,
            saving: translation.saving,
            savedThisSession: translation.savedThisSession,
            queuing: translation.queuing,
            labels: t.translationPreferences,
            notice: translation.notice,
            errorMessage: translation.errorMessage,
            onChange: (patch) => void translation.updateSettings(patch),
            onQueueMissing: (sourceIds) => void translation.queueMissing(sourceIds)
          }
        }
        : {}),
      showSourceDetails: true,
      surface: 'settings'
    }}
    treeLabels={{ title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne, unavailableCountOther: t.unavailableCountOther }}
    view={settingsView} />
}

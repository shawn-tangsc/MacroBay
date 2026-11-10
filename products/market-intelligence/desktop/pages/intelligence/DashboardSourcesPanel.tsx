import { useCallback, useEffect, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { productText } from '../../shared/i18n/productText'
import type { SourceFilter } from '../../settings/intelligence-sources/SettingsSourceTree'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { SourcesSettingsPane } from '../../settings/intelligence-sources/SourcesSettingsPane'
import { cellEnabledClient } from '../../shared/ipc/cellEnabledClient'
import { useIntelligenceSourcesSettings } from '../../settings/intelligence-sources/useIntelligenceSourcesSettings'

/**
 * 配置抽屉「来源与采集」那两栏：**设置页同一块实现**（`SourcesSettingsPane`）。
 *
 * 为什么放在页面这一层：抽屉目录有一条守卫，不许它 import 数据层；所以由这里把读写读好、
 * 把两栏渲染好，作为一块节点交给抽屉，抽屉只负责放进布局。抄外观不是复用——两处各画一遍，
 * 迟早一边加了四格健康、另一边没加。
 *
 * 这个组件只在抽屉打开、且停在「来源与采集」时才挂载，所以那几个 hook 的读也只在这时发生。
 */
export function DashboardSourcesPanel(props: {
  /**
   * 这一屏有草稿时上报给宿主——抽屉壳据此在关闭/切屏时问一句「丢掉改动 / 继续编辑」。
   *
   * **为什么不用「保存栏」**：来源屏的草稿多半是凭据框这类输入，不该被一次「保存」代劳；
   * 所以它只参与**关闭确认**，不进保存栏（保存栏只覆盖自己上报了的屏）。
   */
  onDraftChange?: (dirty: boolean) => void
  /**
   * 打开抽屉时落哪一块筛选（前端可以在「打开配置」的请求里指定）。
   * **只当初始值**，不是受控 prop：读者点了别的 tab 就归读者，外部不许一直压着。不传仍是「看板」。
   */
  initialFilter?: SourceFilter
} = {}): React.ReactElement {
  const language = useShellLanguage()
  const t = productText[language].settings.intelligenceSources
  /** 卡片组件的文案键是点分键（`businessTabs.dashboard` / 模块标题键），要用产品解析器，不能拿平表查。 */
  const resolveProductText = useProductTextKey()
  // 抽屉落「看板」：打开就省一步。**设置页仍默认「全部」**（那是完整管理面），两边不一致是有意的。
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(props.initialFilter ?? 'all')
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  /**
   * 「业务设置」那一屏自己的三项（看板 / 日历 / 舆情）。
   * 它只在 `sourceFilter === 'dashboard'`（业务设置页签）时生效；切到别的页签就回到那面的树。
   */
  /**
   * 抽屉这条筛选页签：**五块、值不变**。业务设置那一屏也要常显这一条（它是上层，三项列表是下层），
   * 所以这份清单提到函数里，两处共用一份。
   */
  const treeFilters = [
    { value: 'all', labelKey: 'settings.intelligenceSources.sourceFilters.all' },
    { value: 'dashboard', labelKey: 'settings.intelligenceSources.sourceFilters.dashboard' },
    { value: 'calendar', labelKey: 'settings.intelligenceSources.sourceFilters.calendar' },
    { value: 'sentiment', labelKey: 'settings.intelligenceSources.sourceFilters.sentiment' },
    { value: 'other', labelKey: 'settings.intelligenceSources.sourceFilters.other' }
  ] as const
  const settings = useIntelligenceSourcesSettings(t)
  const { settingsView, runSourceNow, toggleSourceEnabled, setDraftDirty, profiles, definitions, updateSourceProfile } = settings
  // 草稿既喂 hook 里的 C8 标志（同屏保存/重读用），也上报宿主（关闭确认用）——两个消费者，一个事实。
  const reportDraftDirty = useCallback((dirty: boolean) => {
    setDraftDirty(dirty)
    props.onDraftChange?.(dirty)
  }, [props.onDraftChange, setDraftDirty])

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

  // 四态：读不到是**错误态 + 真重试**，确实没有源是**空态**，加载中不许把树画成「没有源」。
  // 这三条以前由抽屉里那套扁平源行给，扁平屏退役后必须落在这里，否则「读不到」会被画成「一个源都没配」。
  const state = sourcesPanelState({ errorCode: settings.errorCode, loading: settings.loading, view: settingsView })
  if (state === 'loading') {
    return <div className="config-drawer__sources-state" data-sources-state="loading"><LoadingState label={t.loading} fill /></div>
  }
  if (state === 'error') {
    return <div className="config-drawer__sources-state" data-sources-state="error">
      <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: settings.reload }}
        reasonCode="unreadable"
        size="md"
        state="error" />
    </div>
  }
  if (state === 'empty') {
    return <div className="config-drawer__sources-state" data-sources-state="empty">
      <StateView reasonCode="not-yet" size="md" state="empty" />
    </div>
  }

  return <SourcesSettingsPane
    /* 格级开关的读写：与看板读取链**同一个客户端实例**（同一份存储，不各建一份）。 */
    cellEnabledIo={{ read: () => cellEnabledClient.read(), write: (cellId, enabled) => cellEnabledClient.write(cellId, enabled) }}
    filter={sourceFilter}
    /* 抽屉五块：全部 / 看板 / 日历 / 舆情 / 其他（第四块是兜底）（用户 2026-11-10：先砍掉「全部」「高级」，
       随后要求把「全部」恢复到 tab 最前；「高级」仍不要）。默认筛选仍是**看板**。设置页仍是原来的六项。 */
    treeFilters={treeFilters}
    onFilterChange={setSourceFilter}
    onSelectProvider={(providerId) => setSelectedProviderId(providerId)}
    selectedProviderId={selectedProviderId}
    surface={{
      text: t,
      policy: { labels: t.collectionPolicy, onChange: updateSourceProfile, profiles: policyProfiles, supportsSentimentById },
      supportsRunNowById,
      onRunNow: runSourceNow,
      onToggleSource: toggleSourceEnabled,
      onDraftChange: reportDraftDirty,
      showSourceDetails: true,
      surface: 'settings'
    }}
    treeLabels={{ title: t.title, categories: t.sourceCategories, providerNames: t.providerNames, providerSummary: t.providerSummary, unavailableCountOne: t.unavailableCountOne, unavailableCountOther: t.unavailableCountOther }}
    view={settingsView} />
}

/**
 * 这一屏的四态判据（纯函数：加载 / 读不到 / 确实没有 / 就绪）。
 *
 * - `view` 还没到、也还没报错 → **loading**。这一档不能画成空列表：读者会以为一个源都没配；
 * - 没有 `view` 且已有错误码 → **error**（要能重试，不能退化成空态）；
 * - 读到了但一个供应商都没有 → **empty**（这才是「确实没有」）；
 * - 其余 → ready。
 */
export function sourcesPanelState(input: Readonly<{
  loading: boolean
  errorCode: string | null
  view: { groups: readonly { providers: readonly unknown[] }[] } | undefined
}>): 'loading' | 'error' | 'empty' | 'ready' {
  if (input.view === undefined) return input.errorCode === null ? 'loading' : 'error'
  return input.view.groups.some((group) => group.providers.length > 0) ? 'ready' : 'empty'
}

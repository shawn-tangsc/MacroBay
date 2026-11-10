import { useEffect, useMemo, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { Info } from 'lucide-react'
import { Select, Switch, Typography } from 'antd'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { NewsSentimentSettingsView } from '../../../service/intelligence/schema/newsSentiment'
import { newsSentimentClient } from '../../shared/ipc/newsSentimentClient'
import { productText } from '../../shared/i18n/productText'
import { TranslationPreferencesSection } from '../../settings/intelligence-sources/TranslationPreferencesSection'
import { useIntelligenceTranslationSettings } from '../../settings/intelligence-sources/useIntelligenceTranslationSettings'

/**
 * 配置抽屉「内容处理」那一屏：翻译偏好搬设置页的同一份实现，评分模型这一行**可以在这里改**
 * （用户 2026-11-10：抽屉要做散落配置的唯一集中入口，原来那个弹框的活搬到这里）。
 *
 * 评分模型这一行的四条口径：
 * - **关着只写「规则判断」，不画灰掉的下拉**——灰掉的下拉是假控件，读者会以为点不动是坏了；
 * - **选中即保存**（这一屏没有保存按钮），写口只有 `newsSentiment.saveSettings` 一条：
 *   保存失败当场说、控件留在原值，保存中禁用，不许连点发第二次写；
 * - **读不到是「未知」+ 原因进 ⓘ**，不许落成「规则判断」——那是设置明说的另一件事；
 * - 读不到时**不给写口**：不知道现在是什么，就不许盲写。
 *
 * 翻译偏好用的是设置页那张卡（`TranslationPreferencesSection` + `useIntelligenceTranslationSettings`），
 * 一个字段都没有新画。
 *
 * 这一屏不画标题：标题归抽屉（不做嵌套标题）。
 */
export function ProcessingSettingsPanel(): React.ReactElement {
  const language = useShellLanguage()
  const sourcesText = productText[language].settings.intelligenceSources
  const copy = productText[language].pages.intelligence.portal.dashboard.configDrawer
  const settingsText = productText[language].pages.intelligence.portal.newsSentiment.settingsModal
  const translation = useIntelligenceTranslationSettings(sourcesText.translationPreferences)
  const sentiment = useSentimentModelSettings()

  const options = useMemo(() => {
    if (sentiment.state !== 'ready') return []
    const models = sentiment.providers.flatMap((provider) =>
      provider.models
        .filter((model) => model.capabilities.chat)
        .map((model) => ({ value: `${provider.id}:${model.id}`, label: `${provider.name} · ${model.name}` }))
    )
    const follow = sentiment.defaultFastName === undefined
      ? settingsText.fastUnset
      : settingsText.followFast.replace('{name}', sentiment.defaultFastName)
    return [{ value: '', label: follow }, ...models]
  }, [sentiment, settingsText.fastUnset, settingsText.followFast])

  const valueText = sentiment.state === 'unreadable'
    ? copy.values.autoUnknown
    : sentiment.state === 'ready' && !sentiment.enabled
      ? copy.values.sentimentRuleOnly
      : ''

  return <div className="config-drawer-processing" data-processing-panel="true">
    {/* 设置页那张翻译卡：`sourceIds` 不传 = 全局口径（这一屏不针对某个源）。 */}
    {language !== 'en-US' ? <TranslationPreferencesSection
      errorMessage={translation.errorMessage}
      labels={sourcesText.translationPreferences}
      loading={translation.loading}
      modelProviders={translation.modelProviders}
      moduleStatus={translation.moduleStatus}
      notice={translation.notice}
      onChange={(patch) => void translation.updateSettings(patch)}
      onQueueMissing={() => void translation.queueMissing([])}
      queuing={translation.queuing}
      savedThisSession={translation.savedThisSession}
      saving={translation.saving}
      settings={translation.settings}
    /> : null}
    <div className="config-drawer__row" data-drawer-row="sentimentModel">
      <span className="config-drawer__label">
        {copy.rows.sentimentModel}
        {/* 原因只进 ⓘ：正文只留「未知」两个字（与日报那一行同一条判据）。 */}
        {sentiment.state === 'unreadable'
          ? <Popover
            content={<span>{copy.values.sentimentUnknownReason}</span>}
            trigger={(triggerProps) => (
              <IconButton
                {...triggerProps}
                ariaLabelKey="configDrawer.rowReason"
                icon={Info}
                onSelect={() => undefined}
                resolveText={(key: string) => (key === 'configDrawer.rowReason' ? copy.values.sentimentUnknownReason : '')}
                size="sm" />
            )} />
          : null}
      </span>
      {sentiment.state === 'ready' && sentiment.enabled
        ? <Select
          aria-label={copy.rows.sentimentModel}
          disabled={sentiment.saving}
          onChange={(next) => void sentiment.selectModel(String(next))}
          options={options}
          size="small"
          value={sentiment.modelRef} />
        : <span className="config-drawer__value">{valueText}</span>}
      {sentiment.state === 'ready'
        ? <Switch
          aria-label={settingsText.modelScoring}
          checked={sentiment.enabled}
          disabled={sentiment.saving}
          onChange={(next) => void sentiment.setEnabled(next)}
          size="small" />
        : null}
      {sentiment.saveFailed ? <Text role="status" type="danger">{settingsText.failed}</Text> : null}
    </div>
  </div>
}

const { Text } = Typography

type SentimentModelState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'unreadable' }>
  | Readonly<{
    state: 'ready'
    enabled: boolean
    /** `providerId:modelId`；空串＝跟随快速模型（与设置里 `providerId/modelId` 留空同一含义）。 */
    modelRef: string
    providers: readonly SafeModelProvider[]
    defaultFastName?: string
  }>

type SentimentModelActions = {
  saving: boolean
  saveFailed: boolean
  setEnabled: (next: boolean) => Promise<void>
  selectModel: (ref: string) => Promise<void>
}

/**
 * 评分模型那一格：读设置 + 两个写动作（开关、下拉）。**写失败不落成成功**——只有服务返回的
 * `NewsSentimentSettingsView` 说了算，失败就留在原值并当场提示。
 *
 * `resolution.source` 的三种情况照旧：`platform-fast` 是跟随快速模型（有名字就带上），
 * `explicit` 要把 `providerId/modelId` 翻成名字，翻不出来就是「读不到」，不是「跟随」。
 */
function useSentimentModelSettings(): SentimentModelState & SentimentModelActions {
  const [state, setState] = useState<SentimentModelState>({ state: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const view = await newsSentimentClient.getSettings()
        const providers = await window.platform?.modelProviders?.list().catch(() => []) as SafeModelProvider[] | undefined
        if (!active) return
        setState(toSentimentModelState(view, providers ?? []))
      } catch {
        if (active) setState({ state: 'unreadable' })
      }
    })()
    return () => { active = false }
  }, [])

  const write = async (patch: { modelScoringEnabled?: boolean; providerId?: string; modelId?: string }): Promise<void> => {
    if (saving || state.state !== 'ready') return
    setSaving(true)
    setSaveFailed(false)
    try {
      const view = await newsSentimentClient.saveSettings(patch)
      setState(toSentimentModelState(view, state.providers))
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return {
    ...state,
    saving,
    saveFailed,
    setEnabled: (next) => write({ modelScoringEnabled: next }),
    selectModel: (ref) => {
      const [providerId = '', modelId = ''] = ref.split(':')
      return write({ providerId, modelId })
    }
  }
}

function toSentimentModelState(
  view: NewsSentimentSettingsView,
  providers: readonly SafeModelProvider[]
): SentimentModelState {
  const defaultFastName = view.defaultFastModel?.name
  if (!view.settings.modelScoringEnabled) {
    return { state: 'ready', enabled: false, modelRef: '', providers, defaultFastName }
  }
  const { resolution } = view
  if (resolution.source === 'platform-fast') {
    return { state: 'ready', enabled: true, modelRef: '', providers, defaultFastName }
  }
  if (resolution.source === 'explicit') {
    const provider = providers.find((candidate) => candidate.id === resolution.providerId)
    const model = provider?.models.find((candidate) => candidate.id === resolution.modelId)
    // 选了模型却翻不出名字（供应商停用、模型下架）：说「读不到」，不冒充跟随、也不显示裸 id。
    if (model === undefined) return { state: 'unreadable' }
    return {
      state: 'ready',
      enabled: true,
      modelRef: `${resolution.providerId ?? ''}:${resolution.modelId ?? ''}`,
      providers,
      defaultFastName
    }
  }
  return { state: 'unreadable' }
}

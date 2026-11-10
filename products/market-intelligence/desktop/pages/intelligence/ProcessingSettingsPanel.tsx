import { useEffect, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { Info } from 'lucide-react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { newsSentimentClient } from '../../shared/ipc/newsSentimentClient'
import { productText } from '../../shared/i18n/productText'
import { TranslationPreferencesSection } from '../../settings/intelligence-sources/TranslationPreferencesSection'
import { useIntelligenceTranslationSettings } from '../../settings/intelligence-sources/useIntelligenceTranslationSettings'

/**
 * 配置抽屉「内容处理」那一屏：**翻译偏好那块直接搬设置页的同一份实现**，评分模型只读。
 *
 * 用户 2026-11-10：「现成的东西，挪进去不就行了吗」。所以：
 * - 翻译偏好用的是设置页那张卡（`TranslationPreferencesSection` + `useIntelligenceTranslationSettings`），
 *   一个字段都没有新画；
 * - 评分模型没有可导航的设置页（它的设置面是舆情卡片里的弹框），所以这一屏**只读**：
 *   说清楚现在是「规则判断」「跟随快速模型」还是某个具体模型；读不到就是「未知」+ 原因进 ⓘ，
 *   **不落成「规则判断」**——那是另一件事。
 *
 * 这一屏不画标题：标题归抽屉（不做嵌套标题）。
 */
export function ProcessingSettingsPanel(): React.ReactElement {
  const language = useShellLanguage()
  const sourcesText = productText[language].settings.intelligenceSources
  const copy = productText[language].pages.intelligence.portal.dashboard.configDrawer
  const translation = useIntelligenceTranslationSettings(sourcesText.translationPreferences)
  const sentiment = useSentimentModelFact()

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
      <span className="config-drawer__value">{sentiment.state === 'ready' ? sentiment.value : copy.values.autoUnknown}</span>
    </div>
  </div>
}

type SentimentFact =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'ready'; value: string }>
  | Readonly<{ state: 'unreadable' }>

/**
 * 评分模型那一格现在是哪一档：**三种真话**，不替读者挑一个。
 *
 * `modelScoringEnabled` 关着时是「规则判断」（这是设置明说的，不是没读到的兜底）；
 * 开着则看 `resolution.source`：`platform-fast` 是跟随快速模型（有名字就带上），
 * `explicit` 要把 `providerId/modelId` 翻成名字，翻不出来就是「读不到」，不是「跟随」。
 */
function useSentimentModelFact(): SentimentFact {
  const language = useShellLanguage()
  const copy = productText[language].pages.intelligence.portal.dashboard.configDrawer
  const [fact, setFact] = useState<SentimentFact>({ state: 'loading' })

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const view = await newsSentimentClient.getSettings()
        const providers = await window.platform?.modelProviders?.list().catch(() => []) as SafeModelProvider[] | undefined
        if (!active) return
        if (!view.settings.modelScoringEnabled) {
          setFact({ state: 'ready', value: copy.values.sentimentRuleOnly })
          return
        }
        const { resolution } = view
        if (resolution.source === 'platform-fast') {
          setFact({
            state: 'ready',
            value: view.defaultFastModel === undefined
              ? copy.values.sentimentFollowsFastModel
              : `${copy.values.sentimentFollowsFastModel} · ${view.defaultFastModel.name}`
          })
          return
        }
        if (resolution.source === 'explicit') {
          const provider = (providers ?? []).find((candidate) => candidate.id === resolution.providerId)
          const model = provider?.models.find((candidate) => candidate.id === resolution.modelId)
          // 选了模型却翻不出名字（供应商停用、模型下架）：说「读不到」，不冒充跟随。
          setFact(model === undefined ? { state: 'unreadable' } : { state: 'ready', value: `${provider?.name ?? ''} / ${model.name}` })
          return
        }
        setFact({ state: 'unreadable' })
      } catch {
        if (active) setFact({ state: 'unreadable' })
      }
    })()
    return () => { active = false }
  }, [copy.values.sentimentFollowsFastModel, copy.values.sentimentRuleOnly])

  return fact
}

import { useMemo, useState } from 'react'

import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import {
  buildModelPickerOptions,
  type ModelPickerCandidate,
  type ModelPickerConstraints,
  type ModelPickerOption
} from '../components/ModelPicker/modelPickerOptions'
import { platformText } from '../../i18n/platformText'
import { buildAgentModelOptions, flattenAgentModelOptions } from './agentModelOptions'
import {
  buildAgentMentionModelQuickPanelItems,
  toAgentMentionedModel
} from './agentMentionedModelQuickPanel'
import {
  removeAgentMentionedModelToken,
  toggleAgentMentionedModel,
  type AgentMentionedModel
} from './agentMentionedModels'
import type { AgentQuickPanelItem } from './agentQuickPanel'

/**
 * `@` 面板（智能体上下文）的候选约束（唯一事实）：与工具栏同一套 messages 硬约束，
 * 已下线由数据层默认剔除。
 */
export const AGENT_MENTION_MODEL_CONSTRAINTS: ModelPickerConstraints = {
  requireCapabilities: ['chat'],
  protocols: ['messages']
}

type UseAgentMentionModelsInput = {
  providers: SafeModelProvider[]
  agentType: string | undefined
  pinnedModelIds: readonly string[]
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  /** 当前界面语言：组标题的厂商展示名从同一份 i18n 表取（不另传一份映射）。 */
  language: AppLanguage
  text: {
    clearMentionedModels: string
    clearMentionedModelsDescription: string
    openModelService: string
    openModelServiceDescription: string
    pinnedSectionLabel: string
  }
}

export function useAgentMentionModels(input: UseAgentMentionModelsInput) {
  const [mentionedModels, setMentionedModels] = useState<AgentMentionedModel[]>([])
  // PLAT-70：@ 提及只列**可选**的模型（明确不可用 ⇒ 不提供提及，避免选完就跑失败）。
  const candidates = useMemo<ModelPickerCandidate[]>(
    () =>
      flattenAgentModelOptions(
        buildAgentModelOptions(input.providers, input.agentType, input.compatibilityByModelKey)
      )
        .filter((option) => option.selectable)
        .map((option) => ({ providerId: option.providerId, model: option.model })),
    [input.agentType, input.compatibilityByModelKey, input.providers]
  )
  const groups = useMemo(
    () =>
      buildModelPickerOptions(
        candidates,
        input.providers,
        AGENT_MENTION_MODEL_CONSTRAINTS,
        platformText[input.language].models
      ).groups,
    [candidates, input.language, input.providers]
  )
  const optionMap = useMemo(() => {
    const next = new Map<string, ModelPickerOption>()
    for (const group of groups) {
      for (const option of group.options) next.set(option.value, option)
    }
    return next
  }, [groups])
  const quickPanelItems = useMemo(
    () =>
      buildAgentMentionModelQuickPanelItems(groups, mentionedModels, {
        clearLabel: input.text.clearMentionedModels,
        clearDescription: input.text.clearMentionedModelsDescription,
        addLabel: input.text.openModelService,
        addDescription: input.text.openModelServiceDescription,
        pinnedSectionLabel: input.text.pinnedSectionLabel
      }, input.pinnedModelIds),
    [groups, input.pinnedModelIds, input.text.clearMentionedModels, input.text.clearMentionedModelsDescription, input.text.openModelService, input.text.openModelServiceDescription, input.text.pinnedSectionLabel, mentionedModels]
  )

  function toggleByItemId(itemId: string): AgentMentionedModel[] {
    const value = itemId.replace('mention:', '')
    const option = optionMap.get(value)
    if (!option) return [...mentionedModels]
    const next = toggleAgentMentionedModel(mentionedModels, toAgentMentionedModel(option))
    setMentionedModels(next)
    return next
  }

  function removeByValue(value: string): void {
    setMentionedModels((current) => current.filter((item) => item.value !== value))
  }

  function clear(): void {
    setMentionedModels([])
  }

  function isMentionItem(item: AgentQuickPanelItem): boolean {
    return item.id.startsWith('mention:')
  }

  function cleanTriggerText(text: string, selectionStart: number, triggerStart?: number | null): string {
    return removeAgentMentionedModelToken(text, selectionStart, triggerStart ?? null)
  }

  return {
    mentionedModels,
    setMentionedModels,
    mentionItems: quickPanelItems,
    isMentionItem,
    toggleByItemId,
    removeByValue,
    clear,
    cleanTriggerText
  }
}

import { resolveModelVisual } from '@platform/ui/icons/modelProviderVisuals'
import { CircleX, Plus } from 'lucide-react'

import { VisualIdentityAvatar } from '../VisualIdentityAvatar'
import {
  matchesModelPickerQuery,
  type ModelPickerGroup,
  type ModelPickerOption
} from '../components/ModelPicker/modelPickerOptions'
import type { AgentMentionedModel } from './agentMentionedModels'
import type { AgentQuickPanelItem } from './agentQuickPanel'

type AgentMentionModelQuickPanelText = {
  clearLabel: string
  clearDescription: string
  addLabel: string
  addDescription: string
  pinnedSectionLabel: string
}

/**
 * `@` 面板的模型项：**分组 / 搜索 / 已下线过滤与外层一致**，全部来自
 * `modelPickerOptions`（这里不重算候选、不另写匹配规则），面板只保留自己的浮层形态与动作项。
 */
export function buildAgentMentionModelQuickPanelItems(
  groups: readonly ModelPickerGroup[],
  selected: readonly AgentMentionedModel[],
  text: AgentMentionModelQuickPanelText,
  pinnedModelIds: readonly string[] = []
): AgentQuickPanelItem[] {
  const selectedIds = new Set(selected.map((item) => item.value))
  const optionMap = new Map(groups.flatMap((group) => group.options).map((option) => [option.value, option]))
  const pinnedOptions = pinnedModelIds
    .map((id) => optionMap.get(id))
    .filter((option): option is ModelPickerOption => Boolean(option))
  const pinnedIds = new Set(pinnedOptions.map((option) => option.value))
  return [
    {
      id: 'action:clear-mentioned-models',
      label: text.clearLabel,
      description: text.clearDescription,
      keywords: ['clear', 'reset', 'models'],
      group: 'actions',
      alwaysVisible: true,
      sectionKey: 'actions:manage',
      sectionLabel: '',
      icon: <CircleX size={16} />
    },
    ...pinnedOptions.map((option) =>
      buildAgentMentionModelQuickPanelItem(option, selectedIds.has(option.value), {
        sectionKey: 'pinned',
        sectionLabel: text.pinnedSectionLabel
      })
    ),
    ...groups.flatMap((group) =>
      group.options
        .filter((option) => !pinnedIds.has(option.value))
        .map((option) =>
          buildAgentMentionModelQuickPanelItem(option, selectedIds.has(option.value), {
            sectionKey: `provider:${group.providerId}`,
            sectionLabel: group.providerName
          })
        )
    ),
    {
      id: 'action:open-model-service',
      label: text.addLabel,
      description: text.addDescription,
      keywords: ['add', 'model', 'provider', 'settings'],
      group: 'actions',
      sectionKey: 'actions:manage',
      sectionLabel: '',
      icon: <Plus size={16} />
    }
  ]
}

export function toAgentMentionedModel(option: ModelPickerOption): AgentMentionedModel {
  return {
    value: option.value,
    label: option.modelName,
    providerId: option.providerId,
    providerName: option.providerName
  }
}

function buildAgentMentionModelQuickPanelItem(
  option: ModelPickerOption,
  selected: boolean,
  section: Pick<AgentQuickPanelItem, 'sectionKey' | 'sectionLabel'>
): AgentQuickPanelItem {
  return {
    id: `mention:${option.value}`,
    label: option.modelName,
    description: option.providerName,
    sectionKey: section.sectionKey,
    sectionLabel: section.sectionLabel,
    filterText: option.searchText,
    // 模糊匹配与选择器同一份实现（`dsv3` 命中 `deepseek-ai/DeepSeek-V3`）。
    matchQuery: (query) => matchesModelPickerQuery(option.searchText, query),
    icon: (
      <VisualIdentityAvatar
        visual={resolveModelVisual(option.modelId, option.modelName, option.providerId, option.providerName)}
        size={18}
      />
    ),
    selected,
    keywords: ['mention', '@', option.providerName, option.modelName],
    group: 'models'
  }
}

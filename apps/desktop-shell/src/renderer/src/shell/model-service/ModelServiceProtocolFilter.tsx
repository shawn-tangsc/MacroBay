import { FilterChip, FilterChipGroup } from '@platform/ui/components/filter-chip'

import type { PlatformText } from '../../i18n/platformText'

import {
  MODEL_PROTOCOL_TABS,
  type ModelProtocolCounts,
  type ModelProtocolFilter,
  type ModelProtocolTab
} from './modelProtocolFilter'

/** 协议筛选胶囊的键：字面量只写这一处（`FilterChip` 只收键）。 */
const PROTOCOL_FILTER_KEYS: Record<ModelProtocolTab, string> = {
  'chat-completions': 'models.protocolFilterChat',
  responses: 'models.protocolFilterResponses',
  messages: 'models.protocolFilterMessages',
  gemini: 'models.protocolFilterGemini'
}

/** 这一组筛选的名字（`role="group"` 的 `aria-label`），复用「协议」这个名字。 */
const PROTOCOL_FILTER_GROUP_KEY = 'models.pickerFilterProtocols'

/**
 * PLAT-77 / PLAT-81：协议筛选 pill 行（第二行）。
 *
 * 恰好 4 个 pill（没有「全部协议」项）：可多选、与类型筛选叠加（AND）；
 * 全部取消选中 = 不按协议过滤（等价「全部」，但界面上不存在这个 pill）。
 */
export function ModelServiceProtocolFilter({
  labels,
  active,
  counts,
  onToggle
}: {
  labels: PlatformText['models']
  active: ModelProtocolFilter
  counts: ModelProtocolCounts
  onToggle: (tab: ModelProtocolTab) => void
}): React.ReactElement {
  const resolveText = (key: string): string => {
    const tab = MODEL_PROTOCOL_TABS.find(({ key: tabKey }) => PROTOCOL_FILTER_KEYS[tabKey] === key)
    if (tab !== undefined) return labels[tab.labelKey]
    return key === PROTOCOL_FILTER_GROUP_KEY ? labels.pickerFilterProtocols : ''
  }

  // 图标不再进胶囊（界面设计 2026-11-02：协议名文字里已经写清，图标是第二套语言）。
  return (
    // `data-model-protocol-filter` 是调用点自己的定位钩子（既有测试与样式用它找这一行），不是组件 API。
    <div data-model-protocol-filter>
      <FilterChipGroup ariaLabelKey={PROTOCOL_FILTER_GROUP_KEY} resolveText={resolveText}>
        {MODEL_PROTOCOL_TABS.map(({ key }) => (
          <FilterChip
            key={key}
            labelKey={PROTOCOL_FILTER_KEYS[key]}
            count={String(counts[key])}
            pressed={active[key]}
            onPressedChange={() => onToggle(key)}
            resolveText={resolveText}
          />
        ))}
      </FilterChipGroup>
    </div>
  )
}

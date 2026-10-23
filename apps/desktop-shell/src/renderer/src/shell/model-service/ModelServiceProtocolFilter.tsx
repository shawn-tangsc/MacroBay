import { ArrowLeftRight, MessageSquare, Sparkles, Waypoints } from 'lucide-react'

import { getProviderIconUrl } from '../visualIconAssets'

import type { PlatformText } from '../../i18n/platformText'

import {
  MODEL_PROTOCOL_TABS,
  type ModelProtocolCounts,
  type ModelProtocolFilter,
  type ModelProtocolTab
} from './modelProtocolFilter'

/** 12px lucide 图标、与文字同色、无背景容器（与类型 pill 同一套胶囊样式）。 */
/** 协议 pill 用**品牌 glyph**（simple-icons 单色标记），responses 用带角标的独立文件。 */
const PROTOCOL_ICON_KEYS: Record<ModelProtocolTab, string> = {
  'chat-completions': 'openai-mark',
  responses: 'openai-responses-mark',
  messages: 'anthropic-mark',
  gemini: 'google-mark'
}

function protocolIconUrl(tab: ModelProtocolTab): string | undefined {
  return getProviderIconUrl(PROTOCOL_ICON_KEYS[tab])
}

/** 协议语义符号（与品牌 glyph 并列）：Chat=气泡、Responses=分支、Messages=双向、Gemini=闪光。 */
const PROTOCOL_SEMANTIC_ICONS = {
  'chat-completions': MessageSquare,
  responses: Waypoints,
  messages: ArrowLeftRight,
  gemini: Sparkles
} as const

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
  return (
    <div className="model-service-type-pills model-service-protocol-pills" data-model-protocol-filter>
      {MODEL_PROTOCOL_TABS.map(({ key, labelKey }) => {
        const iconUrl = protocolIconUrl(key)
        const Semantic = PROTOCOL_SEMANTIC_ICONS[key]
        return (
          <button
            key={key}
            type="button"
            className="model-service-type-pill"
            data-model-protocol-tab={key}
            data-active={active[key]}
            aria-pressed={active[key]}
            aria-label={labels[labelKey]}
            onClick={() => onToggle(key)}>
            {iconUrl ? <img className="model-service-protocol-icon" src={iconUrl} alt="" aria-hidden="true" /> : null}
            <Semantic className="model-service-protocol-semantic" size={10} aria-hidden="true" />
            <span>{labels[labelKey]}</span>
            <small>{counts[key]}</small>
          </button>
        )
      })}
    </div>
  )
}

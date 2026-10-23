import { useEffect, useRef, useState } from 'react'
import { Input } from 'antd'
import { Trash2 } from 'lucide-react'

import type {
  ModelChatProtocol,
  ProviderChatEndpoint,
  ProviderImageEndpoints,
  SafeModelProvider
} from '@platform/ai/providers/modelProviderTypes'
import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl,
  normalizeEndpointBase
} from '@platform/ai/providers/providerEndpoints'

import type { PlatformText } from '../../i18n/platformText'

import {
  availableEndpointProtocols,
  canRemoveEndpoint,
  endpointBaseOf,
  prefillEndpointBase,
  removeEndpoint,
  setDefaultEndpoint,
  setEndpointBase
} from './modelServiceDefaultEndpoint'
import { endpointKindLabel, imageEndpointLabel } from './modelServiceEndpointAddress'
import { ModelServiceRequestConfigAddEndpoint } from './ModelServiceRequestConfigAddEndpoint'
import { ModelServiceRequestConfigSectionTitle } from './ModelServiceRequestConfigSectionTitle'

/**
 * PLAT-81 / R3 + T4/T5：请求配置抽屉里的**端点字段**。
 *
 * 两个区块（标题 + 细线分隔，行距 12px 一致）：
 *  1. **聊天端点**：行顺序 = `provider.endpoints` 顺序（`[0]` 即默认端点）；
 *     每行「端点名 + 默认徽章 / 设为默认（+ 删除图标靠右）」+ 整行满宽输入框；
 *  2. **图像**：两个独立 Base URL 字段（不参与默认端点）。
 *
 * 端点清单是唯一事实源：编辑地址 / 添加 / 删除 / 设为默认都直接改写这份数组并立即落库。
 * 「自定义请求头」暂时不暴露 UI（数据层保持不动）。
 */
type ImageEndpointKind = 'generation' | 'edit'

const IMAGE_ENDPOINT_KINDS: readonly ImageEndpointKind[] = ['generation', 'edit']

/** 端点 base → 实际请求 URL（与调用侧同一份派生实现，不在前端另拼）。 */
const PREVIEW_URL_BUILDERS: Record<ModelChatProtocol, (base: string) => string> = {
  'chat-completions': buildChatCompletionsUrl,
  responses: buildResponsesUrl,
  messages: buildMessagesUrl,
  gemini: (base) => buildGeminiGenerateUrl(base, '{model}')
}

export function ModelServiceRequestConfigEndpointFields({
  labels,
  provider,
  endpoints,
  imageEndpoints,
  savingDefaultEndpoint = false,
  onChangeEndpoints,
  onSaveEndpoints,
  onChangeImageEndpoint,
  onSaveImageEndpoint
}: {
  labels: PlatformText['models']
  provider: SafeModelProvider
  /** 端点清单草稿（`[0]` = 默认端点）。 */
  endpoints: readonly ProviderChatEndpoint[]
  imageEndpoints: ProviderImageEndpoints
  /** 端点保存中（只锁「设为默认」按钮）。 */
  savingDefaultEndpoint?: boolean
  onChangeEndpoints: (next: readonly ProviderChatEndpoint[]) => void
  /** 立即持久化整份端点清单（添加 / 删除 / 设为默认 / 地址失焦都走它）。 */
  onSaveEndpoints: (next: readonly ProviderChatEndpoint[]) => Promise<void>
  onChangeImageEndpoint: (kind: ImageEndpointKind, value: string) => void
  onSaveImageEndpoint: (kind: ImageEndpointKind, value: string | undefined) => Promise<void>
}): React.ReactElement {
  /** 刚加出来的端点行：渲染完成后把焦点落到它的地址输入框。 */
  const [focusProtocol, setFocusProtocol] = useState<ModelChatProtocol | null>(null)
  const inputRefs = useRef(new Map<string, HTMLInputElement | null>([]))

  const availableProtocols = availableEndpointProtocols(endpoints)
  const canDelete = canRemoveEndpoint(endpoints)

  // 选中新端点后，焦点落到它的地址输入框（等新行渲染完再聚焦）。
  useEffect(() => {
    if (!focusProtocol) return
    const input = inputRefs.current.get(focusProtocol)
    if (!input) return
    input.focus()
    setFocusProtocol(null)
  }, [focusProtocol, endpoints])

  /** 落库前归一：端点的 base 一律 trim + 去尾斜杠（空串保留 = 已声明未配置）。 */
  function normalized(endpointsToSave: readonly ProviderChatEndpoint[]): ProviderChatEndpoint[] {
    return endpointsToSave.map((endpoint) => ({
      protocol: endpoint.protocol,
      baseUrl: normalizeEndpointBase(endpoint.baseUrl)
    }))
  }

  /** 端点清单是数组：写入的永远是整份清单（草稿 + 立即落库）。 */
  function commit(next: readonly ProviderChatEndpoint[]): void {
    onChangeEndpoints(next)
    void onSaveEndpoints(normalized(next))
  }

  function addEndpoint(protocol: ModelChatProtocol): void {
    setFocusProtocol(protocol)
    commit(setEndpointBase(endpoints, protocol, prefillEndpointBase(protocol, provider)))
  }

  function removeChatEndpoint(protocol: ModelChatProtocol): void {
    commit(removeEndpoint(endpoints, protocol))
  }

  /**
   * 端点行的默认标记：默认 ⇒ 强调色徽章（不可点）；其余**已配置**的 ⇒ 「设为默认」小按钮。
   * 两者互斥，永远只出现一个。
   */
  function renderDefaultMarker(protocol: ModelChatProtocol, liveValue: string): React.ReactElement | null {
    if (endpoints[0]?.protocol === protocol) {
      return (
        <span className="request-config-default-badge" data-endpoint-default-badge={protocol}>
          {labels.endpointDefaultBadge}
        </span>
      )
    }
    // 「已配置」按当前输入框里的实时值判断：刚填好地址就能设为默认，不用等失焦保存。
    if (!normalizeEndpointBase(liveValue)) return null
    return (
      <button
        type="button"
        className="request-config-set-default"
        data-endpoint-set-default={protocol}
        disabled={savingDefaultEndpoint}
        onClick={() => commit(setDefaultEndpoint(endpoints, protocol))}>
        {labels.endpointSetDefault}
      </button>
    )
  }

  /** 输入框下方的灰色实时预览：存的是 base，叶子由 `providerEndpoints` 统一拼。 */
  function renderPreview(protocol: ModelChatProtocol, value: string): React.ReactElement {
    const base = normalizeEndpointBase(value)
    const url = base ? PREVIEW_URL_BUILDERS[protocol](base) : '—'
    return (
      <span className="request-config-reserved" data-endpoint-preview={protocol} style={{ marginTop: 2 }}>
        {labels.endpointActualRequestLabel(url)}
      </span>
    )
  }

  /** 删除图标（只在可删的端点行；只剩一个端点时禁用并提示原因）。 */
  function renderDelete(protocol: ModelChatProtocol): React.ReactElement {
    return (
      <button
        type="button"
        className="request-config-delete"
        data-endpoint-delete={protocol}
        aria-label={labels.endpointDelete}
        title={canDelete ? labels.endpointDelete : labels.endpointKeepAtLeastOne}
        disabled={!canDelete}
        onClick={() => removeChatEndpoint(protocol)}>
        <Trash2 size={14} />
      </button>
    )
  }

  return (
    <>
      <ModelServiceRequestConfigSectionTitle first>{labels.requestConfigChatEndpoints}</ModelServiceRequestConfigSectionTitle>

      {endpoints.map((endpoint) => {
        const protocol = endpoint.protocol
        const value = endpointBaseOf(endpoints, protocol)
        return (
          <div
            key={protocol}
            className="request-config-endpoint-block"
            data-request-config-endpoint={protocol}>
            <div className="request-config-endpoint-head">
              <span className="request-config-endpoint-name">{endpointKindLabel(labels, protocol)}</span>
              {renderDefaultMarker(protocol, value)}
              {renderDelete(protocol)}
            </div>
            <Input
              ref={(node) => {
                inputRefs.current.set(protocol, node?.input ?? null)
              }}
              data-endpoint-input={protocol}
              value={value}
              placeholder={protocol === 'gemini' ? labels.endpointGeminiHostPlaceholder : 'https://example.com'}
              onChange={(event) => onChangeEndpoints(setEndpointBase(endpoints, protocol, event.target.value))}
              onBlur={() => void onSaveEndpoints(normalized(endpoints))}
            />
            {renderPreview(protocol, value)}
            {protocol === 'gemini' ? (
              <span className="request-config-reserved" data-endpoint-gemini-hint style={{ marginTop: 2 }}>
                {labels.endpointGeminiHostHint}
              </span>
            ) : null}
          </div>
        )
      })}

      <div style={{ marginTop: 12 }}>
        <ModelServiceRequestConfigAddEndpoint
          labels={labels}
          availableProtocols={availableProtocols}
          onAdd={addEndpoint}
        />
      </div>

      <ModelServiceRequestConfigSectionTitle>{labels.requestConfigImageEndpoints}</ModelServiceRequestConfigSectionTitle>

      {IMAGE_ENDPOINT_KINDS.map((kind) => (
        <div key={kind} className="request-config-endpoint-block" data-request-config-image-endpoint={kind}>
          <div className="request-config-endpoint-head">
            <span className="request-config-endpoint-name">{imageEndpointLabel(labels, kind)}</span>
          </div>
          <Input
            data-endpoint-input={kind}
            value={imageEndpoints[kind] ?? ''}
            placeholder={labels.requestConfigImageBasePlaceholder}
            onChange={(event) => onChangeImageEndpoint(kind, event.target.value)}
            onBlur={() => void onSaveImageEndpoint(kind, imageEndpoints[kind])}
          />
          <p className="request-config-reserved" data-endpoint-image-hint={kind} style={{ margin: 0 }}>
            {imageHint(labels, kind)}
          </p>
        </div>
      ))}
    </>
  )
}

function imageHint(labels: PlatformText['models'], kind: ImageEndpointKind): string {
  return kind === 'generation' ? labels.requestConfigImageGenerationHint : labels.requestConfigImageEditHint
}

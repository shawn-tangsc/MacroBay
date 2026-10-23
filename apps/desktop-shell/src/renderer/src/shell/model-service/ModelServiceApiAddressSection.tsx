import { Input } from 'antd'
import { Settings2 } from 'lucide-react'

import type { ModelChatProtocol, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '@platform/ai/providers/providerChatEndpoints'
import {
  buildChatCompletionsUrl,
  buildGeminiGenerateUrl,
  buildMessagesUrl,
  buildResponsesUrl
} from '@platform/ai/providers/providerEndpoints'

import type { PlatformText } from '../../i18n/platformText'

import { endpointKindLabel } from './modelServiceEndpointAddress'

/**
 * PLAT-62 / PLAT-81：API 地址区块 —— **只保留摘要**。
 *
 * ```
 * API 地址   添加端点
 * ┌─────────────────────────────────────┐ ⚙
 * │ https://api.siliconflow.cn          │      ← 只读地址框（展示主 base）
 * └─────────────────────────────────────┘
 * Chat [默认]  Anthropic Messages              ← 端点种类标签（11px 灰、无背景）
 * ```
 *
 * T4/T5：标签列的是**端点种类**而不是协议名，顺序 = `provider.endpoints` 顺序，
 * **`endpoints[0]` 就是默认端点**（带「默认」徽章并高亮）。
 * 图像生成/编辑是另一个维度（抽屉「图像」区块），不出现在这里。
 *
 * R3 第二阶段（用户要求）：**所有端点编辑都只在「请求配置」抽屉里**。这里不再有内联编辑态：
 * 点地址框、齿轮、「添加端点」三者都打开同一个抽屉（添加端点的浮层下拉在抽屉里点触发按钮才展开）。
 */
export type EndpointSummaryTag = {
  /** 端点协议，也是标签的 data 键与默认标记依据。 */
  protocol: ModelChatProtocol
  label: string
  url: string
  isDefault: boolean
}

/** Gemini 的占位模型名：标签 tooltip 只展示路径形状，真实模型在抽屉/检测里选。 */
const GEMINI_MODEL_PLACEHOLDER = '{model}'

/**
 * 标签 tooltip 的完整地址 —— base 走端点唯一读取口，叶子路径**复用 `providerEndpoints.ts`**。
 */
function endpointUrlFor(provider: SafeModelProvider, protocol: ModelChatProtocol): string {
  const base = resolveProviderChatBase(provider, protocol)
  if (!base) return ''
  if (protocol === 'chat-completions') return buildChatCompletionsUrl(base)
  if (protocol === 'responses') return buildResponsesUrl(base)
  if (protocol === 'gemini') return buildGeminiGenerateUrl(base, GEMINI_MODEL_PLACEHOLDER)
  return buildMessagesUrl(base)
}

/**
 * 只列**已配置**（base 非空）的端点。
 *
 * 默认徽章按**清单里的第一条**判，而不是按过滤后的下标：`endpoints[0]` 恰好没填地址时，
 * 过滤会把第二条推到下标 0，用下标会把「默认」错挂到别的端点上。
 */
export function buildEndpointSummaryTags(
  labels: PlatformText['models'],
  provider: SafeModelProvider
): EndpointSummaryTag[] {
  const defaultProtocol = provider.endpoints[0]?.protocol
  return provider.endpoints
    .filter((endpoint) => Boolean(resolveProviderChatBase(provider, endpoint.protocol)))
    .map((endpoint) => ({
      protocol: endpoint.protocol,
      label: endpointKindLabel(labels, endpoint.protocol),
      url: endpointUrlFor(provider, endpoint.protocol),
      isDefault: endpoint.protocol === defaultProtocol
    }))
}

export function ModelServiceApiAddressSection({
  labels,
  provider,
  onOpenRequestConfig
}: {
  labels: PlatformText['models']
  provider: SafeModelProvider
  /** 打开唯一编辑入口（请求配置抽屉）—— 端点编辑/添加都在抽屉里。 */
  onOpenRequestConfig: () => void
}): React.ReactElement {
  const tags = buildEndpointSummaryTags(labels, provider)
  const base = provider.baseUrl.trim()

  return (
    <section className="model-service-api-address" data-api-address-section>
      <div className="model-service-endpoint-summary-head">
        <span className="model-service-api-address-title">{labels.apiAddress}</span>
        <button
          type="button"
          className="model-service-add-endpoint"
          data-add-endpoint
          onClick={onOpenRequestConfig}>
          {labels.requestConfigAddEndpoint}
        </button>
      </div>

      <div className="model-service-endpoint-summary-main">
        {/* antd Input（readOnly）：高度/边框/圆角由主题 token 统一提供。 */}
        <Input
          className="model-service-endpoint-summary-input"
          data-endpoint-summary-input
          readOnly
          value={base}
          placeholder={labels.endpointNotSet}
          aria-label={labels.apiAddress}
          title={base}
          /* 只响应点击：抽屉关闭时焦点会还给这个只读框，onFocus 会把抽屉立刻重新打开。 */
          onClick={onOpenRequestConfig}
        />
        <button
          type="button"
          className="model-service-request-config-icon"
          data-request-config-open
          title={labels.requestConfig}
          aria-label={labels.requestConfig}
          onClick={onOpenRequestConfig}>
          <Settings2 size={14} />
        </button>
      </div>

      <div className="model-service-endpoint-summary-tags" data-endpoint-summary-tags>
        {tags.length === 0 ? (
          <span className="model-service-endpoint-summary-empty" data-endpoint-summary-empty>
            {labels.endpointNotConfigured}
          </span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag.protocol}
              className="model-service-endpoint-tag"
              data-endpoint-summary-tag={tag.protocol}
              data-endpoint-summary-url={tag.url}
              data-endpoint-summary-default={tag.isDefault || undefined}
              title={tag.url}
              style={tag.isDefault ? { color: 'var(--text-strong)', borderColor: 'var(--accent)' } : undefined}>
              {tag.label}
              {tag.isDefault ? (
                <span
                  data-endpoint-summary-default-badge
                  style={{
                    marginLeft: 4,
                    padding: '0 4px',
                    borderRadius: 4,
                    background: 'var(--surface-soft)',
                    color: 'var(--muted)',
                    fontSize: 10
                  }}>
                  {labels.endpointDefaultBadge}
                </span>
              ) : null}
            </span>
          ))
        )}
      </div>
    </section>
  )
}

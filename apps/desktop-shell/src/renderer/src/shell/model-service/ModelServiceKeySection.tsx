import { type FocusEvent } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'
import {
  ModelProviderApiKeyField,
  type RevealModelProviderApiKey
} from '../settings/model-service/ModelProviderApiKeyField'

/**
 * PLAT-61：API 密钥分区。
 *
 * - 单框：复用既有 `ModelProviderApiKeyField`（掩码预览 / 眼睛按需 reveal / 30s / 失焦回掩码），
 *   不重写掩码与 reveal 语义；
 * - 行内只保留 `👁`（组件自带）；连接检查已并入连接检查抽屉（入口在品牌块 `data-provider-connection-check`）；
 * - 辅助行左「点击这里获取密钥」（URL 来自 preset 的 `websites.apiKey`），右「多个密钥使用逗号分隔」；
 * - 保存边界：焦点离开整个密钥行才保存。
 * - PLAT-81：删除供应商等次要操作已收进品牌块 `⋯`（见 `ModelServiceProviderMoreMenu`），
 *   本分区不再有 ⚙ 高级面板。
 */
type ModelServiceKeySectionProps = {
  labels: PlatformText['models']
  provider: SafeModelProvider
  apiKeyDraft: string
  onApiKeyDraftChange: (value: string) => void
  /** 失焦保存入口：是否真的发 IPC 由页面决定（空草稿不发）。 */
  onSaveDraft: () => void
  error: string | null
  getKeyUrl?: string
  /** true = 没有专门的 key 页，回落到了控制台/官网。 */
  getKeyFromConsole?: boolean
  onOpenExternal: (url: string) => void
  /** 既有连接检查/同步的行内状态（`connectionStatus`）；空则整行不渲染。 */
  statusMessage: string | null
  revealApiKey: RevealModelProviderApiKey
}

export function ModelServiceKeySection({
  labels,
  provider,
  apiKeyDraft,
  onApiKeyDraftChange,
  onSaveDraft,
  error,
  getKeyUrl,
  getKeyFromConsole,
  onOpenExternal,
  statusMessage,
  revealApiKey
}: ModelServiceKeySectionProps): React.ReactElement {
  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget
    // 行内还有眼睛按钮：焦点在行内移动不算「离开」，不触发保存。
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    onSaveDraft()
  }

  return (
    <section className="model-service-section" data-model-service-key>
      <div className="model-service-section-head">
        <span className="model-service-section-title">{labels.apiKey}</span>
      </div>

      <div className="model-service-key-row" onBlur={handleBlur}>
        <ModelProviderApiKeyField
          labels={labels}
          providerId={provider.id}
          hasApiKey={provider.hasApiKey}
          apiKeyPreview={provider.apiKeyPreview}
          value={apiKeyDraft}
          onChange={onApiKeyDraftChange}
          revealApiKey={revealApiKey}
        />
      </div>

      {statusMessage !== null ? (
        <p className="model-service-hint" data-key-status>{statusMessage}</p>
      ) : null}

      <div className="model-service-helper-row">
        {getKeyUrl ? (
          <button
            type="button"
            className="model-service-link"
            data-get-api-key
            onClick={() => onOpenExternal(getKeyUrl)}>
            {getKeyFromConsole ? labels.getKeyFromConsole : labels.getApiKeyHere}
          </button>
        ) : (
          <span />
        )}
        <span>{labels.multipleApiKeysHint}</span>
      </div>

      {/* PLAT-61：常驻只留一行替换提示；「系统供应商保留在列表中」属于高级说明，只放 ⚙ 面板。 */}
      <p className="model-service-hint" data-key-replace-hint>
        {labels.savedApiKeyMaskHint}
      </p>

      {error !== null ? (
        <p className="model-service-inline-error" role="alert" data-model-service-key-error>
          {error}
        </p>
      ) : null}
    </section>
  )
}

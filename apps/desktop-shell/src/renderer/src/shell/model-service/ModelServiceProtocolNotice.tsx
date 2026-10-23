import { X } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'

/**
 * 供应商详情顶部的黄色提示条：这家的模型列表**不返回（或只返回部分）协议支持**。
 *
 * 为什么需要它：智能体只认 `messages` 协议；如果列表不给协议，用户同步完模型后直接去配智能体，
 * 会发现"模型不在候选里"，却看不出原因。提示把因果说清：同步 → 检测模型 → 才能选。
 *
 */
export function ModelServiceProtocolNotice({
  labels,
  providerName,
  onDismiss
}: {
  labels: PlatformText['models']
  providerName: string
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div className="model-service-protocol-notice" role="status" data-protocol-notice>
      <span className="model-service-protocol-notice-text" data-protocol-notice-text>
        {labels.protocolNoticeNone(providerName)}
      </span>
      <button
        type="button"
        className="model-service-protocol-notice-close"
        aria-label={labels.protocolNoticeDismiss}
        title={labels.protocolNoticeDismiss}
        data-protocol-notice-dismiss
        onClick={onDismiss}>
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}

/** 覆盖结论或文案变化时递增 ⇒ 已关闭过的提示会重新出现一次。 */
const PROTOCOL_NOTICE_VERSION = 'v1'

/** 关闭状态按「供应商 + 覆盖结论」记，换了结论（如 partial → none）会重新提示。 */
export function protocolNoticeStorageKey(providerId: string): string {
  return `dsh.model-service.protocol-notice.${PROTOCOL_NOTICE_VERSION}.${providerId}`
}

export function readProtocolNoticeDismissed(key: string): boolean {
  if (!key) return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    // 隐私模式 / 无 storage：当没关过（只在本次会话里能关）。
    return false
  }
}

export function writeProtocolNoticeDismissed(key: string): void {
  if (!key) return
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // 写不进去也不影响使用：本次会话已由组件状态隐藏。
  }
}

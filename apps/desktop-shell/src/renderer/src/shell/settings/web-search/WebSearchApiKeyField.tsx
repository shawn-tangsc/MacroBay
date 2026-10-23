import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { Eye, EyeOff, Pencil } from 'lucide-react'

import type { PlatformText } from '../../../i18n/platformText'

const ALL_MASK = '••••••••'
export const API_KEY_REVEAL_TIMEOUT_MS = 30_000

type WebSearchApiKeyFieldProps = {
  labels: PlatformText['webSearch']
  hasApiKey: boolean
  apiKeyPreview: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onReveal: () => Promise<string | null>
  onRemove: () => Promise<void>
  hint?: string
  apiKeyLength?: number
  /** 抽屉里标签由外层表单行提供，避免重复。 */
  hideLabel?: boolean
}

/**
 * API Key 控件。
 * - 已保存：掩码直接作为 input 的 value（不做覆盖层），hover/focus 不改变显示；
 *   点眼睛才按需读取完整 Key，30s 自动回掩码、失焦/卸载/切换供应商立即清除。
 * - 无已保存 Key：普通密码输入；眼睛切换草稿可见性。
 */
export function WebSearchApiKeyField({
  labels,
  hasApiKey,
  apiKeyPreview,
  value,
  disabled,
  onChange,
  onReveal,
  onRemove,
  hint,
  hideLabel = false
}: WebSearchApiKeyFieldProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [revealDraft, setRevealDraft] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasDraft = value.length > 0
  const savedMode = hasApiKey && !editing
  const savedMask = apiKeyPreview || ALL_MASK
  const displayValue = revealedKey ?? savedMask
  const canToggle = hasApiKey || hasDraft

  function clearReveal(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setRevealedKey(null)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // 切换供应商 / 已保存状态变化：清空明文与编辑态（不留下内存残留）。
  useEffect(() => {
    setEditing(false)
    setRevealDraft(false)
    setRevealError(null)
    clearReveal()
  }, [apiKeyPreview, hasApiKey])

  function startEditing(): void {
    clearReveal()
    setRevealError(null)
    setEditing(true)
    onChange('')
  }

  function cancelEditing(): void {
    clearReveal()
    setRevealError(null)
    setRevealDraft(false)
    onChange('')
    setEditing(false)
  }

  async function reveal(): Promise<void> {
    if (revealing) return
    setRevealError(null)
    // 旧 preload：桥不存在时直接给可诊断文案，不能和“主进程报错/没有 Key”混为一谈。
    if (typeof window.platform?.webSearch?.revealApiKey !== 'function') {
      setRevealError(labels.revealApiKeyUnavailable)
      return
    }
    setRevealing(true)
    try {
      const key = await onReveal()
      if (key === null) {
        setRevealError(labels.revealApiKeyMissing)
        return
      }
      if (typeof key !== 'string' || key.length === 0) {
        setRevealError(labels.revealApiKeyFailed)
        return
      }
      setRevealedKey(key)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setRevealedKey(null)
        timerRef.current = null
      }, API_KEY_REVEAL_TIMEOUT_MS)
    } catch {
      setRevealError(labels.revealApiKeyBridgeFailed)
    } finally {
      setRevealing(false)
    }
  }

  function toggleEye(): void {
    if (savedMode) {
      if (revealedKey) clearReveal()
      else void reveal()
      return
    }
    setRevealDraft((current) => !current)
  }

  async function remove(): Promise<void> {
    setRemoving(true)
    try {
      await onRemove()
      setConfirmRemove(false)
    } finally {
      setRemoving(false)
    }
  }

  const eyeIcon = savedMode ? revealedKey ? <EyeOff size={14} /> : <Eye size={14} /> : revealDraft ? <EyeOff size={14} /> : <Eye size={14} />
  const eyeLabel = savedMode
    ? revealedKey
      ? labels.hideApiKey
      : labels.showApiKey
    : revealDraft
      ? labels.hideApiKey
      : labels.showApiKey

  return (
    <div className="web-search-field">
      {hideLabel ? null : <span>{labels.apiKey}</span>}
      <div
        className="web-search-api-key-control"
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          clearReveal()
          // 编辑态失焦 = 取消：不写入草稿，回到已保存掩码。
          if (editing && hasApiKey) cancelEditing()
        }}>
        <Input
          readOnly={savedMode}
          autoFocus={editing}
          type={savedMode ? 'text' : revealDraft ? 'text' : 'password'}
          value={savedMode ? displayValue : value}
          disabled={disabled}
          spellCheck={false}
          aria-label={labels.apiKey}
          title={hasApiKey ? labels.savedApiKeyMaskHint : undefined}
          placeholder={savedMode ? '' : labels.apiKeyPlaceholder}
          onClick={() => {
            if (savedMode && !revealedKey) startEditing()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !editing || !hasApiKey) return
            event.preventDefault()
            cancelEditing()
          }}
          onChange={(event) => onChange(event.target.value)}
          suffix={
            <span className="web-search-api-key-suffix">
              {savedMode ? (
                <button
                  type="button"
                  className="web-search-api-key-icon web-search-api-key-pencil"
                  aria-label={labels.editApiKey}
                  disabled={disabled}
                  onClick={startEditing}>
                  <Pencil size={13} />
                </button>
              ) : null}
              <button
                type="button"
                className="web-search-api-key-eye"
                aria-label={eyeLabel}
                title={canToggle ? undefined : labels.noApiKeyHint}
                disabled={!canToggle || disabled || revealing}
                onClick={toggleEye}>
                {eyeIcon}
              </button>
            </span>
          }
        />
        {revealedKey ? <span className="web-search-api-key-revealed-indicator">{labels.apiKeyRevealedHint}</span> : null}
        {revealError ? (
          <span className="web-search-api-key-error" role="alert">
            {revealError}
            <Button type="link" size="small" onClick={() => void reveal()}>
              {labels.retry}
            </Button>
          </span>
        ) : null}
      </div>
      {hasApiKey ? (
        <div className="web-search-api-key-footer">
          {confirmRemove ? (
            <div className="web-search-api-key-remove-confirm">
              <span>{labels.removeApiKeyConfirm}</span>
              <button
                type="button"
                className="web-search-api-key-link"
                disabled={disabled || removing}
                onClick={() => void remove()}>
                {labels.removeApiKeyConfirmAction}
              </button>
              <button type="button" className="web-search-api-key-link" onClick={() => setConfirmRemove(false)}>
                {labels.cancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="web-search-api-key-remove-link"
              disabled={disabled}
              onClick={() => setConfirmRemove(true)}>
              {labels.removeApiKey}
            </button>
          )}
        </div>
      ) : null}
      {hint ? <span className="web-search-api-key-hint">{hint}</span> : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { Check, Copy, Eye, EyeOff, Pencil } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { PlatformText } from '../../../i18n/platformText'
import { copyTextToClipboard } from '../../clipboard'

/** 图标按钮的读屏名只收点分键：句子由调用方注入的 resolver 给。 */
export const EDIT_KEY = 'webSearch.editApiKey'
export const COPY_KEY = 'webSearch.copyApiKey'
export const COPY_DONE_KEY = 'webSearch.apiKeyCopied'
export const EYE_SHOW_KEY = 'webSearch.showApiKey'
export const EYE_HIDE_KEY = 'webSearch.hideApiKey'

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
  /**
   * 失败要带一个「重试能不能改变结果」的标记，而不是只带一句话。
   *
   * 判据：**动作必须与失败类型匹配**——桥不存在、没有存过 Key 这类确定性失败，重试永远得到同一
   * 结果，给按钮只会让人以为是自己点法不对；只有「没连上主进程」这类瞬时失败才给重试。
   * 原来四种失败共用一个渲染块，于是按钮被无条件画出来。
   */
  const [revealError, setRevealError] = useState<{ text: string; retryable: boolean } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    markUncopied()
    setRevealedKey(null)
  }

  // 「已复制」只提示两秒；卸载时清掉定时器。
  function markUncopied(): void {
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = null
    }
    setCopied(false)
  }

  async function copyRevealedKey(): Promise<void> {
    if (revealedKey === null) return
    await copyTextToClipboard(revealedKey)
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false)
      copiedTimerRef.current = null
    }, 2_000)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
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
      setRevealError({ text: labels.revealApiKeyUnavailable, retryable: false })
      return
    }
    setRevealing(true)
    try {
      const key = await onReveal()
      if (key === null) {
        setRevealError({ text: labels.revealApiKeyMissing, retryable: false })
        return
      }
      if (typeof key !== 'string' || key.length === 0) {
        setRevealError({ text: labels.revealApiKeyFailed, retryable: false })
        return
      }
      setRevealedKey(key)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setRevealedKey(null)
        timerRef.current = null
      }, API_KEY_REVEAL_TIMEOUT_MS)
    } catch {
      setRevealError({ text: labels.revealApiKeyBridgeFailed, retryable: true })
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
                disabled ? (
                  <IconButton
                    ariaLabelKey={EDIT_KEY}
                    disabled
                    icon={Pencil}
                    onSelect={startEditing}
                    resolveText={(key) => (key === EDIT_KEY ? labels.editApiKey : '')}
                    size="sm"
                  />
                ) : (
                  <IconButton
                    ariaLabelKey={EDIT_KEY}
                    icon={Pencil}
                    onSelect={startEditing}
                    resolveText={(key) => (key === EDIT_KEY ? labels.editApiKey : '')}
                    size="sm"
                  />
                )
              ) : null}
              {revealedKey ? (
                <IconButton
                  ariaLabelKey={copied ? COPY_DONE_KEY : COPY_KEY}
                  icon={copied ? Check : Copy}
                  onSelect={() => void copyRevealedKey()}
                  resolveText={(key) => {
                    if (key === COPY_KEY) return labels.copyApiKey
                    if (key === COPY_DONE_KEY) return labels.apiKeyCopied
                    return ''
                  }}
                  size="sm"
                />
              ) : null}
              {(() => {
                const eyeDisabled = !canToggle || disabled || revealing
                const eyeProps = {
                  ariaLabelKey: eyeLabel === labels.hideApiKey ? EYE_HIDE_KEY : EYE_SHOW_KEY,
                  icon: revealedKey || revealDraft ? EyeOff : Eye,
                  onSelect: toggleEye,
                  resolveText: (key: string) =>
                    key === EYE_HIDE_KEY ? labels.hideApiKey : key === EYE_SHOW_KEY ? labels.showApiKey : '',
                  size: 'sm' as const
                }
                // `IconButton` 的禁用与提示在类型上是互斥的两支，变量形态的布尔值进不去，所以分两次写。
                return eyeDisabled ? <IconButton {...eyeProps} disabled /> : <IconButton {...eyeProps} />
              })()}
            </span>
          }
        />
        {revealedKey ? <span className="web-search-api-key-revealed-indicator">{labels.apiKeyRevealedHint}</span> : null}
        {copied ? <span className="web-search-api-key-copied" role="status">{labels.apiKeyCopied}</span> : null}
        {revealError ? (
          <span className="web-search-api-key-error" role="alert">
            {revealError.text}
            {/* 只有「重试可能改变结果」的失败才给按钮：确定性失败上的按钮永远不会成功。 */}
            {revealError.retryable ? (
              <Button type="link" size="small" onClick={() => void reveal()}>
                {labels.retry}
              </Button>
            ) : null}
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

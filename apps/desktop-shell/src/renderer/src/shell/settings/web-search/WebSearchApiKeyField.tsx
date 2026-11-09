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
 * API Key 控件（口径与模型服务侧 `ModelProviderApiKeyField` 一致，用户 2026-11-01 拍板三句）：
 * - 已保存：**默认掩码**（掩码直接作为 input 的 value，不做覆盖层），hover/focus 不改变显示；
 *   点眼睛才按需读取完整 Key，**不设查看时限、失焦不回掩码**——一直明文，直到读者自己收起。
 *   （此前的「30 秒自动回掩码 + 失焦回掩码」是用户已撤掉的旧做法，别再写回来。）
 * - **掩码态也能复制**：复制按钮两种状态都在；掩码态点它按需读一次真值再写剪贴板，
 *   绝不复制 `••••`/预览串；复制不切换显示。切换供应商/卸载仍清除内存明文。
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
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasDraft = value.length > 0
  const savedMode = hasApiKey && !editing
  const savedMask = apiKeyPreview || ALL_MASK
  const displayValue = revealedKey ?? savedMask
  const canToggle = hasApiKey || hasDraft

  function clearReveal(): void {
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

  /**
   * 复制已保存的 Key：**掩码态也能复制**（2026-11-01 拍板）。
   *
   * 掩码态没有明文可用，所以点复制时才按需读一次真值——绝不去复制界面上的 `••••`/预览串。
   * 复制本身不切换显示。
   */
  async function copyKey(): Promise<void> {
    let key = revealedKey
    if (key === null) {
      if (!hasApiKey) return
      // 走「只读值、不写显示状态」的那一支：复制不许把明文带进输入框。
      key = await fetchSavedKey()
    }
    if (key === null) return
    await copyTextToClipboard(key)
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false)
      copiedTimerRef.current = null
    }, 2_000)
  }

  useEffect(() => {
    return () => {
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

  /** 读一次真值（**不改显示状态**）：掩码态复制走这里，避免把明文带进输入框。 */
  async function fetchSavedKey(): Promise<string | null> {
    if (revealing) return null
    setRevealError(null)
    // 旧 preload：桥不存在时直接给可诊断文案，不能和“主进程报错/没有 Key”混为一谈。
    if (typeof window.platform?.webSearch?.revealApiKey !== 'function') {
      setRevealError({ text: labels.revealApiKeyUnavailable, retryable: false })
      return null
    }
    setRevealing(true)
    try {
      const key = await onReveal()
      if (key === null) {
        setRevealError({ text: labels.revealApiKeyMissing, retryable: false })
        return null
      }
      if (typeof key !== 'string' || key.length === 0) {
        setRevealError({ text: labels.revealApiKeyFailed, retryable: false })
        return null
      }
      return key
    } catch {
      setRevealError({ text: labels.revealApiKeyBridgeFailed, retryable: true })
      return null
    } finally {
      setRevealing(false)
    }
  }

  /** 眼睛展开：读一次并切明文。**不设时限、失焦不回掩码**，直到读者自己收起。 */
  async function reveal(): Promise<void> {
    const key = await fetchSavedKey()
    if (key !== null) setRevealedKey(key)
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

  // 眼睛在「尚无 Key」时是禁用的，而禁用的按钮接不到焦点、挂不了 Tooltip。
  // 原因必须**在别处有可见的字**：没 Key 也没草稿时，把「尚无 Key」这句放到字段下方的提示行里，
  // 输入框占位另行说明「粘贴 API Key（必填）」。不许出现「点不了、也不知道为什么」。
  const visibleHint = hint ?? (hasApiKey || hasDraft ? undefined : labels.noApiKeyHint)

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
          // 失焦**不回掩码**（2026-11-01 拍板）：展开后一直明文，直到读者自己收起。
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
              {hasApiKey ? (
                // 掩码态与明文态**都在**：掩码态点它按需读真值再复制（2026-11-01 拍板）。
                <IconButton
                  ariaLabelKey={copied ? COPY_DONE_KEY : COPY_KEY}
                  disabled={disabled}
                  icon={copied ? Check : Copy}
                  onSelect={() => void copyKey()}
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
            {/* 句内动作：antd `Button` 的文本档 + `.text-action` 标记（命令型一律 antd，不再手写按钮）。 */}
            {revealError.retryable ? (
              <Button type="text" size="small" className="text-action" onClick={() => void reveal()}>
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
              <Button
                type="text"
                size="small"
                className="text-action"
                disabled={disabled || removing}
                onClick={() => void remove()}>
                {labels.removeApiKeyConfirmAction}
              </Button>
              <Button type="text" size="small" className="text-action" onClick={() => setConfirmRemove(false)}>
                {labels.cancel}
              </Button>
            </div>
          ) : (
            <Button
              type="text"
              size="small"
              className="text-action"
              disabled={disabled}
              onClick={() => setConfirmRemove(true)}>
              {labels.removeApiKey}
            </Button>
          )}
        </div>
      ) : null}
      {visibleHint ? <span className="web-search-api-key-hint">{visibleHint}</span> : null}
    </div>
  )
}

import { type FocusEvent, useEffect, useRef, useState } from 'react'
import { Input } from 'antd'
import { Eye, EyeOff } from 'lucide-react'

import type { PlatformText } from '../../../i18n/platformText'

/**
 * PLAT-58：产品 owner 决定允许在 UI 里显式查看已保存的完整 API Key。
 * PLAT-61 可用性跟进：**点框即可替换**，不必先点眼睛看明文。
 * PLAT-81（用户三次反馈"错位 / 边框缺口"后定稿）：控件就是 **antd 原生 `Input.Password`**，
 * 眼睛用组件自带的 `visibilityToggle`，**不自绘按钮、不自绘边框容器、不写 `!important`**；
 * 高度/边框/圆角/内边距全部来自主题 token（`controlHeight: 32` / `borderRadius: 8`）。
 *
 * 交互口径（与 web-search 的 `WebSearchApiKeyField` 一致）：
 * 1. 掩码态点击输入框 ⇒ 清空为草稿、进入编辑态（这一步**不** reveal）；
 * 2. 编辑态可正常输入/删除；`Escape` 或「失焦且草稿为空」⇒ 回掩码、不写入；
 * 3. 失焦且草稿非空 ⇒ 退出编辑态但**保留草稿**，由外层（失焦即存）负责保存；
 * 4. 眼睛只负责「查看已保存的完整 Key」：自带 `visibilityToggle` 的一次切换驱动**一次**按需 IPC 读取
 *    （受控 `visible ? plain : masked`），30 秒自动回掩码、失焦回掩码、切换供应商/卸载即清除
 *    （含在途请求序号作废）；
 * 5. 掩码直接作为 `value`，不做绝对定位覆盖层；不写日志、不写剪贴板。
 */
export const MODEL_PROVIDER_API_KEY_AUTO_HIDE_MS = 30_000

const ALL_MASK = '••••••••'

export type RevealModelProviderApiKey = (providerId: string) => Promise<{ apiKey: string | null }>

type ModelProviderApiKeyFieldProps = {
  labels: PlatformText['models']
  providerId: string
  hasApiKey: boolean
  apiKeyPreview: string
  /** 用户新输入的 Key 草稿（受控，由设置页持有）。 */
  value: string
  onChange: (value: string) => void
  revealApiKey: RevealModelProviderApiKey
  /** 测试注入用的自动回掩码时长；生产使用具名常量。 */
  autoHideMs?: number
}

export function ModelProviderApiKeyField({
  labels,
  providerId,
  hasApiKey,
  apiKeyPreview,
  value,
  onChange,
  revealApiKey,
  autoHideMs = MODEL_PROVIDER_API_KEY_AUTO_HIDE_MS
}: ModelProviderApiKeyFieldProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  /** 眼睛的受控可见性：只有它为 true 且确实读到过 Key 时 value 才是明文。 */
  const [plainVisible, setPlainVisible] = useState(false)
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealPending, setRevealPending] = useState(false)
  const requestSequence = useRef(0)

  // 切换供应商即清除：编辑态、已揭示的 Key、错误、明文可见性；同时作废在途读取。
  useEffect(() => {
    requestSequence.current += 1
    setEditing(false)
    setRevealedApiKey(null)
    setRevealError(null)
    setRevealPending(false)
    setPlainVisible(false)
  }, [providerId])

  // 30 秒自动回掩码；卸载或重新揭示时清掉旧定时器。
  useEffect(() => {
    if (revealedApiKey === null) return
    const timer = setTimeout(() => {
      setRevealedApiKey(null)
      setPlainVisible(false)
    }, autoHideMs)
    return () => clearTimeout(timer)
  }, [autoHideMs, revealedApiKey])

  const hasDraft = value.length > 0
  const canToggle = hasApiKey || hasDraft
  const maskMode = hasApiKey && !editing && revealedApiKey === null
  // 明文只在「眼睛打开 + 真的拿到了已保存的 Key」时出现；其余一律掩码 / 草稿。
  const displayValue = editing
    ? value
    : plainVisible && revealedApiKey !== null
      ? revealedApiKey
      : hasApiKey
        ? apiKeyPreview || ALL_MASK
        : value

  function clearReveal(): void {
    requestSequence.current += 1
    setRevealedApiKey(null)
    setPlainVisible(false)
  }

  /** 按需读取完整 Key：成功 ⇒ true（调用方据此把眼睛切到明文）。 */
  async function revealSavedKey(): Promise<boolean> {
    if (revealPending) return false
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setRevealPending(true)
    setRevealError(null)
    try {
      const result = await revealApiKey(providerId)
      if (requestSequence.current !== sequence) return false
      if (typeof result?.apiKey === 'string' && result.apiKey.length > 0) {
        setRevealedApiKey(result.apiKey)
        return true
      }
      setRevealError(labels.revealApiKeyFailed)
      return false
    } catch {
      if (requestSequence.current === sequence) setRevealError(labels.revealApiKeyFailed)
      return false
    } finally {
      if (requestSequence.current === sequence) setRevealPending(false)
    }
  }

  /**
   * antd 自带眼睛的一次切换：关 ⇒ 立刻回掩码；开 ⇒ 需要时**读取一次** IPC 再切明文
   * （没有已保存 Key 时只是显示用户自己输入的草稿，不读 IPC）。
   */
  async function handleVisibleChange(next: boolean): Promise<void> {
    if (!next) {
      clearReveal()
      return
    }
    if (!hasApiKey || revealedApiKey !== null) {
      setPlainVisible(true)
      return
    }
    setPlainVisible(await revealSavedKey())
  }

  function startEditing(): void {
    clearReveal()
    setRevealError(null)
    setEditing(true)
    onChange('')
  }

  function cancelEditing(): void {
    clearReveal()
    setRevealError(null)
    setEditing(false)
    onChange('')
  }

  function handleChange(next: string): void {
    setRevealError(null)
    if (revealedApiKey !== null) {
      // 在已揭示的完整 Key 上直接编辑：转为草稿态并取消自动隐藏（不把明文留在只读展示里）。
      setRevealedApiKey(null)
      setEditing(true)
      setPlainVisible(true)
    }
    onChange(next)
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    const nextTarget = event.relatedTarget
    // 焦点还在本行内（例如点「检测」）不算离开。
    if (nextTarget instanceof Node && event.currentTarget.parentElement?.contains(nextTarget)) return
    if (revealedApiKey !== null) clearReveal()
    if (!editing) return
    // 失焦 = 退出编辑态；草稿非空时保留草稿（外层失焦即存），空草稿回掩码且不写入。
    setEditing(false)
    setPlainVisible(false)
    if (!hasDraft) onChange('')
  }

  return (
    <>
      <Input
        className="provider-api-key-input"
        type="text"
        value={displayValue}
        readOnly={!editing}
        autoComplete="off"
        aria-label={labels.apiKey}
        title={hasApiKey ? labels.savedApiKeyMaskHint : undefined}
        placeholder={maskMode ? '' : labels.apiKeyPlaceholder}
        onClick={() => { if (!editing && revealedApiKey === null) startEditing() }}
        onKeyDown={(event) => { if (event.key !== 'Escape' || !editing) return; event.preventDefault(); cancelEditing() }}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={handleBlur}
        suffix={(
          <button
            type="button"
            className="provider-api-key-eye"
            aria-label={plainVisible ? labels.hideApiKey : labels.showApiKey}
            aria-pressed={plainVisible}
            disabled={!canToggle || revealPending}
            onClick={() => void handleVisibleChange(!plainVisible)}>
            {plainVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      />
      {revealError !== null ? (
        <p className="provider-api-key-error" role="alert">
          {revealError}
        </p>
      ) : null}
    </>
  )
}

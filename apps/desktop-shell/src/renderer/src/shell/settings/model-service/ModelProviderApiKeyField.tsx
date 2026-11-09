import { type FocusEvent, useEffect, useRef, useState } from 'react'
import { Input } from 'antd'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { PlatformText } from '../../../i18n/platformText'
import { copyTextToClipboard } from '../../clipboard'

/**
 * PLAT-58：产品 owner 决定允许在 UI 里显式查看已保存的完整 API Key。
 * PLAT-61 可用性跟进：**点框即可替换**，不必先点眼睛看明文。
 * PLAT-81（用户三次反馈"错位 / 边框缺口"后定稿）：控件就是 **antd 原生 `Input.Password`**，
 * 眼睛用组件自带的 `visibilityToggle`，**不自绘按钮、不自绘边框容器、不写 `!important`**；
 * 高度/边框/圆角/内边距全部来自主题 token（`controlHeight: 32` / `borderRadius: 8`）。
 *
 * 交互口径（2026-11-01 用户拍板三句，与 AGENTS.md 的凭据规则一致）：
 * 1. **默认掩码**：未展开时显示 `apiKeyPreview`，完整 Key 不进 DOM、也不读 IPC；
 * 2. **按需展开后可查看**：眼睛每次展开按需读一次完整 Key（受控 `visible ? plain : masked`），
 *    **不设查看时限、失焦不回掩码**——一直明文，直到读者自己收起。
 *    （此前的「30 秒自动回掩码 + 失焦回掩码」是用户已撤掉的旧做法，别再写回来。）
 * 3. **展开后允许复制，掩码态也能复制**：复制按钮两种状态都在；掩码态点击时才按需读取真值再写剪贴板，
 *    绝不把 `••••` 或预览串复制出去。切换供应商/卸载清除内存里的明文（含在途请求序号作废）。
 * 4. 掩码直接作为 `value`，不做绝对定位覆盖层；**不写日志**（唯一硬要求）。
 * 5. 编辑口径：掩码态点击输入框 ⇒ 清空为草稿进编辑态（这一步**不** reveal）；`Escape` 或
 *    「失焦且草稿为空」⇒ 回掩码、不写入；失焦且草稿非空 ⇒ 退出编辑态但**保留草稿**，
 *    由外层（失焦即存）负责保存。
 */

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
}

export function ModelProviderApiKeyField({
  labels,
  providerId,
  hasApiKey,
  apiKeyPreview,
  value,
  onChange,
  revealApiKey
}: ModelProviderApiKeyFieldProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  /** 眼睛的受控可见性：只有它为 true 且确实读到过 Key 时 value 才是明文。 */
  const [plainVisible, setPlainVisible] = useState(false)
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealPending, setRevealPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const requestSequence = useRef(0)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 切换供应商即清除：编辑态、已揭示的 Key、错误、明文可见性；同时作废在途读取。
  useEffect(() => {
    requestSequence.current += 1
    setEditing(false)
    setRevealedApiKey(null)
    setRevealError(null)
    setRevealPending(false)
    setPlainVisible(false)
  }, [providerId])

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

  // 「已复制」只提示两秒，然后在同一处收回；卸载时清掉定时器，避免对已卸载组件 setState。
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  function clearReveal(): void {
    requestSequence.current += 1
    setRevealedApiKey(null)
    setPlainVisible(false)
    markUncopied()
  }

  function markUncopied(): void {
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current)
      copiedTimer.current = null
    }
    setCopied(false)
  }

  /** 复制真正写进剪贴板的那一步：`key` 一定是完整真值，调用方不许把预览串传进来。 */
  async function writeKeyToClipboard(key: string): Promise<void> {
    await copyTextToClipboard(key)
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => {
      setCopied(false)
      copiedTimer.current = null
    }, 2_000)
  }

  /**
   * 复制已保存的 Key：**掩码态也能复制**（2026-11-01 拍板）。
   *
   * 掩码态没有明文可用，所以点复制时才按需读一次真值——绝不去复制界面上的 `••••`/预览串。
   * 复制本身不切换显示：读者要看得见还得自己展开（那是另一件事）。
   */
  async function copyKey(): Promise<void> {
    let key = revealedApiKey
    if (key === null) {
      if (!hasApiKey) return
      key = await readSavedKey()
    }
    if (key === null) return
    await writeKeyToClipboard(key)
  }

  /** 按需读取完整 Key：成功 ⇒ 真值（并记住它，避免重复 IPC）；读不到 ⇒ `null`（原因已写进 `revealError`）。 */
  async function readSavedKey(): Promise<string | null> {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setRevealPending(true)
    setRevealError(null)
    try {
      const result = await revealApiKey(providerId)
      if (requestSequence.current !== sequence) return null
      if (typeof result?.apiKey === 'string' && result.apiKey.length > 0) {
        setRevealedApiKey(result.apiKey)
        return result.apiKey
      }
      setRevealError(labels.revealApiKeyFailed)
      return null
    } catch {
      if (requestSequence.current === sequence) setRevealError(labels.revealApiKeyFailed)
      return null
    } finally {
      if (requestSequence.current === sequence) setRevealPending(false)
    }
  }

  /**
   * antd 自带眼睛的一次切换：关 ⇒ 立刻回掩码（明文只从 `value` 离开 DOM，内存里留着真值供复制）；
   * 开 ⇒ 需要时**读取一次** IPC 再切明文（没有已保存 Key 时只是显示用户自己输入的草稿，不读 IPC）。
   *
   * 这里**不设时限、也不在失焦时回掩码**：读者不收起就一直明文。
   */
  async function handleVisibleChange(next: boolean): Promise<void> {
    if (!next) {
      setPlainVisible(false)
      return
    }
    if (!hasApiKey || revealedApiKey !== null) {
      setPlainVisible(true)
      return
    }
    if ((await readSavedKey()) !== null) setPlainVisible(true)
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
    // 失焦**不回掩码**（2026-11-01 拍板）：展开后一直明文，直到读者自己收起。
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
          <span className="provider-api-key-actions">
            {hasApiKey ? (
              // 图标按钮一律走平台组件：读屏名收键、尺寸只有 22/24 两档、焦点环与图形一致性由组件管。
              // 掩码态与明文态**都在**：掩码态点它按需读真值再复制（2026-11-01 拍板）。
              <IconButton
                ariaLabelKey={copied ? 'modelService.copied' : 'modelService.copyApiKey'}
                icon={copied ? Check : Copy}
                onSelect={() => void copyKey()}
                resolveText={(key) =>
                  key === 'modelService.copied'
                    ? labels.copied
                    : key === 'modelService.copyApiKey'
                      ? labels.copyApiKey
                      : ''
                }
                size="sm"
                tooltipKey={copied ? 'modelService.copied' : 'modelService.copyApiKey'}
                dataAttributes={{ 'data-provider-api-key-copy': 'true' }}
              />
            ) : null}
            {/*
              读屏名**恒定**为「显示…」：当前是否明文由 `aria-pressed` 表达。
              名字随状态改（显示/隐藏）会让读屏用户听名字去猜状态，而状态本来就有专门的位置。
            */}
            <IconButton
              ariaLabelKey="modelService.showApiKey"
              disabled={!canToggle || revealPending}
              icon={plainVisible ? EyeOff : Eye}
              onSelect={() => void handleVisibleChange(!plainVisible)}
              pressed={plainVisible}
              resolveText={(key) => (key === 'modelService.showApiKey' ? labels.showApiKey : '')}
              size="sm"
              dataAttributes={{ 'data-provider-api-key-eye': 'true' }}
            />
            {copied ? <span className="provider-api-key-copied" role="status">{labels.copied}</span> : null}
          </span>
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

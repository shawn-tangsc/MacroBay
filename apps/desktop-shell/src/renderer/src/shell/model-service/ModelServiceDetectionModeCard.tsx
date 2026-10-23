import type { ModelDetectionMode } from '@platform/ai/providers/modelDetection/types'

/**
 * PLAT-82：「检测模型」对话框里的**一个检测项卡片**。
 *
 * 视觉：两行等宽卡片（不再是缩进 checkbox）—— 第一行标题 + 右对齐的一句说明，第二行覆盖范围；
 * 勾选态用主题强调色描边 + 浅底。整行可点（`label` 包裹 `input`），键盘走原生 checkbox。
 * 为什么用行内样式：`styles.css` 归另一个改动所有，这里不新增全局规则（同「请求配置」抽屉）。
 */
export type ModelServiceDetectionModeCardProps = {
  mode: ModelDetectionMode
  title: string
  /** 第一行右侧说明（发送什么请求）。 */
  hint: string
  /** 第二行覆盖范围（哪些模型会被测）。 */
  scope: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
}

export function ModelServiceDetectionModeCard({
  mode,
  title,
  hint,
  scope,
  checked,
  disabled,
  onToggle
}: ModelServiceDetectionModeCardProps): React.ReactElement {
  return (
    <label
      data-detect-row={`mode-${mode}`}
      data-detect-row-checked={checked ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        columnGap: 10,
        padding: '9px 10px',
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: checked
          ? 'color-mix(in srgb, var(--accent) 50%, var(--border))'
          : 'var(--border)',
        background: checked ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease'
      }}>
      <input
        type="checkbox"
        data-detect-mode={mode}
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        style={{
          flex: '0 0 auto',
          width: 14,
          height: 14,
          margin: '2px 0 0',
          accentColor: 'var(--accent)',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      />
      <span style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', rowGap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', columnGap: 12, minWidth: 0 }}>
          <span
            data-detect-label
            style={{ flex: '0 0 auto', color: 'var(--text)', fontSize: 12, fontWeight: 600, lineHeight: '16px' }}>
            {title}
          </span>
          <span
            data-detect-hint
            style={{ flex: 1, minWidth: 0, color: 'var(--muted)', fontSize: 11, lineHeight: '16px', textAlign: 'right' }}>
            {hint}
          </span>
        </span>
        <span
          data-detect-scope
          style={{ color: 'color-mix(in srgb, var(--muted) 72%, transparent)', fontSize: 11, lineHeight: '15px' }}>
          {scope}
        </span>
      </span>
    </label>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'

import type { ModelChatProtocol } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

import { endpointKindLabel } from './modelServiceEndpointAddress'

/**
 * T4/T5：「添加端点」触发按钮 + 浮层下拉（**只列未配置的聊天端点**）。
 *
 * 关键行为（用户要求）：抽屉打开时**收起**；只有点触发按钮才展开；浮层绝对定位、
 * 有 z-index 与阴影，不挤动/覆盖下方区块；选择 / 点外部 / Esc 都收起。
 */
const MENU_STYLE = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 30,
  minWidth: 220,
  padding: 4,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--surface-strong)',
  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)'
} as const

const MENU_ITEM_STYLE = {
  display: 'block',
  width: '100%',
  padding: '6px 8px',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 12,
  lineHeight: '16px',
  textAlign: 'left',
  cursor: 'pointer'
} as const

export function ModelServiceRequestConfigAddEndpoint({
  labels,
  availableProtocols,
  onAdd
}: {
  labels: PlatformText['models']
  availableProtocols: readonly ModelChatProtocol[]
  onAdd: (protocol: ModelChatProtocol) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // 只在展开时挂监听：点外部 / Esc 收起（避免常驻全局 handler）。
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent): void {
      if (wrapperRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="request-config-add-endpoint"
        data-request-config-add
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={availableProtocols.length === 0}
        onClick={() => setOpen((current) => !current)}>
        <Plus size={12} aria-hidden="true" />
        {labels.endpointAdd}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div style={MENU_STYLE} role="listbox" data-request-config-add-menu>
          {availableProtocols.map((protocol) => (
            <button
              key={protocol}
              type="button"
              role="option"
              aria-selected={false}
              style={MENU_ITEM_STYLE}
              data-request-config-add-option={protocol}
              onClick={() => {
                setOpen(false)
                onAdd(protocol)
              }}>
              {endpointKindLabel(labels, protocol)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

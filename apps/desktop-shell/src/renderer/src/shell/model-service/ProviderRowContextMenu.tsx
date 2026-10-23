import { useEffect, useRef } from 'react'
import { Power, SquareArrowOutUpRight, Trash2 } from 'lucide-react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

type Props = {
  menu: { x: number; y: number; provider: SafeModelProvider } | null
  labels: PlatformText['models']
  onClose: () => void
  onOpen: (providerId: string) => void
  onToggle: (provider: SafeModelProvider) => void
  onDelete: (provider: SafeModelProvider) => void
}

/** PLAT-62：供应商行右键菜单；位置 clamp 到视口，外点/Esc 关闭。 */
export function ProviderRowContextMenu({ menu, labels, onClose, onOpen, onToggle, onDelete }: Props): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => onClose()
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', key)
    }
  }, [menu, onClose])

  if (!menu) return null
  const width = 260
  const height = 140
  const x = Math.max(4, Math.min(menu.x, window.innerWidth - width - 4))
  const y = Math.max(4, Math.min(menu.y, window.innerHeight - height - 4))

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 28,
    padding: '0 10px',
    border: 0,
    width: '100%',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap'
  }

  return (
    <div
      ref={ref}
      role="menu"
      data-provider-context-menu
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1200,
        width,
        padding: 4,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)'
      }}
      onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        role="menuitem"
        style={itemStyle}
        data-provider-context-open
        onClick={() => {
          onOpen(menu.provider.id)
          onClose()
        }}>
        <SquareArrowOutUpRight size={13} aria-hidden="true" />
        {labels.providerContextOpen}
      </button>
      <button
        type="button"
        role="menuitem"
        style={itemStyle}
        data-provider-context-toggle
        onClick={() => {
          onToggle(menu.provider)
          onClose()
        }}>
        <Power size={13} aria-hidden="true" />
        {menu.provider.enabled ? labels.providerContextDisable : labels.providerContextEnable}
      </button>
      <div style={{ height: 1, margin: '4px 0', background: 'var(--border)' }} />
      <button
        type="button"
        role="menuitem"
        disabled={menu.provider.isSystem}
        title={menu.provider.isSystem ? labels.systemProviderCannotDelete : labels.providerContextDelete}
        data-provider-context-delete
        style={{
          ...itemStyle,
          color: menu.provider.isSystem ? 'var(--muted)' : 'var(--danger)',
          opacity: menu.provider.isSystem ? 0.55 : 1,
          cursor: menu.provider.isSystem ? 'not-allowed' : 'pointer'
        }}
        onClick={() => {
          if (menu.provider.isSystem) return
          onDelete(menu.provider)
          onClose()
        }}>
        <Trash2 size={13} aria-hidden="true" />
        {labels.providerContextDelete}
        {menu.provider.isSystem ? (
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
            {labels.systemProviderCannotDelete}
          </span>
        ) : null}
      </button>
    </div>
  )
}

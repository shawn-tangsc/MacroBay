import { useEffect, useRef, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { MoreHorizontal, Trash2 } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'

/**
 * PLAT-81 / R2：品牌块的 `⋯` 次要操作菜单。
 *
 * 品牌块压成一行后，删除供应商这类低频/危险操作不再占用行宽，收进 `⋯`。
 * 用内联面板（不是 portal）以便：外点/Esc 关闭、DOM 顺序稳定、测试可直接点到真实 `<button disabled>`。
 */
export function ModelServiceProviderMoreMenu({
  labels,
  isSystem,
  disabled,
  onRemove
}: {
  labels: PlatformText['models']
  /** 系统供应商不可删除（保留原口径）。 */
  isSystem: boolean
  /** 删除请求进行中：整条置灰。 */
  disabled: boolean
  onRemove: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (wrapRef.current && event.target instanceof Node && wrapRef.current.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('click', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const blocked = isSystem || disabled

  return (
    <div className="model-service-more" ref={wrapRef} data-provider-more-wrap>
      {/* 图标型触发器 → `IconButton(sm)`；弹出语义由 `hasPopup`+`expanded` 表达（不是 `pressed`）。 */}
      <IconButton
        ariaLabelKey="modelService.providerMoreActions"
        dataAttributes={{ 'data-provider-more': true }}
        expanded={open}
        hasPopup="menu"
        icon={MoreHorizontal}
        onSelect={() => setOpen((current) => !current)}
        resolveText={(key) => (key === 'modelService.providerMoreActions' ? labels.providerMoreActions : '')}
        size="sm"
        tooltipKey="modelService.providerMoreActions"
      />
      {open ? (
        <div className="model-service-more-menu" data-provider-more-menu role="menu">
          <button
            type="button"
            role="menuitem"
            className="model-service-more-item"
            data-remove-provider
            disabled={blocked}
            title={isSystem ? labels.systemProviderCannotDelete : labels.removeProvider}
            onClick={() => {
              if (blocked) return
              setOpen(false)
              onRemove()
            }}>
            <Trash2 size={13} aria-hidden="true" />
            <span>{labels.removeProvider}</span>
            {isSystem ? <small className="model-service-more-note">{labels.systemProviderCannotDelete}</small> : null}
          </button>
        </div>
      ) : null}
    </div>
  )
}

import { useEffect } from 'react'
import type { RefObject } from 'react'

import {
  shouldDismissAgentQuickPanelFromKey,
  shouldDismissAgentQuickPanelFromOutsidePointer
} from '../agentQuickPanel'

type UseAgentQuickPanelDismissInput = {
  open: boolean
  inputbarRef: RefObject<HTMLElement | null>
  onDismiss: () => void
}

export function useAgentQuickPanelDismiss({
  open,
  inputbarRef,
  onDismiss
}: UseAgentQuickPanelDismissInput): void {
  useEffect(() => {
    if (!open) return

    function handleDocumentPointerDown(event: PointerEvent): void {
      const inputbar = inputbarRef.current
      const targetIsInsideInputbar =
        inputbar !== null && event.target instanceof Node && inputbar.contains(event.target)
      if (!shouldDismissAgentQuickPanelFromOutsidePointer(open, targetIsInsideInputbar)) return

      onDismiss()
    }

    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (!shouldDismissAgentQuickPanelFromKey(open, event.key)) return

      onDismiss()
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [inputbarRef, onDismiss, open])
}

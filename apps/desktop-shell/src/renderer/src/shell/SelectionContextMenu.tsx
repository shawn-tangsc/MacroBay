import { useState, type PropsWithChildren } from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'

import { copyTextToClipboard } from './clipboard'
import { readSelectedText } from './selectionText'

type SelectionContextMenuProps = PropsWithChildren<{
  copyLabel: string
  quoteLabel: string
  onQuote?: (selectedText: string) => void
}>

export default function SelectionContextMenu({
  children,
  copyLabel,
  quoteLabel,
  onQuote
}: SelectionContextMenuProps): React.ReactElement {
  const [selectedText, setSelectedText] = useState('')
  const menuItems: MenuProps['items'] = [
    {
      key: 'copy',
      label: copyLabel,
      disabled: !selectedText
    },
    {
      key: 'quote',
      label: quoteLabel,
      disabled: !selectedText || typeof onQuote !== 'function'
    }
  ]

  return (
    <Dropdown
      trigger={['contextMenu']}
      onOpenChange={(open) => {
        if (!open) return
        setSelectedText(readSelectedText(window.getSelection()))
      }}
      menu={{
        items: menuItems,
        onClick: ({ key }) => {
          if (key === 'copy') {
            void copyTextToClipboard(selectedText)
            return
          }

          if (key === 'quote') {
            onQuote?.(selectedText)
          }
        }
      }}>
      <div className="selection-context-surface">{children}</div>
    </Dropdown>
  )
}

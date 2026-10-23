type SelectionLike = Pick<Selection, 'rangeCount' | 'isCollapsed' | 'toString'>

export function readSelectedText(selection: SelectionLike | null | undefined): string {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }

  return selection.toString().trim()
}

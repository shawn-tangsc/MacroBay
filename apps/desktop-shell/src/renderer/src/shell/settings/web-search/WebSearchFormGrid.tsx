type WebSearchFormRowProps = {
  label?: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  /** 预览类整行（无提示列），控件占 2/4。 */
  wide?: boolean
  /** 宽控件（如黑名单 tag 区）：控件占 2/4，提示换到下一行。 */
  spanControl?: boolean
}

/**
 * R4：统一三列表单网格 —— 标签 132px（右对齐）/ 控件 260px / 提示列自适应。
 * 所有设置页行都走这一个组件，避免再出现 ad-hoc 布局。
 */
export function WebSearchFormRow({
  label,
  hint,
  children,
  wide = false,
  spanControl = false
}: WebSearchFormRowProps): React.ReactElement {
  const className = [
    'web-search-form-row',
    wide ? 'web-search-form-row-wide' : '',
    spanControl ? 'web-search-form-row-span' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      <span className="web-search-form-label">{label}</span>
      <div className="web-search-form-control">{children}</div>
      {wide ? null : <span className="web-search-form-hint">{hint}</span>}
    </div>
  )
}

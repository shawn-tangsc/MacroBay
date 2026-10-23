/**
 * T4/T5：请求配置抽屉里的**区块标题**（聊天端点 / 图像 / 自定义请求头）。
 *
 * 三个区块用同一套分隔：标题（12px 半粗）+ 上方细线，区块间距离一致。
 * 为什么用行内样式：`styles.css` 归另一个改动所有，这里不新增全局规则。
 */
export function ModelServiceRequestConfigSectionTitle({
  children,
  first = false
}: {
  children: React.ReactNode
  /** 第一个区块不画上方细线（抽屉顶部不重复一条线）。 */
  first?: boolean
}): React.ReactElement {
  return (
    <div
      className="request-config-section-title"
      data-request-config-section-title
      style={{
        marginTop: first ? 0 : 18,
        paddingTop: first ? 0 : 12,
        borderTopWidth: first ? 0 : 1,
        borderTopStyle: 'solid',
        borderTopColor: 'var(--border)',
        color: 'var(--muted)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        letterSpacing: 0.2
      }}>
      {children}
    </div>
  )
}

import { readJsonBlockCard, type JsonBlock, type JsonBlockCard } from './jsonBlock'

/**
 * Owner: platform/ui/markdown（PLAT-64）。
 *
 * 一段整块 JSON 的渲染：
 * - 命中已知卡片形态（`title|name|label|heading` + `summary|text|description|body|content`）⇒ 先给卡片摘要；
 * - 无论有没有卡片，**整段 JSON 都一次显示完整**：固定可视区里左右上下滚动看完全部内容，不做折叠、
 *   不给「展开 / 查看原始 JSON」这类入口 —— 隐藏的 JSON 等于让用户先点一下才能确认我们到底收到了什么；
 * - 未知形态同样走等宽代码块，沿用 `chat-markdown-code` 的圆角/边框/双向滚动。
 */
export function JsonBlockView(props: {
  block: JsonBlock
  codeClassName?: string
}): React.ReactElement {
  const card = readJsonBlockCard(props.block)
  return (
    <div className="chat-markdown-json">
      {card ? <JsonBlockCardView card={card} /> : null}
      <pre className={props.codeClassName ?? 'chat-markdown-code'}>
        <code>{props.block.source}</code>
      </pre>
    </div>
  )
}

function JsonBlockCardView(props: { card: JsonBlockCard }): React.ReactElement {
  return (
    <div className="chat-markdown-json-card">
      <div className="chat-markdown-json-card-title">{props.card.title}</div>
      <p className="chat-markdown-json-card-body">{props.card.body}</p>
    </div>
  )
}

import { useState } from 'react'

import type { AppLanguage } from '../../settings/schema/appSettings'
import { useShellLanguage } from '../shell/ShellLanguageContext'

import { JsonBlockShape, readJsonBlockCard, type JsonBlock, type JsonBlockCard } from './jsonBlock'
import { jsonBlockLabels, type JsonBlockLabels } from './jsonBlockLabels'

/**
 * Owner: platform/ui/markdown（PLAT-64）。
 *
 * 一段整块 JSON 的渲染：
 * - 命中已知卡片形态（`title|name|label|heading` + `summary|text|description|body|content`）⇒ 卡片；
 *   卡片没展示的字段还在，所以额外给一个「查看原始 JSON」入口，避免卡片把内容藏掉；
 * - 其余（包含所有不认识的形态）⇒ 等宽代码块，沿用 `chat-markdown-code` 的圆角/边框/横向滚动；
 * - 超过 `collapseAfterLines` 行默认折叠，并保留「已折叠 N 行」提示 —— 折叠是视觉收纳，不是丢弃。
 */
export function JsonBlockView(props: {
  block: JsonBlock
  codeClassName?: string
  /** 显式语言（shell 传自己的 language）；缺省时跟随窗口级 `ShellLanguageContext`。 */
  language?: AppLanguage
}): React.ReactElement {
  const contextLanguage = useShellLanguage()
  const labels = jsonBlockLabels[props.language ?? contextLanguage]
  const card = readJsonBlockCard(props.block)
  if (card) {
    return (
      <JsonBlockCardView
        card={card}
        block={props.block}
        codeClassName={props.codeClassName}
        labels={labels}
      />
    )
  }
  return <JsonCodeBlock block={props.block} codeClassName={props.codeClassName} labels={labels} />
}

function JsonBlockCardView(props: {
  card: JsonBlockCard
  block: JsonBlock
  codeClassName?: string
  labels: JsonBlockLabels
}): React.ReactElement {
  const [showsRaw, setShowsRaw] = useState(false)
  return (
    <div className="chat-markdown-json-card">
      <div className="chat-markdown-json-card-title">{props.card.title}</div>
      <p className="chat-markdown-json-card-body">{props.card.body}</p>
      {props.card.extraFieldCount > 0 ? (
        <>
          <button
            type="button"
            className="chat-markdown-json-toggle"
            onClick={() => setShowsRaw((current) => !current)}>
            {showsRaw ? props.labels.hideRawJson : props.labels.rawJson}
          </button>
          {showsRaw ? (
            <JsonCodeBlock block={props.block} codeClassName={props.codeClassName} labels={props.labels} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function JsonCodeBlock(props: {
  block: JsonBlock
  codeClassName?: string
  labels: JsonBlockLabels
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const lines = props.block.source.split('\n')
  const collapsible = lines.length > JsonBlockShape.collapseAfterLines
  const visibleLines = collapsible && !expanded ? lines.slice(0, JsonBlockShape.collapseAfterLines) : lines
  const foldedCount = lines.length - visibleLines.length
  return (
    <div className="chat-markdown-json">
      {collapsible ? (
        <div className="chat-markdown-json-bar">
          <button
            type="button"
            className="chat-markdown-json-toggle"
            onClick={() => setExpanded((current) => !current)}>
            {expanded ? props.labels.collapse : props.labels.expand}
          </button>
          {foldedCount > 0 ? (
            <span className="chat-markdown-json-hint">{props.labels.foldedLines(foldedCount)}</span>
          ) : null}
        </div>
      ) : null}
      <pre className={props.codeClassName ?? 'chat-markdown-code'}>
        <code>{visibleLines.join('\n')}</code>
      </pre>
    </div>
  )
}


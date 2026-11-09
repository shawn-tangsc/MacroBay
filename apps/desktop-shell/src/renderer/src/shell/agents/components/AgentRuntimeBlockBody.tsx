import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'

import type { AgentRuntimeMessagePartDetailItem } from '../agentRuntimeMessageParts'
import { openAgentRuntimeMessagePartDetailItem } from '../agentRuntimeMessagePartItemOpen'
import type { AgentRuntimeResultPreviewCard } from '../agentRuntimeResultPreview'

import type { RuntimeBlock } from './AgentRuntimeMessagePartBlocks'

/**
 * 壳的 `resolveText` 只被 `*Key` 用到；这些折叠区的头行全是**已解析的原文**
 * （标签、工具副标题、字段名），一个键也不走——给同义回落，误传键时看见的是键本身。
 */
export const passthroughText = (key: string): string => key

export function RuntimeBlockBody({
  block,
  openLabel,
  inputLabel,
  outputLabel
}: {
  block: RuntimeBlock
  openLabel: string
  inputLabel: string
  outputLabel: string
}): React.ReactElement | null {
  // A tool row's fold is the result, not the command the subtitle now carries.
  const resultLabel = block.runtimeKind === 'tool-call' || block.runtimeKind === 'tool-result' ? outputLabel : block.subtitle
  return (
    <>
      {block.requestDetail ? (
        <CollapsibleGroup resolveText={passthroughText} titleText={inputLabel}>
          <pre>{block.requestDetail}</pre>
        </CollapsibleGroup>
      ) : null}
      {block.resultCards?.length ? (
        <CollapsibleGroup resolveText={passthroughText} titleText={resultLabel}>
          <div className="agent-message-runtime-result-cards">
            {block.resultCards.map((card) => (
              <ResultPreviewCard key={card.key} card={card} openLabel={openLabel} />
            ))}
          </div>
        </CollapsibleGroup>
      ) : null}
      {block.details?.length ? (
        <div className="agent-message-runtime-part-details">
          {block.details.map((detail) => (
            <CollapsibleGroup key={detail.label} resolveText={passthroughText} titleText={detail.label}>
              {detail.items?.length ? (
                <div className="agent-message-runtime-part-detail-items">
                  {detail.items.map((item, index) => (
                    <article key={`${item.title}:${index}`}>
                      <div className="agent-message-runtime-part-detail-item-header">
                        <div className="agent-message-runtime-part-detail-item-heading">
                          <strong>{item.title}</strong>
                          {item.meta ? <small>{item.meta}</small> : null}
                        </div>
                        {item.openTarget ? (
                          <button
                            type="button"
                            className="agent-message-runtime-open"
                            onClick={() => {
                              void openAgentRuntimeMessagePartDetailItem(item)
                            }}>
                            {openLabel}
                          </button>
                        ) : null}
                      </div>
                      {item.previewUrl ? (
                        <img className="agent-message-runtime-preview" src={item.previewUrl} alt="" loading="lazy" />
                      ) : null}
                      {item.text ? <pre>{item.text}</pre> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <pre>{detail.text}</pre>
              )}
            </CollapsibleGroup>
          ))}
        </div>
      ) : !block.resultCards?.length && block.detail ? (
        <CollapsibleGroup resolveText={passthroughText} titleText={resultLabel}>
          <pre>{block.detail}</pre>
        </CollapsibleGroup>
      ) : null}
    </>
  )
}

export function ResultPreviewCard({
  card,
  openLabel
}: {
  card: AgentRuntimeResultPreviewCard
  openLabel: string
}): React.ReactElement {
  const openItem: AgentRuntimeMessagePartDetailItem | null =
    card.openTarget && card.openTargetKind
      ? {
          kind: card.kind === 'image' ? 'media' : card.kind === 'resource' ? 'resource' : 'text',
          title: card.title,
          openTarget: card.openTarget,
          openTargetKind: card.openTargetKind
        }
      : null

  return (
    <article className={`agent-message-runtime-result-card ${card.kind}`}>
      <div className="agent-message-runtime-result-card-header">
        <div className="agent-message-runtime-result-card-heading">
          <strong>{card.title}</strong>
          {card.meta ? <small>{card.meta}</small> : null}
        </div>
        {openItem ? (
          <button
            type="button"
            className="agent-message-runtime-open"
            onClick={() => {
              void openAgentRuntimeMessagePartDetailItem(openItem)
            }}>
            {openLabel}
          </button>
        ) : null}
      </div>
      {card.previewUrl ? <img className="agent-message-runtime-preview" src={card.previewUrl} alt="" loading="lazy" /> : null}
      {card.table ? (
        <table className="agent-message-runtime-result-table">
          <thead>
            <tr>
              {card.table.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}:${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {card.text ? <pre>{card.text}</pre> : null}
    </article>
  )
}

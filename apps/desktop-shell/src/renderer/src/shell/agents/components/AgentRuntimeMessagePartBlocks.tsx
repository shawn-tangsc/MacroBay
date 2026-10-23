import { Brain, TerminalSquare, Zap } from 'lucide-react'

import type { AgentContextRendererRegistry } from '../agentContextRenderers'
import type { AgentRuntimeMessagePartBlock, AgentRuntimeMessagePartDetailItem } from '../agentRuntimeMessageParts'
import { openAgentRuntimeMessagePartDetailItem } from '../agentRuntimeMessagePartItemOpen'
import type { AgentRuntimeResultPreviewCard } from '../agentRuntimeResultPreview'
import AgentContextCard from './AgentContextCard'
import AgentMarkdownText from './AgentMarkdownText'

type AgentRuntimeMessagePartBlocksProps = {
  blocks: AgentRuntimeMessagePartBlock[]
  /** Host-owned renderers; unknown kinds fall back to the neutral grid card. */
  contextRenderers?: AgentContextRendererRegistry
  text: {
    executionGroupTitle: string
    groupSummary: (count: number) => string
    open: string
    reasoningGroupTitle: string
    input: string
    output: string
  }
}

type RuntimeBlock = Extract<AgentRuntimeMessagePartBlock, { kind: 'runtime' }>

export default function AgentRuntimeMessagePartBlocks({
  blocks,
  contextRenderers,
  text
}: AgentRuntimeMessagePartBlocksProps): React.ReactElement | null {
  if (blocks.length === 0) return null

  const groupedBlocks = groupRuntimeBlocks(blocks)

  return (
    <>
      {groupedBlocks.map((block) => {
        if (block.kind === 'context') {
          const renderer = contextRenderers?.[block.part.kind]
          const rendered = renderer?.({ part: block.part })
          return (
            <div key={block.key} data-agent-context-kind={block.part.kind}>
              {rendered ?? <AgentContextCard label={block.part.label} {...(block.part.detail ? { detail: block.part.detail } : {})} />}
            </div>
          )
        }

        if (block.kind === 'text') {
          return block.text ? <AgentMarkdownText key={block.key} text={block.text} /> : null
        }

        if (block.kind === 'command') {
          return (
            <section key={block.key} className="agent-runtime-command-card">
              <header>
                <strong>{block.title}</strong>
                <small>{block.command}</small>
              </header>
              <p>{block.summary}</p>
              {block.rows.length > 0 ? (
                <dl>
                  {block.rows.map((row) => (
                    <div key={`${row.label}:${row.value}`}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
          )
        }

        if (block.kind === 'runtime-group') {
          return (
            <details key={block.key} className={`agent-message-runtime-group ${block.groupKind}`}>
              <summary>
                <span className="agent-message-runtime-part-icon">{renderRuntimeGroupIcon(block.groupKind)}</span>
                <strong>{block.groupKind === 'reasoning' ? text.reasoningGroupTitle : text.executionGroupTitle}</strong>
                <small>{text.groupSummary(block.blocks.length)}</small>
              </summary>
              <div className="agent-message-runtime-group-items">
                {block.blocks.map((runtimeBlock) => (
                  <details
                    key={runtimeBlock.key}
                    className={`agent-message-runtime-group-item ${runtimeBlock.runtimeKind} ${runtimeBlock.status}`}>
                    <summary>
                      <span className="agent-message-runtime-part-icon">{renderRuntimeBlockIcon(runtimeBlock.runtimeKind)}</span>
                      <strong>{runtimeBlock.title}</strong>
                      <small>{runtimeBlock.subtitle}</small>
                    </summary>
                    <RuntimeBlockBody
                      block={runtimeBlock}
                      openLabel={text.open}
                      inputLabel={text.input}
                      outputLabel={text.output}
                    />
                  </details>
                ))}
              </div>
            </details>
          )
        }

        return (
          <RuntimeBlockDetails
            key={block.key}
            block={block}
            openLabel={text.open}
            inputLabel={text.input}
            outputLabel={text.output}
          />
        )
      })}
    </>
  )
}

type GroupedRuntimeBlocks =
  | AgentRuntimeMessagePartBlock
  | {
      key: string
      kind: 'runtime-group'
      groupKind: 'reasoning' | 'execution'
      blocks: RuntimeBlock[]
    }

function groupRuntimeBlocks(blocks: AgentRuntimeMessagePartBlock[]): GroupedRuntimeBlocks[] {
  const groupedBlocks: GroupedRuntimeBlocks[] = []
  let pendingReasoning: RuntimeBlock[] = []
  let pendingExecution: RuntimeBlock[] = []

  const flushRuntimeGroups = (): void => {
    if (pendingReasoning.length > 0) {
      groupedBlocks.push({
        key: `runtime-group:reasoning:${pendingReasoning[0]!.key}`,
        kind: 'runtime-group',
        groupKind: 'reasoning',
        blocks: pendingReasoning
      })
      pendingReasoning = []
    }
    if (pendingExecution.length > 0) {
      groupedBlocks.push({
        key: `runtime-group:execution:${pendingExecution[0]!.key}`,
        kind: 'runtime-group',
        groupKind: 'execution',
        blocks: pendingExecution
      })
      pendingExecution = []
    }
  }

  for (const block of blocks) {
    if (block.kind !== 'runtime') {
      flushRuntimeGroups()
      groupedBlocks.push(block)
      continue
    }

    if (block.runtimeKind === 'reasoning') {
      pendingReasoning.push(block)
    } else {
      pendingExecution.push(block)
    }
  }

  flushRuntimeGroups()
  return groupedBlocks
}

function RuntimeBlockDetails({
  block,
  openLabel,
  inputLabel,
  outputLabel
}: {
  block: RuntimeBlock
  openLabel: string
  inputLabel: string
  outputLabel: string
}): React.ReactElement {
  return (
    <details
      className={`agent-message-runtime-part ${block.runtimeKind} ${block.status}`}
      open={false}>
      <summary>
        <span className="agent-message-runtime-part-icon">{renderRuntimeBlockIcon(block.runtimeKind)}</span>
        <strong>{block.title}</strong>
        <small>{block.subtitle}</small>
      </summary>
      <RuntimeBlockBody
        block={block}
        openLabel={openLabel}
        inputLabel={inputLabel}
        outputLabel={outputLabel}
      />
    </details>
  )
}

function RuntimeBlockBody({
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
        <details className="agent-message-runtime-detail-fold">
          <summary>{inputLabel}</summary>
          <pre>{block.requestDetail}</pre>
        </details>
      ) : null}
      {block.resultCards?.length ? (
        <details className="agent-message-runtime-detail-fold">
          <summary>{resultLabel}</summary>
          <div className="agent-message-runtime-result-cards">
            {block.resultCards.map((card) => (
              <ResultPreviewCard key={card.key} card={card} openLabel={openLabel} />
            ))}
          </div>
        </details>
      ) : null}
      {block.details?.length ? (
        <div className="agent-message-runtime-part-details">
          {block.details.map((detail) => (
            <details key={detail.label} className="agent-message-runtime-detail-fold">
              <summary>{detail.label}</summary>
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
            </details>
          ))}
        </div>
      ) : !block.resultCards?.length && block.detail ? (
        <details className="agent-message-runtime-detail-fold">
          <summary>{resultLabel}</summary>
          <pre>{block.detail}</pre>
        </details>
      ) : null}
    </>
  )
}

function ResultPreviewCard({
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

function renderRuntimeBlockIcon(runtimeKind: Extract<AgentRuntimeMessagePartBlock, { kind: 'runtime' }>['runtimeKind']): React.ReactElement {
  if (runtimeKind === 'reasoning') return <Brain size={13} />
  if (runtimeKind === 'control') return <Zap size={13} />
  return <TerminalSquare size={13} />
}

function renderRuntimeGroupIcon(groupKind: 'reasoning' | 'execution'): React.ReactElement {
  return groupKind === 'reasoning' ? <Brain size={13} /> : <TerminalSquare size={13} />
}

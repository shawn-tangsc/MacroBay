import { Brain, TerminalSquare, Zap } from 'lucide-react'

import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'

import type { AgentContextRendererRegistry } from '../agentContextRenderers'
import type { AgentRuntimeMessagePartBlock, AgentRuntimeMessagePartDetailItem } from '../agentRuntimeMessageParts'
import { openAgentRuntimeMessagePartDetailItem } from '../agentRuntimeMessagePartItemOpen'
import type { AgentRuntimeResultPreviewCard } from '../agentRuntimeResultPreview'
import AgentContextCard from './AgentContextCard'
import AgentMarkdownText from './AgentMarkdownText'
import { passthroughText, RuntimeBlockBody } from './AgentRuntimeBlockBody'

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

export type RuntimeBlock = Extract<AgentRuntimeMessagePartBlock, { kind: 'runtime' }>


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
            <div key={block.key} className={`agent-message-runtime-group ${block.groupKind}`}>
              <CollapsibleGroup
                header={<>
                  <span className="agent-message-runtime-part-icon">{renderRuntimeGroupIcon(block.groupKind)}</span>
                  <strong>{block.groupKind === 'reasoning' ? text.reasoningGroupTitle : text.executionGroupTitle}</strong>
                  <small>{text.groupSummary(block.blocks.length)}</small>
                </>}
                resolveText={passthroughText}>
              <div className="agent-message-runtime-group-items">
                {block.blocks.map((runtimeBlock) => (
                  <div
                    key={runtimeBlock.key}
                    className={`agent-message-runtime-group-item ${runtimeBlock.runtimeKind} ${runtimeBlock.status}`}>
                    <CollapsibleGroup
                      header={<>
                        <span className="agent-message-runtime-part-icon">{renderRuntimeBlockIcon(runtimeBlock.runtimeKind)}</span>
                        <strong>{runtimeBlock.title}</strong>
                        <small>{runtimeBlock.subtitle}</small>
                      </>}
                      resolveText={passthroughText}>
                    <RuntimeBlockBody
                      block={runtimeBlock}
                      openLabel={text.open}
                      inputLabel={text.input}
                      outputLabel={text.output}
                    />
                    </CollapsibleGroup>
                  </div>
                ))}
              </div>
              </CollapsibleGroup>
            </div>
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
    <div className={`agent-message-runtime-part ${block.runtimeKind} ${block.status}`}>
      <CollapsibleGroup
        header={<>
          <span className="agent-message-runtime-part-icon">{renderRuntimeBlockIcon(block.runtimeKind)}</span>
          <strong>{block.title}</strong>
          <small>{block.subtitle}</small>
        </>}
        resolveText={passthroughText}>
      <RuntimeBlockBody
        block={block}
        openLabel={openLabel}
        inputLabel={inputLabel}
        outputLabel={outputLabel}
      />
      </CollapsibleGroup>
    </div>
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
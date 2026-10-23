import { parseConclusionDirection } from './analysisConclusionDirectionPolicy'

/**
 * Presentation policy for the published conclusion body.
 *
 * The model writes the conclusion as one dense paragraph that happens to carry
 * labelled parts ("因果链：…", "数据缺口：…"). Rendering it as a single block is what
 * made the detail unreadable, so the labelled parts are lifted into their own rows.
 * No text is removed or shortened: only the labels that become row titles are
 * stripped, and the rest of each part is preserved verbatim.
 */
export const analysisConclusionBlockPolicy = Object.freeze({
  /**
   * Label to block kind, in the order the labels are searched. This is the **legacy** v1 contract
   * (prose carrying labels); current summaries carry structured fields and never reach this parser.
   */
  labels: [
    { label: '本次变化', kind: 'change' },
    { label: '因果链', kind: 'causal-chain' },
    { label: '成立条件', kind: 'condition' },
    { label: '宏观侧', kind: 'macro' },
    { label: '证据强弱', kind: 'evidence' },
    { label: '数据缺口', kind: 'data-gap' }
  ] as const
})

export type AnalysisConclusionBlockKind = (typeof analysisConclusionBlockPolicy.labels)[number]['kind'] | 'text'
export type AnalysisConclusionBlock = Readonly<{ kind: AnalysisConclusionBlockKind; text: string }>

/**
 * Splits the conclusion into labelled and unlabelled blocks.
 *
 * The direction marker the model prefixes is dropped here because the badge already
 * shows it.
 */
export function parseConclusionBlocks(conclusion: string): readonly AnalysisConclusionBlock[] {
  // The legacy contract carried «方向：<术语>：»; structured summaries never reach this parser.
  const withoutMarker = parseConclusionDirection(conclusion).body.trim()
  if (!withoutMarker) return []

  // Split on every known label, keeping the label with the part that follows it.
  const labelPattern = new RegExp(`(${analysisConclusionBlockPolicy.labels.map(entry => entry.label).join('|')})[：:]`, 'g')
  const parts: { label: string | null; text: string }[] = []
  let cursor = 0
  for (const match of withoutMarker.matchAll(labelPattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ label: null, text: withoutMarker.slice(cursor, index) })
    parts.push({ label: match[1] ?? null, text: '' })
    cursor = index + match[0].length
  }
  parts.push({ label: null, text: withoutMarker.slice(cursor) })

  const blocks: AnalysisConclusionBlock[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!
    if (part.label === null) {
      const text = part.text.trim()
      if (text) blocks.push({ kind: 'text', text })
      continue
    }
    // A labelled part runs until the next label.
    const next = parts[index + 1]
    const text = (next?.label === null ? next.text : '').trim()
    index += next?.label === null ? 1 : 0
    if (text) blocks.push({ kind: kindOf(part.label), text })
  }
  return blocks
}

function kindOf(label: string): AnalysisConclusionBlockKind {
  return analysisConclusionBlockPolicy.labels.find(entry => entry.label === label)?.kind ?? 'text'
}

/**
 * Blocks for a structured conclusion: fields, not prose labels. One implementation serves every
 * reader language because the field names are language-neutral and the block titles come from i18n.
 */
export type StructuredConclusionView = Readonly<{
  summary: string
  change: string
  causalChain: string
  conditions: readonly string[]
  macro: string | null
  evidenceStrength: string | null
  dataGaps: readonly string[]
}>

export function conclusionBlocksFromStructured(conclusion: StructuredConclusionView): readonly AnalysisConclusionBlock[] {
  const blocks: AnalysisConclusionBlock[] = [{ kind: 'text', text: conclusion.summary }]
  if (conclusion.change) blocks.push({ kind: 'change', text: conclusion.change })
  if (conclusion.causalChain) blocks.push({ kind: 'causal-chain', text: conclusion.causalChain })
  for (const condition of conclusion.conditions) blocks.push({ kind: 'condition', text: condition })
  if (conclusion.macro) blocks.push({ kind: 'macro', text: conclusion.macro })
  if (conclusion.evidenceStrength) blocks.push({ kind: 'evidence', text: conclusion.evidenceStrength })
  for (const gap of conclusion.dataGaps) blocks.push({ kind: 'data-gap', text: gap })
  return blocks
}

/**
 * Only the conclusion, for a list row.
 *
 * The model writes the labelled parts ("本次变化：…", "因果链：…") into the same paragraph as the
 * conclusion, and the drawer lifts them into their own rows. In a compact timeline row all of that
 * is noise — the reader wants the verdict, and the detail is one click away — so the text is cut at
 * the first label rather than shortened, which keeps the conclusion itself verbatim.
 */
export function conclusionSummaryText(body: string): string {
  const text = typeof body === 'string' ? body : ''
  // `>= 0` on purpose: a body that *starts* with a label has no conclusion at all, and treating
  // that as "nothing to cut" is what let a label-only output reach the reader.
  const cuts = analysisConclusionBlockPolicy.labels
    .map(entry => text.indexOf(entry.label))
    .filter(index => index >= 0)
  if (cuts.length === 0) return text.trim()
  return text.slice(0, Math.min(...cuts)).replace(/[，,、；;\s]+$/u, '').trim()
}

/** The direction the conclusion states, read from its own leading marker, for a coloured tag. */
export function readConclusionDirection(body: string): string | undefined {
  return parseConclusionDirection(typeof body === 'string' ? body : '').direction
}

/** The conclusion without its direction marker, for the row's second line. */
export function conclusionWithoutDirection(body: string): string {
  return parseConclusionDirection(conclusionSummaryText(body)).body
}

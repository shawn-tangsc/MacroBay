import type { JobRuntime } from '@platform/jobs'

import type { AgentChangeLog, AgentChangeLogOutcome } from './changeLog'
import type { IntelligenceAgentCapability, ToolCallContext } from './capabilityTypes'
import type { CrossAssetOps, MacroCalendarOps } from './operationFacades'

/** Everything a write handler may reach; produced once per registration. */
export type WriteHandlerDeps = {
  jobRuntime: JobRuntime
  macroCalendarOps: MacroCalendarOps
  crossAssetOps: CrossAssetOps
  /** Lazily opens the product's audit store; a test may hand back its own instance. */
  openChangeLog: () => AgentChangeLog
}

/** A configuration view plus the revision it was read at. */
export type WriteSnapshot = {
  revision: string
  value: Record<string, unknown>
}

export type ChangedFields = Record<string, { before: unknown; after: unknown }>

const AUDIT_WARNING = 'Configuration change could not be recorded in the audit log.'

/**
 * Read -> execute -> re-read -> audit (design 152 §11).
 *
 * The business result is what the caller returns; audit metadata is layered on
 * top. A failed append never turns a successful mutation into a failed tool call:
 * it sets `auditFailed: true` and logs a value-free warning, so the reader and the
 * model both know the change exists but was not recorded.
 *
 * The post-state read is best effort for the same reason. Once `execute` has
 * succeeded the mutation is real, so a failing read-back may not surface as
 * `handler-error` (a model would retry a write that already happened). The audit
 * row still records the action, with `after: null` and a summary that says the
 * post-state could not be read.
 */
export async function runAuditedWrite(input: {
  deps: WriteHandlerDeps
  context: ToolCallContext
  capability: Pick<IntelligenceAgentCapability, 'id' | 'domain'>
  action: string
  /** Human-readable focus of the change, used only in the summary. */
  target?: string
  /** The source-like entity the change belongs to; absent for item/lease operations. */
  sourceId?: string
  /**
   * Whether this action can write configuration. Pure operations (run-now,
   * test-connection, preview, lease control) pass false so the audit row cannot be
   * mistaken for a configuration change. Defaults to true.
   */
  changesConfiguration?: boolean
  read: () => Promise<WriteSnapshot>
  execute: () => Promise<Record<string, unknown>>
}): Promise<Record<string, unknown>> {
  const before = await input.read()
  const business = await input.execute()
  const after = await readPostState(input.read)
  const changed = after ? diffSnapshots(before.value, after.value) : {}
  const changesConfiguration = input.changesConfiguration ?? true
  const outcome = deriveOutcome(business, changesConfiguration)
  // True only when the action is a configuration write and it applied. It says nothing about
  // whether the observed value differs: `changed` answers that.
  const configurationChanged = changesConfiguration && outcome === 'applied'

  const recorded = await record({
    deps: input.deps,
    context: input.context,
    capability: input.capability,
    action: input.action,
    target: input.target,
    sourceId: input.sourceId,
    before,
    after,
    changed,
    outcome,
    configurationChanged
  })

  return {
    ...business,
    revisionBefore: before.revision,
    // Without a post-state read the revision is unknown; report the only one we
    // actually observed and let `auditFailed` say the audit is incomplete.
    revisionAfter: after?.revision ?? before.revision,
    changed,
    ...(recorded && after ? {} : { auditFailed: true })
  }
}

async function readPostState(read: () => Promise<WriteSnapshot>): Promise<WriteSnapshot | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

async function record(input: {
  deps: WriteHandlerDeps
  context: ToolCallContext
  capability: Pick<IntelligenceAgentCapability, 'id' | 'domain'>
  action: string
  target?: string
  sourceId?: string
  before: WriteSnapshot
  after: WriteSnapshot | null
  changed: ChangedFields
  outcome: AgentChangeLogOutcome
  configurationChanged: boolean
}): Promise<boolean> {
  try {
    input.deps.openChangeLog().append({
      traceId: input.context.toolCallId,
      agentId: input.context.agentId,
      agentSessionId: input.context.agentSessionId,
      domain: input.capability.domain,
      action: input.action,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      before: input.before.value,
      after: input.after?.value ?? null,
      changeSummary: input.after
        ? summarize(input.action, input.target, input.changed, input.outcome)
        : `${scopeOf(input.action, input.target)}: post-state could not be read`,
      outcome: input.outcome,
      configurationChanged: input.configurationChanged,
      revisionBefore: input.before.revision,
      revisionAfter: input.after?.revision ?? input.before.revision,
      createdAt: new Date().toISOString()
    })
    return true
  } catch {
    try {
      await input.context.log({
        level: 'warn',
        message: AUDIT_WARNING,
        // Capability, action, trace id: enough to find the call, and nothing that could carry
        // a configuration value, a credential, a URL, or an endpoint into the process log.
        details: {
          capabilityId: input.capability.id,
          action: input.action,
          traceId: input.context.toolCallId
        }
      })
    } catch {
      // A logging failure must not hide the business result either.
    }
    return false
  }
}

function scopeOf(action: string, target: string | undefined): string {
  return target ? `${action} ${target}` : action
}

/**
 * A rejection or a failed provider action must read as exactly that. Before this, both wrote
 * `changed: {}` and the same "no configuration change" sentence as a genuine no-op.
 */
function deriveOutcome(
  business: Record<string, unknown>,
  changesConfiguration: boolean
): AgentChangeLogOutcome {
  const state = typeof business.state === 'string' ? business.state : undefined
  const actionOutcome = typeof business.outcome === 'string' ? business.outcome : undefined
  if (state === 'rejected') return 'rejected'
  if (state === 'failed' || state === 'unavailable' || actionOutcome === 'failed') return 'failed'
  if (state === 'unchanged') return 'unchanged'
  return changesConfiguration ? 'applied' : 'unchanged'
}

function summarize(
  action: string,
  target: string | undefined,
  changed: ChangedFields,
  outcome: AgentChangeLogOutcome
): string {
  const scope = scopeOf(action, target)
  if (outcome === 'rejected') return `${scope}: rejected`
  if (outcome === 'failed') return `${scope}: failed`
  const fields = Object.entries(changed)
  if (fields.length === 0) return `${scope}: no configuration change`
  return `${scope}: ${fields
    .map(([field, diff]) => `${field} ${formatValue(diff.before)} -> ${formatValue(diff.after)}`)
    .join(', ')}`
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}=${formatValue(entry)}`)
      .join(' ')
  }
  return String(value)
}

/** Null rather than omission: a field absent on one side must still show as a change. */
function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): ChangedFields {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  const changed: ChangedFields = {}
  for (const key of keys) {
    const previous = Object.hasOwn(before, key) ? before[key] : null
    const next = Object.hasOwn(after, key) ? after[key] : null
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changed[key] = { before: previous, after: next }
    }
  }
  return changed
}

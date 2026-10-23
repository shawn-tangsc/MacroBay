import type { JobRuntime } from '@platform/jobs'

import type { AgentChangeLog } from './changeLog'
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
  read: () => Promise<WriteSnapshot>
  execute: () => Promise<Record<string, unknown>>
}): Promise<Record<string, unknown>> {
  const before = await input.read()
  const business = await input.execute()
  const after = await input.read()
  const changed = diffSnapshots(before.value, after.value)

  const recorded = await record({
    deps: input.deps,
    context: input.context,
    capability: input.capability,
    action: input.action,
    target: input.target,
    sourceId: input.sourceId,
    before,
    after,
    changed
  })

  return {
    ...business,
    revisionBefore: before.revision,
    revisionAfter: after.revision,
    changed,
    ...(recorded ? {} : { auditFailed: true })
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
  after: WriteSnapshot
  changed: ChangedFields
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
      after: input.after.value,
      changeSummary: summarize(input.action, input.target, input.changed),
      revisionBefore: input.before.revision,
      revisionAfter: input.after.revision,
      createdAt: new Date().toISOString()
    })
    return true
  } catch {
    try {
      await input.context.log({ level: 'warn', message: AUDIT_WARNING })
    } catch {
      // A logging failure must not hide the business result either.
    }
    return false
  }
}

function summarize(action: string, target: string | undefined, changed: ChangedFields): string {
  const scope = target ? `${action} ${target}` : action
  const fields = Object.keys(changed)
  return fields.length === 0 ? `${scope}: no configuration change` : `${scope}: ${fields.join(', ')}`
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

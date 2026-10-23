import type { MacroCalendarSettingsProviderId } from '../../../contracts/macro/economicCalendarQueryContracts'
import { ProductToolGuardError, type ToolCallContext } from './capabilityTypes'
import type { MacroCalendarOps } from './operationFacades'
import type { WriteHandlerDeps } from './writeAudit'
import { runAuditedWrite } from './writeAudit'
import { readRevisionSnapshot } from './writeState'

const CALENDAR_CAPABILITY = { id: 'operate_macro_calendar', domain: 'calendar' } as const

type CalendarAction =
  | 'save-provider-profile'
  | 'run-provider-now'
  | 'test-provider-connection'
  | 'set-release-time'
  | 'clear-release-time'
  | 'refresh-bls-employment'
  | 'refresh-fed-fomc'
  | 'sync-bls-schedule'
  | 'preview-manual-ics'
  | 'import-manual-ics'

type CalendarInput = {
  action: CalendarAction
  providerId?: string
  enabled?: boolean
  eventKey?: string
  scheduledAt?: string
  scheduledDate?: string
  acknowledgeOverwrite?: boolean
  year?: string
  body?: string
  truncated?: boolean
}

export async function handleOperateMacroCalendar(
  input: unknown,
  deps: WriteHandlerDeps,
  context: ToolCallContext
): Promise<unknown> {
  const value = input as CalendarInput
  const ops = deps.macroCalendarOps
  const action = value.action
  const target = targetOf(value)

  return runAuditedWrite({
    deps,
    context,
    capability: CALENDAR_CAPABILITY,
    action,
    ...(target ? { target } : {}),
    ...(value.providerId ? { sourceId: value.providerId } : {}),
    read: () => readRevisionSnapshot(deps),
    execute: () => executeCalendarAction(ops, value)
  })
}

async function executeCalendarAction(
  ops: MacroCalendarOps,
  value: CalendarInput
): Promise<Record<string, unknown>> {
  switch (value.action) {
    case 'save-provider-profile': {
      const providerId = requireProviderId(value.providerId)
      if (typeof value.enabled !== 'boolean') {
        throw new ProductToolGuardError('missing-property', 'Missing required parameter: enabled.')
      }
      const result = await ops.saveProviderProfile({ providerId, enabled: value.enabled })
      return { ...(result as Record<string, unknown>), providerId }
    }
    case 'run-provider-now': {
      const providerId = requireProviderId(value.providerId)
      const result = await ops.runProviderNow(providerId)
      return { ...(result as Record<string, unknown>), providerId }
    }
    case 'test-provider-connection': {
      const providerId = requireProviderId(value.providerId)
      const result = await ops.testProviderConnection(providerId)
      return { ...(result as Record<string, unknown>), providerId }
    }
    case 'set-release-time': {
      const eventKey = requireString(value.eventKey, 'eventKey')
      const result = await ops.setReleaseTime({
        eventKey,
        scheduledAt: requireString(value.scheduledAt, 'scheduledAt'),
        scheduledDate: requireString(value.scheduledDate, 'scheduledDate')
      })
      return { ...(result as Record<string, unknown>), eventKey }
    }
    case 'clear-release-time': {
      const eventKey = requireString(value.eventKey, 'eventKey')
      const result = await ops.clearReleaseTime(eventKey)
      return { ...(result as Record<string, unknown>), eventKey }
    }
    case 'refresh-bls-employment': {
      const eventKey = requireString(value.eventKey, 'eventKey')
      requireOverwriteAcknowledgement(value)
      const result = await ops.refreshBlsEmployment({ eventKey, confirmed: true })
      return { ...(result as Record<string, unknown>), eventKey }
    }
    case 'refresh-fed-fomc': {
      const eventKey = requireString(value.eventKey, 'eventKey')
      requireOverwriteAcknowledgement(value)
      const result = await ops.refreshFedFomc({ eventKey, confirmed: true })
      return { ...(result as Record<string, unknown>), eventKey }
    }
    case 'sync-bls-schedule': {
      const year = requireString(value.year, 'year')
      const result = await ops.syncBlsSchedule({ year })
      return { ...(result as Record<string, unknown>), year }
    }
    case 'preview-manual-ics': {
      const result = await ops.previewManualIcs({
        body: requireString(value.body, 'body'),
        truncated: value.truncated === true
      })
      return { ...(result as Record<string, unknown>) }
    }
    case 'import-manual-ics': {
      const result = await ops.importManualIcs({
        body: requireString(value.body, 'body'),
        truncated: value.truncated === true
      })
      return { ...(result as Record<string, unknown>) }
    }
  }
}

/**
 * The reader acknowledged that the refresh overwrites published values. The
 * service's own `confirmed: true` is not a tool parameter and is added above.
 */
function requireOverwriteAcknowledgement(value: CalendarInput): void {
  if (value.acknowledgeOverwrite !== true) {
    throw new ProductToolGuardError(
      'invalid-input',
      'acknowledgeOverwrite must be true for an overwrite refresh.'
    )
  }
}

function targetOf(value: CalendarInput): string | undefined {
  return value.providerId ?? value.eventKey ?? (value.action === 'sync-bls-schedule' ? value.year : undefined)
}

/**
 * The catalog keeps providerId as a string because the provider registry is data, not a schema
 * constant; the service still owns the only acceptance check.
 */
function requireProviderId(value: unknown): MacroCalendarSettingsProviderId {
  return requireString(value, 'providerId') as MacroCalendarSettingsProviderId
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProductToolGuardError('missing-property', `Missing required parameter: ${name}.`)
  }
  return value
}

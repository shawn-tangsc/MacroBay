import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

const fixture = vi.hoisted(() => ({ adaptersAvailable: true, forceUnguarded: false }))

vi.mock('../product-tools/registerIntelligenceProductTools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../product-tools/registerIntelligenceProductTools')>()
  return {
    registerIntelligenceProductTools: (
      register: Parameters<typeof actual.registerIntelligenceProductTools>[0],
      jobRuntime: Parameters<typeof actual.registerIntelligenceProductTools>[1]
    ) => {
      if (fixture.adaptersAvailable) actual.registerIntelligenceProductTools(register, jobRuntime)
    }
  }
})

vi.mock('./wrapProductToolHandler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wrapProductToolHandler')>()
  return {
    ...actual,
    wrapProductToolHandler: (
      options: Parameters<typeof actual.wrapProductToolHandler>[0]
    ): ReturnType<typeof actual.wrapProductToolHandler> =>
      fixture.forceUnguarded
        ? ({
            capabilityId: options.capability.id,
            handle: async () => ({ ok: true })
          } as unknown as ReturnType<typeof actual.wrapProductToolHandler>)
        : actual.wrapProductToolHandler(options)
  }
})

const { registerIntelligenceAgentToolHandlers } = await import('./handlerRegistry')

const jobRuntime = {} as JobRuntime

function attemptRegistration(): {
  registrations: Map<string, ProductAgentToolHandlerRegistration>
  error: unknown
} {
  const registrations = new Map<string, ProductAgentToolHandlerRegistration>()
  try {
    registerIntelligenceAgentToolHandlers(
      (registration) => registrations.set(registration.handlerId, registration),
      { jobRuntime }
    )
    return { registrations, error: undefined }
  } catch (error) {
    return { registrations, error }
  }
}

describe('intelligence handler registry guards', () => {
  beforeEach(() => {
    fixture.adaptersAvailable = true
    fixture.forceUnguarded = false
  })

  it('throws when a capability handlerId has no registered adapter and registers nothing', () => {
    fixture.adaptersAvailable = false

    const { registrations, error } = attemptRegistration()

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/No product handler adapter registered/)
    expect(registrations.size).toBe(0)
  })

  it('refuses a non-guarded handler and lets nothing into the registry', () => {
    fixture.forceUnguarded = true

    const { registrations, error } = attemptRegistration()

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/unguarded handler/)
    expect(registrations.size).toBe(0)
  })
})

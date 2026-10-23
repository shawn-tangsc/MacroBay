import { beforeAll, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'market-intelligence-bootstrap-test')
  },
  net: {
    fetch: vi.fn(async () => new Response('{}', { status: 200 }))
  }
}))

import { createJobRuntime } from '@platform/jobs'
import { createEventBusRuntime } from '@platform/message-bus'
import { createProductIpcRegistry } from '@platform/desktop/ipc/productIpcRegistry'

import { getBlsApiCompatibilityProbe, registerServices } from './bootstrap'
import { marketIntelligenceProductManifest } from '../product.manifest'
import { MACRO_ECONOMIC_CALENDAR_IPC_METHODS } from '../contracts/macro/economicCalendarQueryContracts'
import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../contracts/intelligencePublicQueryMethods'
import { DASHBOARD_SOURCE_CONNECTION_IPC_METHOD } from './intelligence/schema/intelligenceSourcesContracts'
import { marketCalendarPublicPolicy } from '../contracts/macro/marketCalendarQueryContracts'
import { crossAssetMethods } from '../contracts/crossAssetObservationContracts'
import * as crossAssetStorage from './intelligence/cross-asset/crossAssetStore'

beforeAll(() => {
  // Bootstrap intentionally logs diagnostic markers. A late marker can race the worker
  // teardown, so keep the console channel quiet for this file.
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('market-intelligence product bootstrap', () => {
  it('isolates a cross-asset database open failure without losing the existing product routes', async () => {
    const open = vi.spyOn(crossAssetStorage, 'createCrossAssetStore').mockImplementationOnce(() => { throw Error('private filesystem error') })
    const registry = createProductIpcRegistry()
    const disposers: (() => Promise<void> | void)[] = []
    try {
      expect(() => registerServices({ register: registry.register, jobRuntime: createJobRuntime(), eventBusRuntime: createEventBusRuntime(),
        registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), platformFetch: vi.fn(),
        registerProductDisposer: handler => { disposers.push(handler); return () => undefined } })).not.toThrow()
      const methods = registry.seal().map(item => item.method)
      expect(methods).toContain(marketCalendarPublicPolicy.methods.query)
      expect(await registry.invoke('market-intelligence', crossAssetMethods.query, { range: '1h' })).toEqual({ state: 'unavailable' })
    } finally { open.mockRestore(); for (const dispose of disposers) await dispose() }
  })
  it('registers all cross-asset methods without network startup and keeps queries read-only', async () => {
    const registry = createProductIpcRegistry()
    const fetch = vi.fn()
    const dispose: (() => Promise<void> | void)[] = []
    registerServices({ register: registry.register, jobRuntime: createJobRuntime(), eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), platformFetch: fetch,
      getNetworkSettings: async () => ({ proxyMode: 'none', proxyUrl: '', proxyBypassRules: '' }),
      registerProductDisposer: handler => { dispose.push(handler); return () => undefined } })
    try {
      const methods = registry.seal().map(item => item.method)
      expect(methods).toEqual(expect.arrayContaining(Object.values(crossAssetMethods)))
      expect(marketIntelligenceProductManifest.serviceRoutes.map(item => item.method)).toEqual(expect.arrayContaining(Object.values(crossAssetMethods)))
      const snapshot = await registry.invoke('market-intelligence', crossAssetMethods.query, { range: '1h' })
      expect(snapshot).toMatchObject({ mode: 'current', range: '1h' })
      expect(fetch).not.toHaveBeenCalled()
    } finally { for (const handler of dispose) await handler() }
  })
  it('registers manual market query and refresh without issuing a startup market request', () => {
    const fetch = vi.fn()
    const methods: string[] = []
    registerServices({ register: (_id, method) => methods.push(method), jobRuntime: createJobRuntime(),
      eventBusRuntime: createEventBusRuntime(), registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), platformFetch: fetch })
    expect(methods).toContain(marketCalendarPublicPolicy.methods.refresh)
    expect(methods).toContain(marketCalendarPublicPolicy.methods.query)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('declares manual market methods in the sealed product baseline', () => {
    const registry = createProductIpcRegistry()
    for (const { method } of marketIntelligenceProductManifest.serviceRoutes) registry.register('market-intelligence', method, () => undefined)
    for (const method of Object.values(marketCalendarPublicPolicy.methods)) {
      if (!marketIntelligenceProductManifest.serviceRoutes.some(route => route.method === method)) registry.register('market-intelligence', method, () => undefined)
    }
    expect(() => registry.seal(marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => ({
      productId: 'market-intelligence', method
    })))).not.toThrow()
  })
  it('initializes the private BLS compatibility probe without fetching or registering a public route', () => {
    const fetch = vi.fn()
    const registeredMethods: string[] = []

    registerServices({
      register: (_productId, method) => registeredMethods.push(method),
      jobRuntime: createJobRuntime(),
      eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(),
      registerProductCache: vi.fn(),
      platformFetch: fetch
    })

    expect(getBlsApiCompatibilityProbe()).toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(registeredMethods).not.toContain('intelligence.bls.compatibility.probe')
    expect(marketIntelligenceProductManifest.serviceRoutes).not.toContainEqual({ method: 'intelligence.bls.compatibility.probe' })
  })
  it('prepares the sealed BLS refresh route without invoking injected fetch at startup', () => {
    const fetch = vi.fn()
    const registeredMethods: string[] = []
    registerServices({ register: (_id, method) => registeredMethods.push(method), jobRuntime: createJobRuntime(), eventBusRuntime: createEventBusRuntime(), registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), platformFetch: fetch })
    expect(registeredMethods).toContain(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('registers product-owned translation cache through the platform cache seam', () => {
    const register = vi.fn()
    const registerProductAgentToolHandler = vi.fn()
    const registerProductCache = vi.fn()

    registerServices({
      register,
      jobRuntime: createJobRuntime(),
      eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler,
      registerProductCache,
      secretVault: vault()
    })

    expect(registerProductCache).toHaveBeenCalledWith(
      'market-intelligence',
      expect.objectContaining({
        cacheId: 'market-intelligence.translation-records',
        clearable: true,
        compactable: true
      })
    )
  })

  it('registers the static product IPC baseline before the registry becomes active', () => {
    const registry = createProductIpcRegistry()

    registerServices({
      register: registry.register,
      jobRuntime: createJobRuntime(),
      eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(),
      registerProductCache: vi.fn(), secretVault: vault()
    })

    expect(() => registry.seal(
      marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => ({
        productId: marketIntelligenceProductManifest.id,
        method
      }))
    )).not.toThrow()
  })

  it('declares the funding history query without retaining the superseded single-point funding route', () => {
    const registeredMethods: string[] = []
    registerServices({
      register: (_productId, method) => registeredMethods.push(method),
      jobRuntime: createJobRuntime(), eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), secretVault: vault()
    })

    expect(registeredMethods).toContain(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot)
    expect(marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)).toContain(
      INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot
    )
    expect(registeredMethods).toContain(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFundingRateHistory)
    expect(marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)).toContain(
      INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFundingRateHistory
    )
    expect(registeredMethods).not.toContain('intelligence.queryFundingRatePairSnapshot')
    expect(marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)).not.toContain(
      'intelligence.queryFundingRatePairSnapshot'
    )
  })

  it('declares and registers the sealed capital snapshot query without fetching at startup', () => {
    const fetch = vi.fn()
    const registeredMethods: string[] = []

    registerServices({
      register: (_productId, method) => registeredMethods.push(method),
      jobRuntime: createJobRuntime(), eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), platformFetch: fetch
    })

    expect(registeredMethods).toContain(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)
    expect(marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)).toContain(
      INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('registers the fixed macro-calendar job handler and a product disposer', () => {
    const registerProductDisposer = vi.fn(() => () => undefined)

    registerServices({
      register: vi.fn(),
      jobRuntime: createJobRuntime(),
      eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(),
      registerProductCache: vi.fn(), secretVault: vault(),
      registerProductDisposer
    })

    expect(marketIntelligenceProductManifest.jobHandlers).toContainEqual({ id: 'market-intelligence.refreshMacroCalendar' })
    expect(registerProductDisposer).toHaveBeenCalledOnce()
    expect(registerProductDisposer.mock.calls[0][0]).not.toThrow()
  })

  it('declares and registers the calendar query and sealed official-value action IPC methods', () => {
    const registeredMethods: string[] = []

    registerServices({
      register: (_productId, method) => registeredMethods.push(method),
      jobRuntime: createJobRuntime(),
      eventBusRuntime: createEventBusRuntime(),
      registerProductAgentToolHandler: vi.fn(),
      registerProductCache: vi.fn()
    })

    const macroMethods = registeredMethods.filter((method) => method.startsWith('intelligence.macro.economicCalendar.'))
    const manifestMacroMethods = marketIntelligenceProductManifest.serviceRoutes
      .map(({ method }) => method)
      .filter((method) => method.startsWith('intelligence.macro.economicCalendar.'))
    expect(macroMethods).toEqual([
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getEventDetail,
      // The reader's own release time: the editor's two writes, registered and declared together.
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.setReleaseTime,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.clearReleaseTime,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderSchedule,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection
    ])
    expect(manifestMacroMethods).toEqual([
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getEventDetail,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderSchedule,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.setReleaseTime,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.clearReleaseTime,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection
    ])
  })

  it('declares and registers the fixed Fed and BEA provider settings IPC methods', () => {
    const registeredMethods: string[] = []
    registerServices({ register: (_productId, method) => registeredMethods.push(method), jobRuntime: createJobRuntime(), eventBusRuntime: createEventBusRuntime(), registerProductAgentToolHandler: vi.fn(), registerProductCache: vi.fn(), secretVault: vault() })

    expect(registeredMethods).toEqual(expect.arrayContaining([
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderSchedule,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection,
      DASHBOARD_SOURCE_CONNECTION_IPC_METHOD
    ]))
    expect(marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)).toEqual(expect.arrayContaining([
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderSchedule,
      MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection,
      DASHBOARD_SOURCE_CONNECTION_IPC_METHOD
    ]))
  })
})

function vault() { return { put: vi.fn(), rotate: vi.fn(), delete: vi.fn(), has: vi.fn(async () => false) } as never }

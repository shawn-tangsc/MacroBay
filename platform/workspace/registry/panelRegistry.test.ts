import { describe, expect, it } from 'vitest'

import { WorkspaceRegistrationError, type WorkspacePanelRegistration } from '../contracts'
import { createPanelRegistry } from './panelRegistry'
import { demoPanelAllowlist, demoPanelRegistrations } from '../demo/panelFixtures'

function registration(): WorkspacePanelRegistration {
  return {
    panelId: 'sample.inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
    module: 'sample.inspector', pageIds: ['sample.overview'],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'], defaultMode: 'embedded',
    allowMultipleInstances: false, minSize: { width: 320, height: 240 },
    preferredSize: { width: 480, height: 360 }, binding: { persistence: 'session', maxKeyBytes: 256 },
    lifecycleEvents: ['open', 'close']
  }
}
function registry() {
  return createPanelRegistry({ pageIds: ['sample.overview'], moduleIds: ['sample.inspector'] })
}

describe('workspace panel registry', () => {
  it('constructs a sealed all-mode demo registry without any product contribution', () => {
    const store = createPanelRegistry(demoPanelAllowlist)
    demoPanelRegistrations.forEach((panel) => store.register(panel))
    store.seal()
    expect(store.list()).toHaveLength(1)
    expect(store.get('platform.inspector')?.supportedModes).toEqual(['embedded', 'docked-right', 'docked-bottom', 'detached'])
    expect(store.get('platform.inspector')?.binding).toEqual({ persistence: 'none', maxKeyBytes: 256 })
  })
  it('returns validated immutable registrations and a narrow safe summary after sealing', () => {
    const source = registration()
    const store = registry()
    store.register(source)
    source.title['en-US'] = 'Changed outside'
    store.seal()
    expect(store.get(source.panelId)).toEqual(registration())
    expect(store.list()).toEqual([{ id: source.panelId, kind: 'panel', title: registration().title }])
    expect(() => { store.get(source.panelId)!.title['en-US'] = 'Mutated' }).toThrow()
    expect(Object.isFrozen(store.get(source.panelId)!.pageIds)).toBe(true)
    expect(Object.isFrozen(store.get(source.panelId)!.binding)).toBe(true)
    expect(Object.isFrozen(store.list())).toBe(true)
    expect(store.get('unknown')).toBeUndefined()
  })

  it('rejects duplicate IDs and registration after seal without replacing the original', () => {
    const store = registry()
    store.register(registration())
    expect(() => store.register(registration())).toThrowError(new WorkspaceRegistrationError('duplicate-registration', 'panelId'))
    store.seal()
    store.seal()
    expect(() => store.register(registration())).toThrowError(new WorkspaceRegistrationError('registry-sealed'))
    expect(store.list()).toHaveLength(1)
  })

  it('cannot publish an unsealed registry or expand its allowlist by external mutation', () => {
    const pageIds = ['sample.overview']
    const moduleIds = ['sample.inspector']
    const store = createPanelRegistry({ pageIds, moduleIds })
    expect(() => store.list()).toThrowError(new WorkspaceRegistrationError('registry-not-sealed'))
    expect(() => store.get('sample.inspector')).toThrowError(new WorkspaceRegistrationError('registry-not-sealed'))
    pageIds.push('other.page')
    moduleIds.push('other.module')
    expect(() => store.register({ ...registration(), pageIds: ['other.page'] })).toThrow(WorkspaceRegistrationError)
    expect(() => store.register({ ...registration(), module: 'other.module' })).toThrow(WorkspaceRegistrationError)
  })

  it.each([
    { panelId: '' }, { panelId: '../unsafe' }, { panelId: 'UpperCase' }, { panelId: 'sample..inspector' },
    { title: { 'zh-CN': '检查器', 'en-US': ' ' } }, { title: null }, { icon: 'unknown-icon' },
    { module: 'https://example.invalid/view' }, { module: '../view' }, { module: 'unknown' },
    { pageIds: [] }, { pageIds: ['missing'] }, { pageIds: ['sample.overview', 'sample.overview'] },
    { supportedModes: [] }, { supportedModes: ['embedded', 'embedded'] }, { supportedModes: ['detached'] },
    { supportedModes: ['embedded', 'unknown'] }, { defaultMode: 'detached' },
    { supportedModes: ['embedded'], defaultMode: 'docked-right' }, { allowMultipleInstances: 'yes' },
    { minSize: { width: NaN, height: 240 } }, { minSize: { width: 0, height: 240 } },
    { minSize: { width: 320, height: -1 } }, { preferredSize: { width: Infinity, height: 360 } },
    { preferredSize: { width: 319, height: 360 } }, { preferredSize: { width: 480, height: 239 } },
    { binding: { persistence: 'forever', maxKeyBytes: 256 } },
    { binding: { persistence: 'session', maxKeyBytes: 257 } },
    { binding: { persistence: 'session', maxKeyBytes: 0 } },
    { binding: { persistence: 'session', maxKeyBytes: 1.5 } },
    { binding: { persistence: 'durable', maxKeyBytes: Infinity } },
    { lifecycleEvents: ['invalid'] }, { lifecycleEvents: ['open', 'open'] },
    { load: () => null }, { privateState: { data: 'not a registration' } }
  ])('rejects malformed static declarations: %j', (patch) => {
    const store = registry()
    expect(() => store.register({ ...registration(), ...patch })).toThrow(WorkspaceRegistrationError)
    store.seal()
    expect(store.list()).toEqual([])
  })

  it.each([null, [], 'panel', 1])('rejects non-record declarations: %j', (value) => {
    expect(() => registry().register(value)).toThrow(WorkspaceRegistrationError)
  })

  it.each(['pageIds', 'supportedModes', 'lifecycleEvents'])('rejects sparse %s arrays', (field) => {
    const sparse = field === 'supportedModes' ? ['embedded', ,] : new Array(1)
    expect(() => registry().register({ ...registration(), [field]: sparse })).toThrow(WorkspaceRegistrationError)
  })

  it('rejects arrays that override validation or iteration', () => {
    const pageIds = ['other.page']
    Object.defineProperty(pageIds, 'every', { value: () => true })
    expect(() => registry().register({ ...registration(), pageIds })).toThrow(WorkspaceRegistrationError)
    const modes = ['embedded']
    Object.defineProperty(modes, Symbol.iterator, { value: function* () { yield 'detached' } })
    expect(() => registry().register({ ...registration(), supportedModes: modes })).toThrow(WorkspaceRegistrationError)
    const events = ['open']
    Object.defineProperty(events, '0', { get: () => 'open' })
    expect(() => registry().register({ ...registration(), lifecycleEvents: events })).toThrow(WorkspaceRegistrationError)
  })

  it.each(['none', 'session', 'durable'] as const)('accepts explicit %s binding policy', (persistence) => {
    const store = registry()
    store.register({ ...registration(), binding: { persistence, maxKeyBytes: 128 } })
    store.seal()
    expect(store.get('sample.inspector')!.binding).toEqual({ persistence, maxKeyBytes: 128 })
  })
})

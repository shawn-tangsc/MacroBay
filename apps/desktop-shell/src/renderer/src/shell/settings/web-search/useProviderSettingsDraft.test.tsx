// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeWebSearchProviderView } from '@platform/ai/web-search/contracts/webSearchContracts'

import { platformText } from '../../../i18n/platformText'
import { useProviderSettingsDraft } from './useProviderSettingsDraft'

const labels = platformText['zh-CN'].webSearch
let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function provider(overrides: Partial<SafeWebSearchProviderView> = {}): SafeWebSearchProviderView {
  return {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
    enabled: false,
    apiHostByCapability: { searchKeywords: 'https://api.tavily.com' },
    hasApiKey: false,
    apiKeyPreview: '',
    hasBasicAuth: false,
    defaultForCapabilities: ['searchKeywords'],
    phase: 0,
    implemented: true,
    ...overrides
  }
}

type SaveFn = (input: Record<string, unknown>) => Promise<void>

const testProvider = provider()

function Probe({ onSave }: { onSave: SaveFn }): React.ReactElement {
  const draft = useProviderSettingsDraft({
    labels,
    provider: testProvider,
    onSave: onSave as never,
    onCheck: async () => ({ valid: true })
  })
  return (
    <div>
      <span id="enabled">{String(draft.enabled)}</span>
      <span id="dirty">{String(draft.dirty)}</span>
      <span id="defaults">{draft.defaultForCapabilities.join(',')}</span>
      <span id="status">{draft.status ?? ''}</span>
      <button id="toggle" onClick={() => void draft.toggleEnabled(!draft.enabled)} />
      <button id="defaults-change" onClick={() => void draft.changeDefaults(['fetchUrls'])} />
      <button id="type-key" onClick={() => draft.setApiKey('new-key-123456')} />
      <button id="save" disabled={!draft.dirty || draft.saving} onClick={() => void draft.saveText()} />
    </div>
  )
}

async function mount(onSave: SaveFn): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(Probe, { onSave })))
  return container
}

async function click(container: HTMLElement, id: string): Promise<void> {
  const element = container.querySelector(`#${id}`) as HTMLElement
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('PLAT-55 provider auto-save', () => {
  it('toggle submits only providerId + enabled, even with a draft key present', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined)
    const container = await mount(onSave)

    await click(container, 'type-key')
    expect(container.querySelector('#dirty')?.textContent).toBe('true')
    await click(container, 'toggle')

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual({ providerId: 'tavily', enabled: true })
  })

  it('toggling alone is not dirty and keeps the text save button disabled', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined)
    const container = await mount(onSave)

    await click(container, 'toggle')

    expect(container.querySelector('#enabled')?.textContent).toBe('true')
    expect(container.querySelector('#dirty')?.textContent).toBe('false')
    expect((container.querySelector('#save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('rolls the toggle back and shows an error when saving fails', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => {
      throw new Error('network-down')
    })
    const container = await mount(onSave)

    await click(container, 'toggle')

    expect(container.querySelector('#enabled')?.textContent).toBe('false')
    expect(container.querySelector('#status')?.textContent).toContain(labels.toggleSaveFailed)
    expect(container.querySelector('#status')?.textContent).toContain('network-down')
  })

  it('changing default capabilities submits only that patch and preserves other overrides', async () => {
    const persisted = {
      providerId: 'tavily',
      enabled: false,
      apiKeys: ['old-key'],
      engines: ['google'],
      basicAuthUsername: 'user',
      basicAuthPassword: 'pass',
      defaultForCapabilities: ['searchKeywords']
    }
    const onSave = vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(persisted, patch)
    })
    const container = await mount(onSave)

    await click(container, 'defaults-change')

    expect(onSave.mock.calls[0][0]).toEqual({ providerId: 'tavily', defaultForCapabilities: ['fetchUrls'] })
    expect(persisted.apiKeys).toEqual(['old-key'])
    expect(persisted.engines).toEqual(['google'])
    expect(persisted.basicAuthUsername).toBe('user')
    expect(persisted.basicAuthPassword).toBe('pass')
    expect(persisted.defaultForCapabilities).toEqual(['fetchUrls'])
  })

  it('rolls default capabilities back when saving fails', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => {
      throw new Error('save-down')
    })
    const container = await mount(onSave)

    await click(container, 'defaults-change')

    expect(container.querySelector('#defaults')?.textContent).toBe('searchKeywords')
    expect(container.querySelector('#status')?.textContent).toContain(labels.defaultSaveFailed)
  })

  it('text save submits key/advanced fields without auto-save fields', async () => {
    const onSave = vi.fn(async (_input: Record<string, unknown>) => undefined)
    const container = await mount(onSave)

    await click(container, 'type-key')
    await click(container, 'save')

    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      providerId: 'tavily',
      apiKeys: ['new-key-123456'],
      apiHostByCapability: { searchKeywords: 'https://api.tavily.com' }
    })
    expect(payload).not.toHaveProperty('enabled')
    expect(payload).not.toHaveProperty('defaultForCapabilities')
    expect(payload).not.toHaveProperty('engines')
    expect(payload).not.toHaveProperty('basicAuthUsername')
  })
})

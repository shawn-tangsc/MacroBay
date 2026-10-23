// @vitest-environment happy-dom
import { act, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'
import { createWorkspaceDraftGate } from '../workspace/workspaceDraftGate'
import {
  createModelServiceSettingsDraftOwner,
  createSettingsDraftOwnerPort,
  SettingsDraftPrompt,
  type SettingsDraftDecision,
  type SettingsDraftOwner
} from './SettingsWorkspaceAdapter'

/**
 * Owner: apps/desktop-shell renderer / settings 草稿 owner 接点（P2-02）。
 * 权威：派发单「必须用真实 Settings owner 集成验证 gate 读取的是已有表单草稿、保存复用原 save 回调、
 * 失败时保留原窗；不得用 adapter 自造布尔状态的 mock 代替」。
 *
 * 这里的「真实 owner」= AppShell 模型服务设置窗的既有表单草稿（`apiKeyDraft` 绑定在同一 input 上）
 * + 既有保存回调（`buildProviderInputFromDraft` → `window.platform.modelProviders.upsert`），
 * 只把平台桥替换为记录型桩，**不替换草稿状态本身**。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.replaceChildren()
})

const providerFixture: SafeModelProvider = {
  id: 'provider-local',
  name: 'Local Provider',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }
  ],
  enabled: true,
  baseUrl: 'https://api.example.test/v1',
  hasApiKey: false,
  apiKeyPreview: '',
  connectionStatus: 'unavailable',
  models: [{
    id: 'chat-model',
    name: 'Chat Model',
    capabilities: { chat: true, vision: false, embedding: false, tools: true }
  }],
  defaultChatModelId: 'chat-model'
}

const apiKeyFixture = 'sk-live-draft-1234567890'

type FormHandle = {
  owner: SettingsDraftOwner
  apiKeyDraft: string
}

/**
 * 生产同形的模型服务表单：同一个 `apiKeyDraft` state 既喂给 input，也喂给 owner，
 * owner 的 save 走既有 `buildProviderInputFromDraft` + 注入的 platform upsert 端口。
 */
function ModelServiceForm(props: {
  upsert: (input: ModelProviderInput) => Promise<unknown>
  handle: { current: FormHandle | null }
}): React.ReactElement {
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const owner = useMemo(() => createModelServiceSettingsDraftOwner({
    readDraft: () => ({ provider: providerFixture, enabled: true, apiKey: apiKeyDraft }),
    clearApiKeyDraft: () => setApiKeyDraft(''),
    save: (input) => props.upsert(input)
  }), [apiKeyDraft, props.upsert])
  props.handle.current = { owner, apiKeyDraft }
  return (
    <form className="provider-config-form">
      <label className="provider-api-key-input">
        <span>{platformText['en-US'].models.apiKey}</span>
        <input value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} />
      </label>
    </form>
  )
}

async function renderForm(upsert: (input: ModelProviderInput) => Promise<unknown>) {
  const container = document.createElement('div')
  document.body.append(container)
  const handle: { current: FormHandle | null } = { current: null }
  root = createRoot(container)
  await act(async () => {
    root!.render(<ModelServiceForm upsert={upsert} handle={handle} />)
  })
  const input = () => container.querySelector<HTMLInputElement>('.provider-api-key-input input')!
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const owner = () => handle.current!.owner
  return { container, input, type, owner }
}

describe('真实 Settings owner：gate 读的是已有表单草稿', () => {
  it('classifies clean → sensitive-draft from the live input draft, without pre-running save', async () => {
    const upsert = vi.fn(async () => providerFixture)
    const form = await renderForm(upsert)
    const gate = createWorkspaceDraftGate({ resolveOwner: () => createSettingsDraftOwnerPort(form.owner()) })

    expect(form.owner().isDirty()).toBe(false)
    expect(gate.prepare('settings-1')).toEqual({ status: 'ready' })

    await form.type(apiKeyFixture)

    // 关键：草稿来自真实 input 绑定，不是 adapter 自造布尔状态
    expect(form.input().value).toBe(apiKeyFixture)
    expect(form.owner().isDirty()).toBe(true)
    expect(gate.review('settings-1')).toEqual({
      status: 'blocked',
      probe: { status: 'dirty', sensitivity: 'sensitive' }
    })
    const preparation = gate.prepare('settings-1')
    expect(preparation).toEqual({ status: 'handoff-required', reason: 'sensitive-draft' })
    // 不传 key：结论里没有任何草稿正文，也没有自动提交
    expect(JSON.stringify(preparation)).not.toContain(apiKeyFixture)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('reuses the original save callback and passes the existing draft through it', async () => {
    const upsert = vi.fn(async () => providerFixture)
    const form = await renderForm(upsert)
    const gate = createWorkspaceDraftGate({ resolveOwner: () => createSettingsDraftOwnerPort(form.owner()) })
    await form.type(apiKeyFixture)

    const resolution = await gate.resolve('settings-1', 'save')

    expect(resolution).toEqual({ status: 'proceed', resolution: 'saved' })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-local', apiKey: apiKeyFixture }))
    expect(JSON.stringify(resolution)).not.toContain(apiKeyFixture)
  })

  it('keeps the original window and the draft when saving rejects', async () => {
    const upsert = vi.fn(async () => { throw new Error('provider-secret-vault-write-failed') })
    const form = await renderForm(upsert)
    const gate = createWorkspaceDraftGate({ resolveOwner: () => createSettingsDraftOwnerPort(form.owner()) })
    await form.type(apiKeyFixture)

    await expect(gate.resolve('settings-1', 'save')).resolves.toEqual({ status: 'stay', reason: 'save-failed' })
    expect(upsert).toHaveBeenCalledTimes(1)
    // 原窗保留：草稿仍在输入框里，磁盘上也没有新草稿被写入
    expect(form.input().value).toBe(apiKeyFixture)
    expect(form.owner().isDirty()).toBe(true)
  })

  it('cancels without saving, without discarding and without touching the draft', async () => {
    const upsert = vi.fn(async () => providerFixture)
    const form = await renderForm(upsert)
    // 类型之后 owner 才会因 state 变化重建：先输入，再用**当前** owner 走取消
    await form.type(apiKeyFixture)
    const gate = createWorkspaceDraftGate({ resolveOwner: () => createSettingsDraftOwnerPort(form.owner()) })

    await expect(gate.resolve('settings-1', 'cancel')).resolves.toEqual({ status: 'stay', reason: 'cancelled' })
    expect(upsert).not.toHaveBeenCalled()
    // 取消不得丢弃：真实输入框里的草稿原样保留（原窗保留）
    expect(form.input().value).toBe(apiKeyFixture)
    expect(form.owner().isDirty()).toBe(true)
  })

  it('discards through the owner callback and clears the real draft', async () => {
    const upsert = vi.fn(async () => providerFixture)
    const form = await renderForm(upsert)
    const gate = createWorkspaceDraftGate({ resolveOwner: () => createSettingsDraftOwnerPort(form.owner()) })
    await form.type(apiKeyFixture)

    let resolution: Awaited<ReturnType<typeof gate.resolve>> | null = null
    await act(async () => { resolution = await gate.resolve('settings-1', 'discard') })
    expect(resolution).toEqual({ status: 'proceed', resolution: 'discarded' })
    expect(upsert).not.toHaveBeenCalled()
    expect(form.input().value).toBe('')
    expect(form.owner().isDirty()).toBe(false)
  })

  it('batch close finishes every decision first, so cancel closes nothing', async () => {
    const upsert = vi.fn(async () => providerFixture)
    const form = await renderForm(upsert)
    const gate = createWorkspaceDraftGate({ resolveOwner: () => createSettingsDraftOwnerPort(form.owner()) })
    await form.type(apiKeyFixture)

    const closes: string[] = []
    const { runWorkspaceDraftBatch } = await import('../workspace/workspaceDraftGate')
    const result = await runWorkspaceDraftBatch({
      workspaceInstanceKeys: ['settings-1'],
      getOwner: () => createSettingsDraftOwnerPort(form.owner()),
      decide: () => 'cancel'
    })
    if (result.status === 'proceed') closes.push(...result.workspaceInstanceKeys)

    expect(result).toEqual({ status: 'aborted', reason: 'cancelled', blockedKey: 'settings-1' })
    expect(closes).toEqual([])
    expect(upsert).not.toHaveBeenCalled()
    expect(form.input().value).toBe(apiKeyFixture)
    expect(gate.prepare('settings-1')).toEqual({ status: 'handoff-required', reason: 'sensitive-draft' })
  })
})

describe('SettingsDraftPrompt：三态裁决界面不承载草稿正文', () => {
  it('renders paired i18n labels for each reason and reports the chosen decision', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const decisions: SettingsDraftDecision[] = []
    const promptRoot = createRoot(container)
    await act(async () => {
      promptRoot.render(
        <SettingsDraftPrompt language="zh-CN" reason="sensitive-draft" onDecision={(value) => decisions.push(value)} />
      )
    })
    const labels = platformText['zh-CN'].workspace
    expect(container.textContent).toContain(labels.draftGateSensitive)
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    const buttons = Array.from(container.querySelectorAll('button'))
    const byLabel = (label: string) => buttons.find((button) => button.textContent === label)
    expect(byLabel(labels.draftGateSave)).toBeTruthy()
    expect(byLabel(labels.draftGateDiscard)).toBeTruthy()
    expect(byLabel(labels.draftGateCancel)).toBeTruthy()

    await act(async () => { byLabel(labels.draftGateCancel)!.click() })
    await act(async () => { byLabel(labels.draftGateDiscard)!.click() })
    await act(async () => { byLabel(labels.draftGateSave)!.click() })
    expect(decisions).toEqual(['cancel', 'discard', 'save'])
    // 提示框只做裁决，绝不出现输入框（避免在平台 UI 里二次采集凭据）
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => { promptRoot.unmount() })
  })

  it('never echoes draft material into the prompt DOM', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const promptRoot = createRoot(container)
    await act(async () => {
      promptRoot.render(<SettingsDraftPrompt language="en-US" reason="sensitive-draft" onDecision={() => undefined} />)
    })
    expect(container.textContent).not.toContain(apiKeyFixture)
    expect(container.textContent).not.toContain('apiKey')
    await act(async () => { promptRoot.unmount() })
  })

  it('disables the decision buttons while a save is in flight', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const promptRoot = createRoot(container)
    await act(async () => {
      promptRoot.render(
        <SettingsDraftPrompt language="en-US" reason="unsaved-content" pending onDecision={() => undefined} />
      )
    })
    const labels = platformText['en-US'].workspace
    expect(container.textContent).toContain(labels.draftGateUnsaved)
    for (const button of Array.from(container.querySelectorAll('button'))) {
      expect(button.disabled).toBe(true)
    }
    await act(async () => { promptRoot.unmount() })
  })
})

/** 证明 owner 工厂确实复用注入的既有保存回调（而不是自造持久化）。 */
describe('createModelServiceSettingsDraftOwner', () => {
  it('delegates every save to the injected existing callback', async () => {
    let apiKey = ''
    const save = vi.fn(async (_input: ModelProviderInput) => undefined)
    const owner = createModelServiceSettingsDraftOwner({
      readDraft: () => ({ provider: providerFixture, enabled: true, apiKey }),
      clearApiKeyDraft: () => { apiKey = '' },
      save
    })
    expect(owner.isDirty()).toBe(false)
    apiKey = 'typed'
    expect(owner.isDirty()).toBe(true)
    await owner.save()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-local', apiKey: 'typed' }))
    owner.discard()
    expect(owner.isDirty()).toBe(false)
  })

  it('is clean without a provider and still forwards discard/cancel without persisting', async () => {
    let apiKey = 'typed'
    const save = vi.fn(async (_input: ModelProviderInput) => undefined)
    const owner = createModelServiceSettingsDraftOwner({
      readDraft: () => ({ provider: null, enabled: true, apiKey }),
      clearApiKeyDraft: () => { apiKey = '' },
      save
    })
    expect(owner.isDirty()).toBe(false)
    await owner.save()
    expect(save).not.toHaveBeenCalled()
    owner.cancel()
    expect(apiKey).toBe('typed')
  })
})

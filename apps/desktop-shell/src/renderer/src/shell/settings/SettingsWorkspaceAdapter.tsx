import { Button } from 'antd'
import { Save, Trash2, Undo2 } from 'lucide-react'

import { buildProviderInputFromDraft } from '@platform/ai/providers/providerConfigDraft'
import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { WorkspacePreparation } from '@platform/workspace/contracts'

import { platformText } from '../../i18n/platformText'
import { prepareDraftHandoff, type WorkspaceDraftOwnerPort } from '../workspace/workspaceDraftGate'

/**
 * Owner: apps/desktop-shell renderer / settings 草稿 owner 接点（P2-02）。
 * 权威：派发单「从**当前 owner** 注入 isDirty/save/discard/cancel；不重写 ProviderStore 或保存 IPC」、
 * A-T08「敏感草稿保存/丢弃/取消，无泄漏」。
 *
 * 关键性质：
 *  - `isDirty` **读取 owner 已存在的表单草稿**（模型服务设置窗的 API Key 输入框），不是外部布尔开关；
 *  - `save` 只复用注入的既有保存回调（生产 = `window.platform.modelProviders.upsert` 的包装），
 *    本文件既不打开新的 IPC 通道，也不自己写 ProviderStore；
 *  - API Key 是敏感草稿 ⇒ 对平台恒为 `sensitive`：既不带 handoff 数据，也绝不被自动保存；
 *  - 三态提示界面只做裁决：不渲染输入框、不回显草稿正文。
 */

export type SettingsDraftDecision = 'save' | 'discard' | 'cancel'

export type SettingsDraftOwner = {
  /** 读已有表单草稿（真实状态读取）。 */
  isDirty: () => boolean
  /** 复用 owner 原有保存回调；失败必须抛出（调用方据此保留原窗）。 */
  save: () => Promise<void>
  discard: () => void
  cancel: () => void
}

/** 把 owner 接点投影成 `workspaceDraftGate` 的端口：敏感草稿恒为 sensitive，且不携带任何草稿字段。 */
export function createSettingsDraftOwnerPort(owner: SettingsDraftOwner): WorkspaceDraftOwnerPort {
  return Object.freeze({
    probe: () => (owner.isDirty() ? { status: 'dirty', sensitivity: 'sensitive' } as const : { status: 'clean' } as const),
    save: () => owner.save(),
    discard: () => owner.discard()
  })
}

export function prepareSettingsHandoff(owner: SettingsDraftOwner): WorkspacePreparation {
  return prepareDraftHandoff(createSettingsDraftOwnerPort(owner).probe())
}

export type ModelServiceSettingsDraft = {
  provider: SafeModelProvider | null
  enabled: boolean
  apiKey: string
}

/**
 * 模型服务设置窗的草稿 owner（从 AppShell 原地抽取，行为与既有 `persistSelectedProviderDraft` 一致）。
 * 只**绑定**既有草稿状态与既有保存回调，不自造持久化，也不缓存草稿副本。
 */
export function createModelServiceSettingsDraftOwner(input: {
  readDraft: () => ModelServiceSettingsDraft
  /** 显式丢弃：清掉输入框里的草稿（不动已保存的 Provider）。 */
  clearApiKeyDraft: () => void
  /** 注入的既有保存回调（生产由 AppShell 包装 `window.platform.modelProviders.upsert`）。 */
  save: (provider: ModelProviderInput) => Promise<unknown>
}): SettingsDraftOwner {
  return Object.freeze({
    isDirty: () => {
      const draft = input.readDraft()
      return draft.provider !== null && draft.apiKey.trim().length > 0
    },
    async save(): Promise<void> {
      const draft = input.readDraft()
      if (draft.provider === null) return
      await input.save(buildProviderInputFromDraft(draft.provider, { enabled: draft.enabled, apiKey: draft.apiKey }))
    },
    discard: () => input.clearApiKeyDraft(),
    cancel: () => undefined
  })
}

/** 三态裁决提示：保存 / 明确丢弃 / 取消。只出现按钮，绝不出现输入框或草稿正文。 */
export function SettingsDraftPrompt(props: {
  language: AppLanguage
  reason: 'unsaved-content' | 'sensitive-draft'
  pending?: boolean
  onDecision: (decision: SettingsDraftDecision) => void
}): React.ReactElement {
  const labels = platformText[props.language].workspace
  const pending = props.pending === true
  return (
    <div className="workspace-draft-gate-backdrop">
      <section
        className="workspace-draft-gate"
        role="alertdialog"
        aria-label={labels.draftGateTitle}
        data-draft-gate={props.reason}>
        <h1>{labels.draftGateTitle}</h1>
        <p>{props.reason === 'sensitive-draft' ? labels.draftGateSensitive : labels.draftGateUnsaved}</p>
        <p className="workspace-draft-gate-hint">{labels.draftGateHint}</p>
        <div className="workspace-draft-gate-actions">
          <Button type="primary" size="small" disabled={pending} icon={<Save size={14} />}
            onClick={() => props.onDecision('save')}>
            {labels.draftGateSave}
          </Button>
          <Button size="small" disabled={pending} icon={<Trash2 size={14} />}
            onClick={() => props.onDecision('discard')}>
            {labels.draftGateDiscard}
          </Button>
          <Button size="small" disabled={pending} icon={<Undo2 size={14} />}
            onClick={() => props.onDecision('cancel')}>
            {labels.draftGateCancel}
          </Button>
        </div>
      </section>
    </div>
  )
}

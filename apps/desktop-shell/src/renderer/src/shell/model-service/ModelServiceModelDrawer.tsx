import { useEffect, useRef, useState } from 'react'
import {
  AudioLines,
  Boxes,
  Copy,
  Eye,
  Image as ImageIcon,
  Lightbulb,
  ListOrdered,
  MessageSquareText,
  Mic,
  Video,
  Wrench
} from 'lucide-react'
import { Button, Drawer } from 'antd'

import type { ModelChatProtocol } from '@platform/ai/providers/modelProviderTypes'
import { isFreeModel, isFreePricedModel } from '@platform/ai/providers/modelFreeStatus'

import type { PlatformText } from '../../i18n/platformText'
import type { ModelDraft } from '../modelDrafts'
import {
  applyModelTypeCapabilities,
  getSelectedModelTypeCapabilities,
  type ModelTypeCapabilityId
} from '../modelCapabilityDisplay'

const CAPABILITIES: Array<{ id: ModelTypeCapabilityId; label: keyof PlatformText['models']; Icon: typeof Wrench }> = [
  { id: 'chat', label: 'chat', Icon: MessageSquareText },
  { id: 'tools', label: 'tools', Icon: Wrench },
  { id: 'vision', label: 'vision', Icon: Eye },
  { id: 'reasoning', label: 'reasoning', Icon: Lightbulb },
  { id: 'embedding', label: 'embedding', Icon: Boxes },
  { id: 'rerank', label: 'rerank', Icon: ListOrdered },
  { id: 'imageGeneration', label: 'imageGeneration', Icon: ImageIcon },
  { id: 'videoGeneration', label: 'videoGeneration', Icon: Video },
  { id: 'speech', label: 'speech', Icon: AudioLines },
  { id: 'transcription', label: 'transcription', Icon: Mic }
]

/** PLAT-62：模型编辑抽屉（480 宽、88/1fr 栅格、chips + 标准开关）。 */
export function ModelServiceModelDrawer({
  open,
  labels,
  draft,
  isEditing,
  isSaving,
  pinned,
  chatProtocolAvailability = { responses: false, gemini: false, messages: false },
  onChange,
  onTogglePin,
  onSave,
  onClose
}: {
  open: boolean
  labels: PlatformText['models']
  draft: ModelDraft
  isEditing: boolean
  isSaving: boolean
  pinned: boolean
  /** T4/T5/PLAT-69：只有供应商配了对应端点，才允许把模型切到该协议。 */
  chatProtocolAvailability?: { responses: boolean; gemini: boolean; messages: boolean }
  onChange: (draft: ModelDraft) => void
  onTogglePin: () => void
  onSave: () => void
  onClose: () => void
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 价格为 0 时已经是免费：开关只展示，不允许关掉（否则“关了还是免费”，交互会自相矛盾）。
  const priceFree = isFreePricedModel(draft.pricing)
  const freeChecked = isFreeModel(draft)
  const freeLocked = priceFree

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  async function copyId(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(draft.id)
    } catch {
      // 复制失败不影响编辑；不提示错误，避免噪音。
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  function toggleCapability(id: ModelTypeCapabilityId): void {
    const selected = new Set(getSelectedModelTypeCapabilities(draft.capabilities))
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    onChange({
      ...draft,
      capabilities: applyModelTypeCapabilities(draft.capabilities, Array.from(selected))
    })
  }

  return (
    <Drawer
      className="model-drawer"
      title={isEditing ? labels.editModel : labels.addModel}
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      footer={null}>
      <form
        id="model-drawer-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}>
        <div className="model-drawer-grid">
          <span className="model-drawer-label">{labels.modelId}</span>
          <div className="model-drawer-id">
            <input
              className="model-drawer-input model-drawer-input-readonly"
              data-model-id
              value={draft.id}
              readOnly
              aria-label={labels.modelId}
            />
            <button
              type="button"
              className="model-drawer-copy"
              data-model-copy
              title={copied ? labels.copied : labels.copyModelId}
              aria-label={copied ? labels.copied : labels.copyModelId}
              onClick={() => void copyId()}>
              <Copy size={16} />
            </button>
            {copied ? (
              <span className="model-drawer-copied" data-model-copied>
                {labels.copied}
              </span>
            ) : null}
          </div>

          <span className="model-drawer-label">{labels.modelName}</span>
          <input
            className="model-drawer-input"
            data-model-name
            value={draft.name}
            placeholder={labels.modelName}
            aria-label={labels.modelName}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />

          <span className="model-drawer-label">{labels.modelTypeCapabilities}</span>
          <div>
            <div className="model-drawer-chips" role="group" aria-label={labels.modelTypeCapabilities}>
              {CAPABILITIES.map(({ id, label, Icon }) => {
                const checked = draft.capabilities[id] === true
                return (
                  <button
                    key={id}
                    type="button"
                    className={`model-drawer-chip${checked ? ' is-active' : ''}`}
                    data-model-capability={id}
                    aria-pressed={checked}
                    onClick={() => toggleCapability(id)}>
                    <Icon size={12} />
                    <span>{labels[label] as string}</span>
                  </button>
                )
              })}
            </div>
            {!draft.capabilities.chat ? (
              <p className="model-drawer-hint" data-non-chat-hint>
                {labels.nonChatModelHint}
              </p>
            ) : null}
          </div>

          <span className="model-drawer-label">{labels.modelChatProtocol}</span>
          <div>
            <select
              className="model-drawer-input"
              data-model-chat-protocol
              aria-label={labels.modelChatProtocol}
              value={draft.chatProtocol ?? 'chat-completions'}
              onChange={(event) => {
                const next = event.target.value as ModelChatProtocol
                onChange({
                  ...draft,
                  ...{ chatProtocol: next }
                })
              }}>
              <option value="chat-completions">{labels.chatProtocolChatCompletions}</option>
              <option value="responses" disabled={!chatProtocolAvailability.responses}>
                {labels.chatProtocolResponses}
                {chatProtocolAvailability.responses ? '' : ` · ${labels.chatProtocolEndpointMissing}`}
              </option>
              <option value="gemini" disabled={!chatProtocolAvailability.gemini}>
                {labels.chatProtocolGemini}
                {chatProtocolAvailability.gemini ? '' : ` · ${labels.chatProtocolEndpointMissing}`}
              </option>
              <option value="messages" disabled={!chatProtocolAvailability.messages}>
                {labels.chatProtocolMessages}
                {chatProtocolAvailability.messages ? '' : ` · ${labels.chatProtocolEndpointMissing}`}
              </option>
            </select>
            {draft.chatProtocol && draft.chatProtocol !== 'chat-completions' ? (
              <p className="model-drawer-hint" data-chat-protocol-hint>
                {labels.chatProtocolToolHint}
              </p>
            ) : null}
          </div>

          {isEditing ? (
            <>
              <span className="model-drawer-label">{labels.freeModel}</span>
              <div>
                <div className="model-drawer-switch-row">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={freeChecked}
                    aria-label={labels.freeModel}
                    data-model-free
                    disabled={freeLocked}
                    className={`model-drawer-switch${freeChecked ? ' is-on' : ''}`}
                    onClick={() => onChange({
                      ...draft,
                      freeOverride: draft.freeOverride === true ? undefined : true
                    })}
                  />
                </div>
                <p className="model-drawer-hint" data-model-free-hint>
                  {freeLocked ? labels.freeModelAutoHint : labels.freeModelHint}
                </p>
              </div>

              <span className="model-drawer-label">{labels.pinModel}</span>
              <div className="model-drawer-switch-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={pinned}
                  aria-label={labels.pinModel}
                  data-model-pin
                  className={`model-drawer-switch${pinned ? ' is-on' : ''}`}
                  onClick={onTogglePin}
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="model-drawer-footer">
          <Button onClick={onClose}>{labels.cancel}</Button>
          <Button
            className="model-drawer-save"
            type="primary"
            htmlType="submit"
            form="model-drawer-form"
            loading={isSaving}
            disabled={isSaving}>
            {labels.saveModel}
          </Button>
        </div>
      </form>
    </Drawer>
  )
}

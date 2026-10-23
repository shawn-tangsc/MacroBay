import { useEffect, useMemo, useState } from 'react'
import { Input, Modal, Select } from 'antd'

import type { ProviderChatEndpoint, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { resolveProviderChatBase } from '@platform/ai/providers/providerChatEndpoints'
import { createSystemProviderPresets } from '@platform/ai/providers/providerPresets'

import type { PlatformText } from '../../i18n/platformText'
import { resolveProviderDisplayName } from './providerDisplayName'

export type AddProviderInput = {
  name: string
  apiKey?: string
  /** 端点清单（Chat 在前 = 默认端点）；空串 = 未配置地址。 */
  endpoints: ProviderChatEndpoint[]
}

type Props = {
  open: boolean
  labels: PlatformText['models']
  providers: readonly SafeModelProvider[]
  onCancel: () => void
  onAdd: (input: AddProviderInput) => Promise<void>
}

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.length > 0
  } catch {
    return false
  }
}

function previewBase(value: string, suffix: string): string {
  return `${value.trim().replace(/\/+$/, '')}${suffix}`
}

/** PLAT-62：先弹框、填完再创建；取消不产生任何供应商。 */
export function ModelServiceAddProviderDialog({
  open,
  labels,
  providers,
  onCancel,
  onAdd
}: Props): React.ReactElement {
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [messagesBaseUrl, setMessagesBaseUrl] = useState('')
  const [presetId, setPresetId] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const presets = useMemo(() => createSystemProviderPresets(), [])

  useEffect(() => {
    if (!open) return
    setName('')
    setApiKey('')
    setBaseUrl('')
    setMessagesBaseUrl('')
    setPresetId(undefined)
    setSubmitting(false)
  }, [open])

  const trimmedName = name.trim()
  const duplicate = trimmedName.length > 0 && providers.some((provider) =>
    provider.name.toLowerCase() === trimmedName.toLowerCase() ||
    resolveProviderDisplayName(labels, provider).toLowerCase() === trimmedName.toLowerCase()
  )
  const baseInvalid = baseUrl.trim().length > 0 && !validBaseUrl(baseUrl)
  const anthropicInvalid = messagesBaseUrl.trim().length > 0 && !validBaseUrl(messagesBaseUrl)
  const canSubmit =
    trimmedName.length > 0 &&
    validBaseUrl(baseUrl) &&
    !baseInvalid &&
    !anthropicInvalid &&
    !duplicate &&
    !submitting

  async function submit(): Promise<void> {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onAdd({
        name: trimmedName,
        endpoints: [
          { protocol: 'chat-completions', baseUrl: baseUrl.trim() },
          ...(messagesBaseUrl.trim()
            ? [{ protocol: 'messages' as const, baseUrl: messagesBaseUrl.trim() }]
            : [])
        ],
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      })
    } finally {
      setSubmitting(false)
    }
  }

  function pickPreset(id: string): void {
    setPresetId(id)
    const preset = presets.find((entry) => entry.id === id)
    if (!preset) return
    setName(resolveProviderDisplayName(labels, preset))
    // 预填 = 该预设的 Chat / Messages 端点地址（自建供应商只建这两条端点）。
    setBaseUrl(resolveProviderChatBase(preset, 'chat-completions') ?? preset.baseUrl)
    setMessagesBaseUrl(resolveProviderChatBase(preset, 'messages') ?? '')
  }

  return (
    <Modal
      className="model-add-provider-modal"
      title={labels.addProvider}
      open={open}
      centered
      width={520}
      destroyOnHidden
      okText={labels.addProviderAction}
      cancelText={labels.cancel}
      okButtonProps={{ disabled: !canSubmit, loading: submitting, 'data-add-provider-submit': true } as never}
      cancelButtonProps={{ 'data-add-provider-cancel': true } as never}
      onOk={() => void submit()}
      onCancel={onCancel}>
      <div className="model-add-provider-grid" data-add-provider-dialog>
        <label className="model-add-provider-label" htmlFor="add-provider-name">
          {labels.addProviderName} *
        </label>
        <div className="model-add-provider-control">
          <Input
            id="add-provider-name"
            data-add-provider-name
            value={name}
            placeholder={labels.addProviderNamePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
          {duplicate ? (
            <span className="model-add-provider-error" data-add-provider-error role="alert">
              {labels.addProviderDuplicate(trimmedName)}
            </span>
          ) : null}
        </div>

        <label className="model-add-provider-label" htmlFor="add-provider-key">
          {labels.addProviderKey}
        </label>
        <div className="model-add-provider-control">
          <Input.Password
            id="add-provider-key"
            data-add-provider-key
            value={apiKey}
            placeholder={labels.addProviderKeyPlaceholder}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>

        <label className="model-add-provider-label" htmlFor="add-provider-base">
          {labels.addProviderOpenAiBase} *
        </label>
        <div className="model-add-provider-control">
          <Input
            id="add-provider-base"
            data-add-provider-base
            value={baseUrl}
            placeholder={labels.addProviderBasePlaceholder}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          {baseUrl.trim() ? (
            <span className="model-add-provider-preview" data-add-provider-url-preview>
              → {previewBase(baseUrl, '/v1/chat/completions')}
            </span>
          ) : null}
          {baseInvalid ? (
            <span className="model-add-provider-error" role="alert">
              {labels.addProviderInvalidBase}
            </span>
          ) : null}
        </div>

        <label className="model-add-provider-label" htmlFor="add-provider-anthropic">
          {labels.addProviderAnthropicBase}
        </label>
        <div className="model-add-provider-control">
          <Input
            id="add-provider-anthropic"
            data-add-provider-anthropic
            value={messagesBaseUrl}
            placeholder={labels.addProviderBasePlaceholder}
            onChange={(event) => setMessagesBaseUrl(event.target.value)}
          />
          {messagesBaseUrl.trim() ? (
            <span className="model-add-provider-preview" data-add-provider-anthropic-preview>
              → {previewBase(messagesBaseUrl, '/v1/messages')}
            </span>
          ) : null}
          {anthropicInvalid ? (
            <span className="model-add-provider-error" role="alert">
              {labels.addProviderInvalidBase}
            </span>
          ) : null}
        </div>

        <label className="model-add-provider-label" htmlFor="add-provider-preset">
          {labels.addProviderPreset}
        </label>
        <div className="model-add-provider-control">
          <Select
            id="add-provider-preset"
            data-add-provider-preset
            allowClear
            value={presetId}
            placeholder={labels.addProviderPresetPlaceholder}
            options={presets.map((preset) => ({
              value: preset.id,
              label: resolveProviderDisplayName(labels, preset)
            }))}
            onChange={(value?: string) => {
              if (value) pickPreset(value)
            }}
            onClear={() => setPresetId(undefined)}
          />
        </div>
      </div>
    </Modal>
  )
}

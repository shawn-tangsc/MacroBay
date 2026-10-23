import { useState } from 'react'
import { Button, Input, Select } from 'antd'
import { Brush, Upload } from 'lucide-react'

import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { buildGeneratedImageUrl } from '@platform/ui/images/generatedImageUrl'

import type { PlatformText } from '../../../i18n/platformText'
import {
  defaultImageGenerationSize,
  describeImageEditValidationError,
  imageGenerationSizeOptions,
  maxImagePromptLength,
  validateImageEditSourceFile,
  type AssistantImageGenerationView,
  type ImageEditSource,
  type ImageGenerationSize
} from './imageGenerationModel'

type Props = {
  labels: PlatformText['assistants']
  view: AssistantImageGenerationView
  /** 本会话已生成的图片（原图来源①）。 */
  availableImages: readonly AssistantImageMessagePart[]
}

/**
 * T3：composer 里的「编辑图片」入口。
 * 未配置 `imageEndpoints.edit` ⇒ 禁用 + title 说明；
 * 原图来源优先「本会话已生成的图片」，其次上传本地文件（png/jpeg/webp、≤4MB）。
 * 派发后由主进程把结果写成助手图片消息，本组件不碰图片字节。
 */
export function AssistantImageEditControl({ labels, view, availableImages }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<ImageGenerationSize>(defaultImageGenerationSize)
  const [source, setSource] = useState<ImageEditSource | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const disabled = view.editTarget === null

  async function selectFile(file: File | undefined): Promise<void> {
    if (!file) return
    const validation = validateImageEditSourceFile({ size: file.size, type: file.type })
    if (validation) {
      setLocalError(describeImageEditValidationError(validation, labels))
      setSource(null)
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    setLocalError(null)
    setSource({ mime: file.type, bytes })
  }

  async function submit(): Promise<void> {
    if (!source) {
      setLocalError(labels.imageEditSourceRequired)
      return
    }
    const accepted = await view.onEdit({ prompt, size, source })
    if (!accepted) return
    setPrompt('')
    setSource(null)
    setLocalError(null)
    setOpen(false)
  }

  return (
    <div className="assistant-image-generation">
      <Button
        type="text"
        size="small"
        className="assistant-inputbar-tool"
        data-image-edit
        icon={<Brush size={14} />}
        aria-label={labels.imageEdit}
        title={disabled ? labels.imageEditTooltipDisabled : labels.imageEdit}
        disabled={disabled}
        loading={view.isGenerating && open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && !disabled ? (
        <div
          className="assistant-image-generation-panel assistant-image-edit-panel"
          data-image-edit-panel
          role="dialog"
          aria-label={labels.imageEdit}>
          <p className="assistant-image-edit-source-title">{labels.imageEditSourceTitle}</p>
          {availableImages.length > 0 ? (
            <>
              <p className="assistant-image-edit-source-hint">{labels.imageEditSourceSession}</p>
              <div className="assistant-image-edit-sources">
                {availableImages.slice(0, 6).map((image) => {
                  const url = buildGeneratedImageUrl(image.fileName)
                  if (!url) return null
                  const selected = source !== null && 'fileName' in source && source.fileName === image.fileName
                  return (
                    <button
                      key={image.fileName}
                      type="button"
                      className={`assistant-image-edit-source ${selected ? 'selected' : ''}`}
                      data-image-edit-source={image.fileName}
                      aria-pressed={selected}
                      onClick={() => {
                        setLocalError(null)
                        setSource({ fileName: image.fileName })
                      }}>
                      <img src={url} alt={labels.imagePreview} loading="lazy" />
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
          <label className="assistant-image-edit-upload">
            <Upload size={13} aria-hidden="true" />
            <span>{labels.imageEditSourceUpload}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-image-edit-upload
              onChange={(event) => void selectFile(event.target.files?.[0])}
            />
          </label>
          <Input.TextArea
            value={prompt}
            autoSize={{ minRows: 2, maxRows: 3 }}
            maxLength={maxImagePromptLength}
            placeholder={labels.imageEditPromptPlaceholder}
            aria-label={labels.imageEditPromptPlaceholder}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="assistant-image-generation-fields">
            <label className="assistant-image-generation-field">
              <span>{labels.imageSize}</span>
              <span data-image-edit-size>
                <Select
                  size="small"
                  value={size}
                  options={imageGenerationSizeOptions.map((option) => ({ value: option, label: option }))}
                  onChange={(value: ImageGenerationSize) => setSize(value)}
                />
              </span>
            </label>
            <Button
              size="small"
              type="primary"
              data-image-edit-submit
              loading={view.isGenerating}
              onClick={() => void submit()}>
              {labels.imageEditAction}
            </Button>
          </div>
          {localError ?? view.errorText ? (
            <p className="assistant-status-line-error" data-image-edit-error>
              {localError ?? view.errorText}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

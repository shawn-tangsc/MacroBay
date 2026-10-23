import { useState } from 'react'
import { Button, Input, InputNumber, Select } from 'antd'
import { Image as ImageIcon } from 'lucide-react'

import type { PlatformText } from '../../../i18n/platformText'
import {
  defaultImageGenerationSize,
  imageGenerationSizeOptions,
  maxImageGenerationCount,
  maxImagePromptLength,
  type AssistantImageGenerationView,
  type ImageGenerationSize
} from './imageGenerationModel'

type Props = {
  labels: PlatformText['assistants']
  view: AssistantImageGenerationView
}

/**
 * PLAT-63 第二阶段 B：composer 里的「生成图片」入口。
 * 未配置图像端点 ⇒ 禁用 + title 说明；点击展开小面板（prompt 最多 3 行高 / 尺寸 / 数量 1–4）。
 */
export function AssistantImageGenerateControl({ labels, view }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState<ImageGenerationSize>(defaultImageGenerationSize)
  const [count, setCount] = useState(1)
  const disabled = view.target === null

  async function submit(): Promise<void> {
    const accepted = await view.onGenerate({ prompt, size, count })
    if (!accepted) return
    setPrompt('')
    setCount(1)
    setOpen(false)
  }

  return (
    <div className="assistant-image-generation">
      <Button
        type="text"
        size="small"
        className="assistant-inputbar-tool"
        data-image-generate
        icon={<ImageIcon size={14} />}
        aria-label={labels.imageGenerate}
        title={disabled ? labels.imageGenerateTooltipDisabled : labels.imageGenerate}
        disabled={disabled}
        loading={view.isGenerating}
        onClick={() => setOpen((current) => !current)}
      />
      {open && !disabled ? (
        <div className="assistant-image-generation-panel" data-image-panel role="dialog" aria-label={labels.imageGenerate}>
          <Input.TextArea
            value={prompt}
            autoSize={{ minRows: 2, maxRows: 3 }}
            maxLength={maxImagePromptLength}
            placeholder={labels.imagePromptPlaceholder}
            aria-label={labels.imagePromptPlaceholder}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="assistant-image-generation-fields">
            <label className="assistant-image-generation-field">
              <span>{labels.imageSize}</span>
              <span data-image-size>
                <Select
                  size="small"
                  value={size}
                  options={imageGenerationSizeOptions.map((option) => ({ value: option, label: option }))}
                  onChange={(value: ImageGenerationSize) => setSize(value)}
                />
              </span>
            </label>
            <label className="assistant-image-generation-field">
              <span>{labels.imageCount}</span>
              <span data-image-count>
                <InputNumber
                  size="small"
                  min={1}
                  max={maxImageGenerationCount}
                  value={count}
                  onChange={(value) => setCount(typeof value === 'number' ? value : 1)}
                />
              </span>
            </label>
            <Button
              size="small"
              type="primary"
              data-image-submit
              loading={view.isGenerating}
              onClick={() => void submit()}>
              {labels.imageGenerateAction}
            </Button>
          </div>
          {view.errorText ? (
            <p className="assistant-status-line-error" data-image-generation-error>
              {view.errorText}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

import { Image } from 'antd'
import { Download, Send } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { buildGeneratedImageUrl } from '@platform/ui/images/generatedImageUrl'

import type { PlatformText } from '../../../i18n/platformText'
import { buildGeneratedImageFileName } from '../imageGeneration/imageGenerationModel'

type MessageImageCardProps = {
  labels: PlatformText['assistants']
  images: readonly AssistantImageMessagePart[]
  /** 生成时间：决定下载文件名 `generated-{timestamp}.png`。 */
  createdAt: number
  /** 所属助手消息 id：「发到频道」要按「这条消息自己带着这张图」校验来源。 */
  messageId?: string
  /** 同一条消息的正文，作为 caption；超长时整条不发，读者可以改点「只发图片」。 */
  caption?: string
}

type ImageSendOutcome =
  | { kind: 'sent'; channelName: string; bare: boolean }
  | { kind: 'failed'; text: string; captionTooLong: boolean }

type ImageTarget = { channels: readonly { channelName: string; supportsImage: boolean }[] }

/** 成功句里的通道名：多条通道时按投影顺序用顿号-and-comma 拼（逐条措辞归界面设计，第 3 笔）。 */
function targetLabel(target: ImageTarget): string {
  return target.channels.filter((channel) => channel.supportsImage).map((channel) => channel.channelName).join(', ')
}

/**
 * T1：消息里的图片卡片。
 * `src` 是 `app-image://generated-images/<hash>.<ext>`（主进程只读协议），
 * 不是 `data:` 大串 —— 消息体因此可以持久化、可以回看，且重启后地址仍然有效。
 */
export function MessageImageCard({ labels, images, createdAt, messageId, caption }: MessageImageCardProps): React.ReactElement {
  // 投影由主进程给：没有可用通道就不画按钮（不是灰着）。`undefined` = 还没读到。
  const [target, setTarget] = useState<ImageTarget | null | undefined>(undefined)
  const [busyImage, setBusyImage] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, ImageSendOutcome>>({})

  useEffect(() => {
    let alive = true
    const channels = globalThis.window?.platform?.channels
    if (!channels || typeof channels.imageTarget !== 'function') { setTarget(null); return }
    void channels.imageTarget()
      .then((value) => { if (alive) setTarget(value) })
      .catch(() => { if (alive) setTarget(null) })
    return () => { alive = false }
  }, [])

  const send = async (fileName: string, withoutCaption: boolean, target: ImageTarget): Promise<void> => {
    const channels = globalThis.window?.platform?.channels
    if (!channels || !messageId) return
    setBusyImage(fileName)
    try {
      const result = await channels.sendMessageImage({
        messageId,
        fileName,
        ...(withoutCaption ? { withoutCaption: true } : {})
      })
      // 三种结局分开：聚合可能是 sent-accepted / sent-unconfirmed / failed，
      // `ok: true` 只表示「不是全败」，不表示「每条都送达」。
      // 成功句里的通道名只数**真的受理了**的那几条；逐条措辞归界面设计（第 3 笔）。
      const accepted = result.channels
        .filter((channel) => channel.state === 'sent-accepted')
        .map((channel) => channel.channelName ?? '')
        .filter((name) => name.length > 0)
      const outcome: ImageSendOutcome = result.state === 'sent-accepted'
        ? { kind: 'sent', channelName: accepted.length > 0 ? accepted.join(', ') : targetLabel(target), bare: withoutCaption }
        : result.state === 'sent-unconfirmed'
          ? { kind: 'failed', text: labels.imageSendUnconfirmed, captionTooLong: false }
          : { kind: 'failed', text: failureText(result.code, labels), captionTooLong: result.code === 'delivery-caption-too-long' }
      setOutcomes((current) => ({ ...current, [fileName]: outcome }))
    } catch {
      setOutcomes((current) => ({ ...current, [fileName]: { kind: 'failed', text: labels.imageSendFailed, captionTooLong: false } }))
    } finally {
      setBusyImage(null)
    }
  }

  return (
    <div className="assistant-image-grid" data-generated-image-card>
      {images.map((image, index) => {
        const url = buildGeneratedImageUrl(image.fileName)
        const outcome = outcomes[image.fileName]
        if (!url) return null
        return (
          <figure className="assistant-image-card" key={`${image.fileName}:${index}`}>
            <Image
              src={url}
              alt={labels.imagePreview}
              style={{ maxWidth: 320, width: '100%', height: 240, objectFit: 'cover', borderRadius: 8 }}
              preview={{ mask: labels.imagePreview }}
            />
            <a
              className="assistant-image-download"
              data-image-download
              href={url}
              download={buildGeneratedImageFileName(createdAt, image.fileName, index)}
              title={labels.imageDownload}
              aria-label={labels.imageDownload}>
              <Download size={12} aria-hidden="true" />
              {labels.imageDownload}
            </a>
            {target !== null && target !== undefined && target.channels.some((channel) => channel.supportsImage) && messageId ? (
              <span className="assistant-image-send" data-image-send>
                <button
                  className="assistant-image-send-action"
                  data-image-send-action
                  disabled={busyImage !== null}
                  onClick={() => void send(image.fileName, false, target)}
                  type="button">
                  <Send size={12} aria-hidden="true" />
                  {busyImage === image.fileName
                    ? labels.imageSending.replace('{channel}', targetLabel(target))
                    : labels.imageSendToChannel}
                </button>
                {outcome?.kind === 'sent' ? (
                  <span data-image-send-result="sent">
                    {(outcome.bare ? labels.imageSentBare : labels.imageSent).replace('{channel}', outcome.channelName)}
                  </span>
                ) : null}
                {outcome?.kind === 'failed' ? (
                  <span data-image-send-result="failed" role="status">
                    {outcome.text}
                    {outcome.captionTooLong && busyImage === null ? (
                      <button
                        className="assistant-image-send-action"
                        data-image-send-bare
                        disabled={busyImage !== null}
                        onClick={() => void send(image.fileName, true, target)}
                        type="button">
                        {labels.imageSendBare}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </span>
            ) : null}
          </figure>
        )
      })}
    </div>
  )
}

/** 失败的四种可见说法（码只做分发，不上屏）；没归到四类的走一句实话。 */
function failureText(code: string | null, labels: PlatformText['assistants']): string {
  if (code === 'delivery-caption-too-long') return labels.imageSendCaptionTooLong
  if (code === 'delivery-image-too-large') return labels.imageSendTooLarge
  if (code === 'delivery-image-unsupported' || code === 'delivery-image-unavailable' || code === 'delivery-image-source-not-allowed') return labels.imageSendUnsupported
  if (code === 'delivery-host-unavailable' || code === 'delivery-no-target-bound' || code === 'delivery-target-disabled') return labels.imageSendHostUnavailable
  if (code === 'delivery-rate-limited') return labels.imageSendFailed
  return labels.imageSendUnconfirmed
}

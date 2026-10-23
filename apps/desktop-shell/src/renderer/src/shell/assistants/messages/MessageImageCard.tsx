import { Image } from 'antd'
import { Download } from 'lucide-react'

import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { buildGeneratedImageUrl } from '@platform/ui/images/generatedImageUrl'

import type { PlatformText } from '../../../i18n/platformText'
import { buildGeneratedImageFileName } from '../imageGeneration/imageGenerationModel'

type MessageImageCardProps = {
  labels: PlatformText['assistants']
  images: readonly AssistantImageMessagePart[]
  /** 生成时间：决定下载文件名 `generated-{timestamp}.png`。 */
  createdAt: number
}

/**
 * T1：消息里的图片卡片。
 * `src` 是 `app-image://generated-images/<hash>.<ext>`（主进程只读协议），
 * 不是 `data:` 大串 —— 消息体因此可以持久化、可以回看，且重启后地址仍然有效。
 */
export function MessageImageCard({ labels, images, createdAt }: MessageImageCardProps): React.ReactElement {
  return (
    <div className="assistant-image-grid" data-generated-image-card>
      {images.map((image, index) => {
        const url = buildGeneratedImageUrl(image.fileName)
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
          </figure>
        )
      })}
    </div>
  )
}

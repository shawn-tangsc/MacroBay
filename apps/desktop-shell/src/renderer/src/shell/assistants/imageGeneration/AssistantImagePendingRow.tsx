import type { PlatformText } from '../../../i18n/platformText'
import type { PendingImageEntry } from './imageGenerationModel'

type Props = {
  labels: PlatformText['assistants']
  entry: PendingImageEntry | null
}

/**
 * T2：生成/编辑进行中的本地占位。
 * 真正的消息（`status:'pending'` → 图片 part / 错误 part）由主进程落库，
 * 这里只在等待期间给出一条「生成中 / 编辑中」的即时反馈；settle 后立刻消失，
 * 由消息列表里的**同一条**消息接管。
 */
export function AssistantImagePendingRow({ labels, entry }: Props): React.ReactElement | null {
  if (!entry) return null
  return (
    <div className="assistant-generated-images" data-generated-image-list>
      <div className="assistant-message-row assistant-message-row-assistant" data-generated-image-status="pending">
        <article className="assistant-message assistant-message-assistant assistant-message-pending">
          <span className="status-line assistant-image-generation-status">
            {entry.kind === 'edit' ? labels.imageEditGenerating : labels.imageGenerating}
          </span>
        </article>
      </div>
    </div>
  )
}

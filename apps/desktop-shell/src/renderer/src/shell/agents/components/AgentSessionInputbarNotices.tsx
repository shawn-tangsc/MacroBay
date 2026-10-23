import type { AgentAttachedFile } from '../agentMessageInput'
import type { AgentMentionedModel } from '../agentMentionedModels'
import type { AgentText } from '../agentTextTypes'
import AgentAttachmentStrip from './AgentAttachmentStrip'
import AgentMentionedModelsBar from './AgentMentionedModelsBar'

export default function AgentSessionInputbarNotices({
  files,
  mentionedModels,
  sendError,
  pasteError,
  text,
  onRemoveFile,
  onRemoveMentionedModel
}: {
  files: readonly AgentAttachedFile[]
  mentionedModels: readonly AgentMentionedModel[]
  sendError: string | null
  pasteError: string | null
  text: AgentText['input']
  onRemoveFile: (path: string) => void
  onRemoveMentionedModel: (value: string) => void
}): React.ReactElement {
  return (
    <>
      <AgentAttachmentStrip
        files={files}
        readFailedLabel={text.readFailed}
        truncatedLabel={text.truncated}
        removeLabel={text.removeAttachment}
        onRemove={onRemoveFile}
      />
      <AgentMentionedModelsBar
        title={text.mentionedModels}
        models={mentionedModels}
        onRemove={onRemoveMentionedModel}
      />
      {sendError ? (
        <div className="agent-inputbar-error" role="alert">
          {text.sendFailed(sendError)}
        </div>
      ) : null}
      {pasteError ? (
        <div className="agent-inputbar-error" role="alert">
          {pasteError}
        </div>
      ) : null}
    </>
  )
}

import { Button, Input } from 'antd'
import { Send } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'

export type AgentChatComposerLabels = {
  send: string
  sending: string
  stop: string
}

export type AgentChatComposerProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  sending?: boolean
  disabled?: boolean
  placeholder?: string
  ariaLabel: string
  labels: AgentChatComposerLabels
  /** Failure/approval/model hints, rendered above the textarea. */
  notices?: ReactNode
  /** Optional controls (attachments, model picker, task center) rendered under the textarea. */
  toolbar?: ReactNode
  rows?: number
  submitDisabled?: boolean
  /** Replaces the default textarea (the full agent page supplies its own quick-panel input). */
  input?: ReactNode
  /** Replaces the default send/stop row (the full agent page supplies its toolbar). */
  actions?: ReactNode
  formRef?: RefObject<HTMLFormElement | null>
  className?: string
}

/**
 * The compact composer from the intelligence agent panel. The full agent page reuses it with its
 * toolbar slot, so input styling and action placement stay identical on both surfaces.
 */
export function AgentChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  sending = false,
  disabled = false,
  placeholder,
  ariaLabel,
  labels,
  notices,
  toolbar,
  rows = 3,
  submitDisabled,
  input,
  actions,
  formRef,
  className
}: AgentChatComposerProps): React.ReactElement {
  return (
    <form
      ref={formRef}
      className={['agent-chat-composer', className].filter(Boolean).join(' ')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled) onSubmit()
      }}>
      {notices ? <div className="agent-chat-composer__notices">{notices}</div> : null}
      {input ?? (
        <Input.TextArea
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          disabled={disabled || sending}
        />
      )}
      {toolbar ? <div className="agent-chat-composer__toolbar">{toolbar}</div> : null}
      {actions ?? (
        <div className="agent-chat-composer__actions">
          {sending && onStop ? (
            <Button size="small" onClick={onStop}>
              {labels.stop}
            </Button>
          ) : null}
          <Button
            htmlType="submit"
            type="primary"
            icon={<Send size={13} aria-hidden="true" />}
            loading={sending}
            disabled={submitDisabled ?? (disabled || !value.trim())}>
            {sending ? labels.sending : labels.send}
          </Button>
        </div>
      )}
    </form>
  )
}

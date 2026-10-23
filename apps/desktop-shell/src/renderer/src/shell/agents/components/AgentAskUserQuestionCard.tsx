import { useState } from 'react'
import { Input } from 'antd'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'

type AskOption = {
  label: string
  description?: string
}

type AskQuestion = {
  question: string
  header?: string
  multiSelect?: boolean
  options: AskOption[]
}

type ApprovalDecision =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message: string }

type AgentAskUserQuestionCardProps = {
  inputText: string
  labels: {
    title: string
    freeform: string
    skip: string
    submit: string
    recommended: string
  }
  onResolve: (decision: ApprovalDecision) => Promise<void> | void
}

/**
 * A structured question from the AskUserQuestion tool: options are numbered, one question is shown
 * at a time, and the selected labels are returned as the approval's `answers` map.
 */
export default function AgentAskUserQuestionCard({
  inputText,
  labels,
  onResolve
}: AgentAskUserQuestionCardProps): React.ReactElement | null {
  const parsed = parseQuestions(inputText)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [freeform, setFreeform] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!parsed) return null
  const questions = parsed.questions
  const rawInput = parsed.input
  const question = questions[index]
  if (!question) return null
  const selected = answers[question.question] ?? ''
  const selectedLabels = selected ? selected.split(', ') : []
  const isLast = index >= parsed.questions.length - 1

  function choose(label: string): void {
    if (question.multiSelect) {
      const next = selectedLabels.includes(label)
        ? selectedLabels.filter((item) => item !== label)
        : [...selectedLabels, label]
      setAnswers((current) => ({ ...current, [question.question]: next.join(', ') }))
      return
    }
    setAnswers((current) => ({ ...current, [question.question]: label }))
  }

  async function resolve(decision: ApprovalDecision): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await onResolve(decision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function submit(): void {
    const answer = freeform.trim() || selected
    const nextAnswers = answer ? { ...answers, [question.question]: answer } : answers
    void resolve({ behavior: 'allow', updatedInput: { ...rawInput, answers: nextAnswers } })
  }

  return (
    <section className="agent-question-card" aria-label={labels.title}>
      <header className="agent-question-card__header">
        <span>{labels.title}</span>
        <small>{index + 1}/{questions.length}</small>
      </header>
      {question.header ? <small className="agent-question-card__tag">{question.header}</small> : null}
      <h3>{question.question}</h3>
      <div className="agent-question-card__options">
        {question.options.map((option, optionIndex) => {
          const recommended = /\((recommended|推荐)\)/i.test(option.label)
          const label = option.label.replace(/\s*\((recommended|推荐)\)\s*/i, '')
          const active = selectedLabels.includes(option.label) || selectedLabels.includes(label)
          return (
            <button
              key={option.label}
              type="button"
              className={active ? 'agent-question-card__option selected' : 'agent-question-card__option'}
              onClick={() => choose(option.label)}>
              <span className="agent-question-card__number">{optionIndex + 1}</span>
              <span className="agent-question-card__copy">
                <strong>
                  {label}
                  {recommended ? <em>{labels.recommended}</em> : null}
                </strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              {active ? <Check size={14} /> : null}
            </button>
          )
        })}
      </div>
      <Input.TextArea
        className="agent-question-card__input"
        value={freeform}
        autoSize={{ minRows: 1, maxRows: 4 }}
        placeholder={labels.freeform}
        onChange={(event) => setFreeform(event.target.value)}
      />
      {error ? <p className="agent-question-card__error" role="alert">{error}</p> : null}
      <footer className="agent-question-card__footer">
        <div className="agent-question-card__pager">
          <button type="button" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))} aria-label="Previous question">
            <ChevronLeft size={13} />
          </button>
          <button type="button" disabled={isLast} onClick={() => setIndex((current) => Math.min(questions.length - 1, current + 1))} aria-label="Next question">
            <ChevronRight size={13} />
          </button>
        </div>
        <button type="button" className="agent-question-card__skip" disabled={busy} onClick={() => void resolve({ behavior: 'deny', message: 'User skipped the question.' })}>
          {labels.skip}
        </button>
        <button type="button" className="agent-question-card__submit" disabled={busy} onClick={submit}>
          {busy ? '…' : labels.submit}
        </button>
      </footer>
    </section>
  )
}

function parseQuestions(inputText: string): { input: Record<string, unknown>; questions: AskQuestion[] } | null {
  try {
    const input = JSON.parse(inputText) as Record<string, unknown>
    const questions = input.questions
    if (!Array.isArray(questions) || questions.length === 0) return null
    const normalized = questions.flatMap((value): AskQuestion[] => {
      if (!value || typeof value !== 'object') return []
      const record = value as Record<string, unknown>
      if (typeof record.question !== 'string' || !Array.isArray(record.options)) return []
      const options = record.options.flatMap((option): AskOption[] => {
        if (!option || typeof option !== 'object') return []
        const entry = option as Record<string, unknown>
        if (typeof entry.label !== 'string') return []
        return [{ label: entry.label, description: typeof entry.description === 'string' ? entry.description : undefined }]
      })
      if (options.length === 0) return []
      return [{
        question: record.question,
        header: typeof record.header === 'string' ? record.header : undefined,
        multiSelect: record.multiSelect === true,
        options
      }]
    })
    return normalized.length > 0 ? { input, questions: normalized } : null
  } catch {
    return null
  }
}

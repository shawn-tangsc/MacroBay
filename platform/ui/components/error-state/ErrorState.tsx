import { CircleHelp, TriangleAlert } from 'lucide-react'
import type { ReactElement } from 'react'

import type { StateLayout, StateSize } from '../empty-state'

/**
 * 错态与「未知」的唯一组件（B0 契约：`ui-state-components-contract.md` §2、§5）。
 *
 * 与空态刻意分开：空是「确实没有」，错是「知道为什么」，未知是「拿不到且说不清」。
 * 三者写成一句话就会撒谎——「暂无」是最常见的撒谎方式。
 *
 * 组件内**零文案、零 i18n**：`title` / `description` / `unclearReason` / `recovery.label`
 * 全部由调用方给。`variant: 'unknown'` 不是可选分支：它必须带 `unclearReason`，
 * 而且 `recovery` 只接受 `retry`——这是类型层面的约束，不是评审时的提醒。
 */
export type ErrorRecovery =
  | { kind: 'retry'; label: string; onRetry: () => void }
  | { kind: 'alternative'; label: string; onGo: () => void }
  | { kind: 'none'; reason: string }

type ErrorStateBaseProps = {
  title: string
  /** 影响范围：数据是否还在、是不是旧数据、会不会自动恢复。 */
  description?: string
  /** 排障详情，默认折叠；展开后才看得到完整正文。 */
  details?: { summary: string; body: string }
  size?: StateSize
  layout?: StateLayout
  className?: string
}

export type ErrorStateProps =
  | (ErrorStateBaseProps & { variant?: 'error'; recovery: ErrorRecovery })
  | (ErrorStateBaseProps & {
      variant: 'unknown'
      /** 为什么说不清。必填，不许留空。 */
      unclearReason: string
      recovery: Extract<ErrorRecovery, { kind: 'retry' }>
    })

export function ErrorState(props: ErrorStateProps): ReactElement {
  const unknown = props.variant === 'unknown'
  const size = props.size ?? 'md'
  const layout = props.layout ?? 'block'
  const className = props.className

  return (
    <section
      className={className ? `error-state ${className}` : 'error-state'}
      data-size={size}
      data-layout={layout}
      data-variant={unknown ? 'unknown' : 'error'}
      role="alert">
      {unknown ? <CircleHelp size={17} aria-hidden="true" /> : <TriangleAlert size={17} aria-hidden="true" />}
      <strong>{props.title}</strong>
      {props.description ? <span>{props.description}</span> : null}
      {unknown ? <span data-error-state-unclear>{props.unclearReason}</span> : null}
      {props.details ? (
        <details>
          <summary>{props.details.summary}</summary>
          <p>{props.details.body}</p>
        </details>
      ) : null}
      {props.recovery.kind === 'none' ? (
        <span data-error-state-no-recovery>{props.recovery.reason}</span>
      ) : (
        <button
          type="button"
          className="error-state-action"
          onClick={props.recovery.kind === 'retry' ? props.recovery.onRetry : props.recovery.onGo}>
          {props.recovery.label}
        </button>
      )}
    </section>
  )
}

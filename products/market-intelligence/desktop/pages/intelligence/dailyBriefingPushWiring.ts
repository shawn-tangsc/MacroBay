import { useCallback, useEffect, useRef, useState } from 'react'

import { redeliverBriefingPush, type BriefingPushEdition, type BriefingPushFailure } from './dailyBriefingPushClient'

/**
 * The button's state machine, kept out of the page and out of the component.
 *
 * Everything a reader can do wrong here is a click: one while it is already sending, one on an edition that
 * was regenerated a moment ago, one when the channel is paused. This module owns the first (a send is a
 * transition out of `idle`/`failed`, and `sending` accepts none), reports the rest as sentences, and keeps
 * the two success forms apart — "handed to the channel" and "no receipt came back" are not the same claim.
 *
 * The component that draws it takes `state` and two callbacks; it never touches the transport. That keeps
 * one place that talks to the platform, which is where the dedupe and the reason codes also live.
 */

export type BriefingPushState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'sending' }>
  /** `receipt` decides which of the two sentences is shown, and how long it stays. */
  | Readonly<{ kind: 'sent'; receipt: 'accepted' | 'unconfirmed' }>
  | Readonly<{ kind: 'failed'; reason: BriefingPushFailure }>
  | Readonly<{ kind: 'disabled'; reason: BriefingPushDisabledReason }>

export type BriefingPushDisabledReason = 'generating' | 'no-edition' | 'missing-locale' | 'capability'

/** How long each success sentence stays. The unconfirmed one is weaker and needs longer to be read. */
export const briefingPushToastMs = Object.freeze({ accepted: 3_000, unconfirmed: 6_000 })

export function useBriefingPush(input: Readonly<{
  edition: BriefingPushEdition | undefined
  /** Stated by the page, which knows why there is no edition or why this build cannot send. */
  blocked?: BriefingPushDisabledReason
  send?: (edition: BriefingPushEdition) => Promise<Awaited<ReturnType<typeof redeliverBriefingPush>>>
}>): Readonly<{
  state: BriefingPushState
  /** The success sentence currently on screen, cleared by its own timer. */
  toast: 'accepted' | 'unconfirmed' | undefined
  push: () => void
  retry: () => void
  dismissFailure: () => void
}> {
  const [sendState, setSendState] = useState<BriefingPushState>({ kind: 'idle' })
  const [toast, setToast] = useState<'accepted' | 'unconfirmed' | undefined>(undefined)
  const sending = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
  }, [])

  const state: BriefingPushState = input.blocked
    ? { kind: 'disabled', reason: input.blocked }
    : sendState

  const send = useCallback(async (): Promise<void> => {
    // A click while a send is in flight is dropped here, not disabled only in the view: a slow network is
    // exactly when a reader taps twice, and the phone must not receive the same edition twice.
    if (sending.current || !input.edition || input.blocked) return
    sending.current = true
    setSendState({ kind: 'sending' })
    try {
      const outcome = await (input.send ?? redeliverBriefingPush)(input.edition)
      if (outcome.state === 'sent') {
        setSendState({ kind: 'sent', receipt: outcome.delivery === 'sent-accepted' ? 'accepted' : 'unconfirmed' })
        const which = outcome.delivery === 'sent-accepted' ? 'accepted' : 'unconfirmed'
        setToast(which)
        if (timer.current !== undefined) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          setToast(undefined)
          // The button returns to its label: the success is about this action, not a standing state.
          setSendState({ kind: 'idle' })
        }, briefingPushToastMs[which])
      } else {
        // A failure stays on screen with a reason and a retry; a toast alone would be gone in seconds.
        setSendState({ kind: 'failed', reason: outcome.reason })
      }
    } finally {
      sending.current = false
    }
  }, [input])

  const push = useCallback(() => { void send() }, [send])
  const retry = useCallback(() => {
    setSendState({ kind: 'idle' })
    void send()
  }, [send])
  const dismissFailure = useCallback(() => setSendState({ kind: 'idle' }), [])

  return { state, toast, push, retry, dismissFailure }
}

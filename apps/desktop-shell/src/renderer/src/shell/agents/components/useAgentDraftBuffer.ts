import { useEffect, useRef, useState } from 'react'

export type AgentDraftBuffer = {
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  /** Read by handlers that fire before React re-renders (keyboard shortcuts, quick panels). */
  draftRef: React.RefObject<string>
}

/**
 * The composer's draft, remembered across mounts. The key decides which surface owns it: the
 * agent page keeps one buffer per agent, while an embedded conversation keys it per session so
 * two mounted composers never type into each other.
 */
export function useAgentDraftBuffer(storageKey: string): AgentDraftBuffer {
  const [draft, setDraft] = useState(() => window.localStorage.getItem(storageKey) ?? '')
  const draftRef = useRef(draft)

  useEffect(() => {
    setDraft(window.localStorage.getItem(storageKey) ?? '')
  }, [storageKey])

  useEffect(() => {
    draftRef.current = draft
    if (draft) window.localStorage.setItem(storageKey, draft)
    else window.localStorage.removeItem(storageKey)
  }, [draft, storageKey])

  return { draft, setDraft, draftRef }
}

export type ApprovalInputDraftResolution =
  | {
      kind: 'original'
    }
  | {
      kind: 'updated'
      updatedInput: unknown
    }
  | {
      kind: 'invalid'
    }

export function resolveApprovalInputDraft(
  originalInputText: string,
  draftInputText: string
): ApprovalInputDraftResolution {
  const normalizedDraft = draftInputText.trim()
  if (!normalizedDraft || normalizedDraft === originalInputText.trim()) {
    return { kind: 'original' }
  }

  try {
    return {
      kind: 'updated',
      updatedInput: JSON.parse(normalizedDraft)
    }
  } catch {
    return { kind: 'invalid' }
  }
}

export function serializeApprovalInput(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value, null, 2)
    return typeof serialized === 'string' ? serialized : null
  } catch {
    return null
  }
}

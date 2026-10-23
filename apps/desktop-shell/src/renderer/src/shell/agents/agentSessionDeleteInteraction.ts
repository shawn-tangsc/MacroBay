export type SessionDeleteClickIntent = 'confirm' | 'delete'

export function getSessionDeleteClickIntent(input: {
  confirming: boolean
  modifierPressed: boolean
}): SessionDeleteClickIntent {
  return input.confirming || input.modifierPressed ? 'delete' : 'confirm'
}

export function applyAgentSlashCommandInsertion(input: {
  text: string
  selectionStart: number
  selectionEnd: number
  insertion: string
}): { text: string; caret: number } {
  const prefix = input.text.slice(0, input.selectionStart)
  const suffix = input.text.slice(input.selectionEnd)
  const lastSlashIndex = prefix.lastIndexOf('/')

  if (lastSlashIndex >= 0 && input.selectionStart > lastSlashIndex) {
    const nextText = input.text.slice(0, lastSlashIndex) + input.insertion + suffix
    return {
      text: nextText,
      caret: lastSlashIndex + input.insertion.length
    }
  }

  const nextText = prefix + input.insertion + suffix
  return {
    text: nextText,
    caret: input.selectionStart + input.insertion.length
  }
}

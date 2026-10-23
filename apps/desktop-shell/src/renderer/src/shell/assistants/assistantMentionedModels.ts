export type AssistantMentionedModel = {
  value: string
  label: string
  providerId: string
  modelId: string
}

export function toggleAssistantMentionedModel(
  current: readonly AssistantMentionedModel[],
  model: AssistantMentionedModel
): AssistantMentionedModel[] {
  const exists = current.some((item) => item.value === model.value)
  if (exists) return current.filter((item) => item.value !== model.value)
  return [...current, model]
}

export function assistantMentionedModelIds(models: readonly AssistantMentionedModel[]): string[] {
  return models.map((item) => item.value)
}

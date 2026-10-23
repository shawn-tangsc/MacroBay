type TopicReference = { id: string }

export function selectTopicAfterDeletion(
  previousTopics: readonly TopicReference[],
  remainingTopics: readonly TopicReference[],
  deletedTopicId: string
): string | null {
  if (remainingTopics.length === 0) return null
  const deletedIndex = previousTopics.findIndex((topic) => topic.id === deletedTopicId)
  const nextTopic = previousTopics.slice(deletedIndex + 1).find((topic) =>
    remainingTopics.some((remaining) => remaining.id === topic.id)
  )
  if (nextTopic) return nextTopic.id

  const previousTopic = previousTopics
    .slice(0, Math.max(deletedIndex, 0))
    .reverse()
    .find((topic) => remainingTopics.some((remaining) => remaining.id === topic.id))
  return previousTopic?.id ?? remainingTopics[0]?.id ?? null
}

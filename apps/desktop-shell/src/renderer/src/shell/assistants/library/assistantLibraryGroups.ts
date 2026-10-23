import { Settings, type LucideIcon } from 'lucide-react'
import type { AssistantTemplateGroupId } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'

export type AssistantLibraryGroupDefinition = {
  id: AssistantTemplateGroupId
  icon: LucideIcon
}

export const assistantLibraryGroups: readonly AssistantLibraryGroupDefinition[] = [
  { id: 'general', icon: Settings }
]

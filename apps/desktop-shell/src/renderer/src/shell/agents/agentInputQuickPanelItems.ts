import type { AgentText } from './agentTextTypes'
import type { AgentQuickPanelItem } from './agentQuickPanel'

type SlashCommandItem = {
  command: string
  description: string
}

type BuildAgentInputQuickPanelItemsInput = {
  text: AgentText
  expanded: boolean
  slashCommands: readonly SlashCommandItem[]
}

export function buildAgentInputQuickPanelItems(
  input: BuildAgentInputQuickPanelItemsInput
): AgentQuickPanelItem[] {
  const commands = input.slashCommands.map<AgentQuickPanelItem>((item) => ({
    id: `command:${item.command}`,
    label: item.command,
    description: item.description,
    keywords: [input.text.input.commands],
    group: 'commands'
  }))

  const actions: AgentQuickPanelItem[] = [
    {
      id: 'action:tools',
      label: input.text.input.tools,
      description: input.text.input.quickActionToolsDescription,
      keywords: ['tool'],
      group: 'actions'
    },
    {
      id: 'action:attachment',
      label: input.text.input.attachment,
      description: input.text.input.quickActionAttachmentDescription,
      keywords: ['file', 'upload'],
      group: 'actions'
    },
    {
      id: 'action:mention',
      label: input.text.input.mentionModel,
      description: input.text.input.quickActionMentionDescription,
      keywords: ['mention', '@'],
      group: 'actions'
    },
    {
      id: 'action:expand',
      label: input.expanded ? input.text.input.collapse : input.text.input.expand,
      description: input.expanded
        ? input.text.input.quickActionCollapseDescription
        : input.text.input.quickActionExpandDescription,
      keywords: ['input', 'size'],
      group: 'actions'
    },
    {
      id: 'action:clear',
      label: input.text.chatNavbar.clearMessages,
      description: input.text.input.quickActionClearDescription,
      keywords: ['delete', 'session'],
      group: 'actions'
    }
  ]

  return [...commands, ...actions]
}

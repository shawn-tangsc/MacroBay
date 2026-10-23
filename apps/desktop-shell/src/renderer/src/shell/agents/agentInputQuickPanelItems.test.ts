import { describe, expect, it } from 'vitest'

import type { AgentText } from './agentTextTypes'
import { buildAgentInputQuickPanelItems } from './agentInputQuickPanelItems'

describe('buildAgentInputQuickPanelItems', () => {
  it('does not expose prompt-text workspace insertion actions', () => {
    const items = buildAgentInputQuickPanelItems({
      text: textFixture,
      expanded: false,
      slashCommands: []
    })

    expect(items.map((item) => item.id)).not.toContain('action:terminal-context')
    expect(items.map((item) => item.id)).not.toContain('action:workspace')
  })
})

const textFixture = {
  input: {
    tools: 'Tools',
    commands: 'Commands',
    attachment: 'Attachment',
    mentionModel: 'Mention model',
    expand: 'Expand',
    collapse: 'Collapse',
    quickActionToolsDescription: 'Open tool toggles',
    quickActionAttachmentDescription: 'Attach files',
    quickActionMentionDescription: 'Mention models',
    quickActionClearDescription: 'Clear messages',
    quickActionExpandDescription: 'Expand input',
    quickActionCollapseDescription: 'Collapse input'
  },
  chatNavbar: {
    clearMessages: 'Clear messages',
    openInExternalApp: (name) => `Open in ${name}`,
    openInExternalAppMenu: 'Choose external editor'
  }
} as AgentText

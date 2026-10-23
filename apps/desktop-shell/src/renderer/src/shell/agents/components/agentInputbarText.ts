import type { AgentText } from '../agentTextTypes'

/** Text adapters for the composer's model-mention panel and footer. */
export function mentionModelText(t: AgentText) {
  return {
    clearMentionedModels: t.input.clearMentionedModels,
    clearMentionedModelsDescription: t.input.clearMentionedModelsDescription,
    openModelService: t.input.openModelService,
    openModelServiceDescription: t.input.openModelServiceDescription,
    pinnedSectionLabel: t.input.pinnedSectionLabel
  }
}

export function inputbarFooterLabels(t: AgentText) {
  return {
    mentionModel: t.input.mentionModel,
    attachment: t.input.attachment,
    availableTools: t.input.availableTools,
    mcpSkillsManagedInConfig: t.input.mcpSkillsManagedInConfig,
    approval: t.input.approval,
    tools: t.input.tools,
    commands: t.input.commands,
    collapse: t.input.collapse,
    expand: t.input.expand,
    stop: t.input.stop,
    send: t.input.send,
    removeAttachment: t.input.removeAttachment
  }
}

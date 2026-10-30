import type { AgentPermissionMode } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { JobLogLevel, JobStatus } from '@platform/jobs'

export type AgentTextWorkbench = {
  todos: {
    title: string
    completedSummary: (completed: number, total: number, workspace: string) => string
    workspaceBound: string
    systemWorkspace: string
    modelSelected: (model: string) => string
    selectModel: string
    userTaskReceived: string
    waitingUserTask: string
    agentResponding: string
    responseNeedsErrorHandling: string
    agentResponseCompleted: string
    waitingAgentResponse: string
  }
  taskCenter: {
    title: string
    refresh: string
    newTask: string
    taskList: string
    taskCount: (count: number) => string
    loading: string
    empty: string
    overdue: string
    editTask: string
    createTask: string
    formDescription: string
    reset: string
    saveTask: string
    name: string
    namePlaceholder: string
    trigger: string
    triggerInterval: string
    triggerOnce: string
    triggerCron: string
    triggerOnceSummary: (value: string) => string
    triggerCronSummary: (expr: string, timezone?: string) => string
    triggerIntervalSummary: (value: string) => string
    intervalMinutes: string
    onceAt: string
    onceAtPlaceholder: string
    cronExpr: string
    cronExprPlaceholder: string
    timezone: string
    timezonePlaceholder: string
    timeoutMinutes: string
    workspace: string
    systemWorkspace: string
    enabled: string
    enabledDescription: string
    channels: string
    channelsPlaceholder: string
    channelReadiness: string
    channelReady: string
    channelInactive: string
    channelNoActiveChat: string
    prompt: string
    promptPlaceholder: string
    runLogs: string
    noRunOutput: string
    schedulePreview: string
    scheduleInvalid: string
    timezoneInvalid: string
    paused: string
    completedTask: string
    pauseReasonUser: string
    pauseReasonFailureCircuit: string
    revisionConflict: string
    runNow: string
    cancelRun: string
    deleteTask: string
    noLogs: string
    loadMoreRuns: string
    openSession: string
    deliverySummary: (delivered: number, failed: number, skipped: number, unknown: number) => string
    deliveryAttempts: string
    noDeliveryAttempts: string
    loadMoreDeliveryAttempts: string
    retryDelivery: string
    retryDeliveryFailed: string
    deliveryAttempt: (channelId: string, attemptNumber: number) => string
    deliveryStatus: Record<'pending' | 'delivered' | 'failed' | 'skipped-no-active-target' | 'skipped-channel-inactive' | 'unknown-after-restart' | 'unknown-after-send', string>
    loadFailed: string
    saveFailed: string
    deleteFailed: string
    runFailed: string
    cancelFailed: string
    confirmDelete: (name: string) => string
    validation: Record<
      'name-required' | 'prompt-required' | 'interval-invalid' | 'once-at-invalid' | 'cron-required' | 'timeout-invalid',
      string
    >
    status: Record<TaskRunLogEntity['status'], string>
    jobStatus: Record<JobStatus, string>
    jobLogLevel: Record<JobLogLevel, string>
    jobLogEntry: (time: string, level: string, message: string) => string
  }
  editor: {
    titleCreate: string
    titleConfig: string
    deleteAgent: string
    confirmDeleteAgent: (name: string) => string
    sections: {
      basic: { label: string; desc: string }
      prompt: { label: string; desc: string }
      permission: { label: string; desc: string }
      tools: { label: string; desc: string }
      advanced: { label: string; desc: string }
    }
    basic: {
      title: string
      description: string
      avatar: string
      name: string
      namePlaceholder: string
      mainModel: string
      planModel: string
      smallModel: string
      selectModel: string
      optional: string
      soulMode: string
      soulModeDescription: string
      heartbeat: string
      heartbeatDescription: string
      heartbeatInterval: string
      agentDescription: string
      agentDescriptionPlaceholder: string
    }
    prompt: {
      title: string
      description: string
      systemInstructions: string
      placeholder: string
    }
    permission: {
      title: string
      description: string
      executionPermission: string
    }
    tools: {
      title: string
      description: string
      searchPlaceholder: string
      builtinTab: (enabled: number, total: number) => string
      mcpTab: (count: number) => string
      skillsTab: (count: number) => string
      productPackagesTab: string
      saveAgentBeforeProductToolsTitle: string
      saveAgentBeforeProductToolsDescription: string
      noProductToolPackagesTitle: string
      noProductToolPackagesDescription: string
      productToolPermissionDisabled: string
      productToolPermissionAllowReadOnly: string
      productToolPermissionPrompt: string
      productToolPermissionLabel: string
      productToolStatusAvailable: string
      productToolStatusMissingHandler: string
      productToolStatusNotInstalled: string
      productToolSummary: (total: number, readOnly: number, writable: number, asOf: number) => string
      productToolDisabledNote: string
      productToolColumnTool: string
      productToolColumnType: string
      productToolColumnAsOf: string
      productToolExpand: (count: number) => string
      productToolCollapse: string
      staleProductToolBinding: string
      readOnlyBadge: string
      writableBadge: string
      requiresAsOfBadge: string
      saveAgentBeforeSkillTitle: string
      saveAgentBeforeSkillDescription: string
      enabledHeading: string
      noEnabledBuiltinTools: string
      addableHeading: string
      noMoreAddableTools: string
      approvalPromptBadge: string
      approvalAutoBadge: string
      mcpPlaceholder: string
      mcpManualCustomDescription: string
      mcpManualBadge: string
      mcpManualEmpty: string
      mcpManualDuplicate: (id: string) => string
      mcpManualAdded: (id: string) => string
      mcpRegistryHeading: string
      mcpManualHeading: string
      mcpConnected: string
      mcpConnecting: string
      mcpError: string
      mcpDisabled: string
      mcpActionOpenUrl: string
      mcpActionRestart: string
      mcpActionOpenSettings: string
      mcpActionCopyHint: string
      mcpActionRetry: string
      mcpActionCopied: string
      refreshMcpTools: string
      refreshSkills: string
      skillRuntimeEmptySummary: string
      skillRuntimeUnavailable: string
      skillCredentialHint: string
      openSkillMarketplace: string
      marketplaceTitle: string
      marketplaceSearchPlaceholder: string
      searchMarketplace: string
      marketplaceEmptyTitle: string
      marketplaceEmptyDescription: string
      openSkillSource: string
      installSkill: string
      skillInstalled: string
      installSkillFromZip: string
      installSkillFromDirectory: string
      viewSkillDetail: string
      skillRuntimeToolCount: (count: number) => string
      skillRuntimeCapabilityCount: (count: number) => string
      skillDetailTitle: string
      skillRuntimeTools: string
      skillRuntimeCapabilities: string
      skillFiles: string
      loadingSkillFiles: string
      noSkillFiles: string
      loadingSkillFile: string
      selectSkillFile: string
      selectSkillFileDescription: string
      noSkillRuntimeTools: string
      noSkillRuntimeCapabilities: string
      skillBodyPreviewTruncated: string
      uninstallSkill: string
      boundHeading: string
      noMcpTitle: string
      noMcpDescription: string
      noMcpRegistryTitle: string
      noMcpRegistryDescription: string
      noSkillTitle: string
      noSkillDescription: string
    }
    advanced: {
      title: string
      description: string
      maxTurns: string
      envVars: string
    }
  }
  permissionMode: Record<AgentPermissionMode, string>
}

import type {
  AgentChannelRuntimeCredentialState,
  AgentChannelRuntimeLifecycleState,
  AgentChannelRuntimeSessionState
} from '@platform/ai/agent-platform/channels/channelRuntimeHost'
import type { MessageStatus } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { ToolApproval } from '@platform/ai/agent-platform/schemas/toolSchemas'
import type { ConfiguredModelUnavailableReason } from '@platform/ai/model-defaults/configuredDefaultModel'
import type { ChatMessageNavigation, ChatMessageStyle } from '@platform/settings/schema/appSettings'

import type { AgentTextWorkbench } from './agentTextWorkbenchTypes'

export type AgentText = {
  common: {
    agent: string
    noSession: string
    cancel: string
    save: string
    add: string
    remove: string
    enabled: string
    available: string
    pinned: string
    recent: string
    noDescription: string
    systemWorkspace: string
  }
  navbar: {
    hideSidebar: string
    showSidebar: string
    openSessions: string
    search: string
    createAgent: string
    agentSettings: string
  }
  sidePanel: {
    navigationTabs: string
    agentsTab: string
    sessionsTab: string
    newSession: string
    defaultSessionName: string
    clearFilteredSessions: string
    confirmDeleteFilteredSessions: (count: number) => string
    searchSessions: string
    sessionCount: (count: number) => string
    emptyAgents: string
    agentSessionCount: (count: number) => string
    emptySessions: string
  }
  sessionItem: {
    rename: string
    pin: string
    unpin: string
    delete: string
    deleteShortcut: string
    more: string
    moreAria: string
    panelPosition: string
    panelPositionLeft: string
    panelPositionRight: string
    status: {
      pending: string
      done: string
      error: string
      paused: string
    }
    confirmDeleteSession: (name: string) => string
    channelRuntime: {
      title: string
      lifecycle: string
      credential: string
      session: string
      hint: string
      message: string
      retry: string
      url: string
      qr: string
      retryable: string
      notRetryable: string
      expiresAt: (value: string) => string
      lastCheckedAt: (value: string) => string
      status: Record<'connected' | 'connecting' | 'error' | 'inactive', string>
      lifecycleState: Record<AgentChannelRuntimeLifecycleState, string>
      credentialState: Record<AgentChannelRuntimeCredentialState, string>
      sessionState: Record<AgentChannelRuntimeSessionState, string>
    }
  }
  chat: {
    modelServiceUnavailableTitle: string
    loadingModelServiceTitle: string
    loadingModelServiceDescription: string
    modelServiceUnavailableDescription: string
    modelServiceUnavailableReasons: Record<ConfiguredModelUnavailableReason, string>
    openModelService: string
    ordinaryChatOnlyTitle: string
    ordinaryChatOnlyDescription: string
    directAuthFailedTitle: string
    directAuthFailedDescription: string
    runtimeUnverifiedTitle: string
    runtimeUnverifiedDescription: string
    gatewayRequiredTitle: string
    gatewayRequiredDescription: string
    gatewayStoppedTitle: string
    gatewayStoppedDescription: string
    noAgentTitle: string
    noAgentDescription: string
    noSessionTitle: string
    noSessionDescription: string
    orphanTitle: string
    orphanDescription: string
    openAgentConfig: string
  }
  gatewayStatus: {
    title: string
    requiredTitle: string
    requiredDescription: string
    currentModel: (name: string) => string
    enableAndStart: string
    startingButton: string
    openModelService: string
    localOnly: string
    enable: string
    disable: string
    start: string
    stop: string
    state: Record<'disabled' | 'starting' | 'running' | 'stopped' | 'error', string>
    description: Record<'disabled' | 'starting' | 'running' | 'stopped' | 'error', string>
  }
  chatNavbar: {
    selectLocalDirectory: string
    selectModel: string
    openWorkspace: string
    openInExternalApp: (name: string) => string
    openInExternalAppMenu: string
    clearMessages: string
    taskCenter: string
    chatSettings: string
    agentConfig: string
    confirmClearMessages: (name: string) => string
    /** PLAT-70：下拉里的三态文案。 */
  }
  search: {
    title: string
    placeholder: string
    empty: string
    unboundAgent: string
  }
  settingsDrawer: {
    title: string
    sessionName: string
    boundAgent: string
    permissionMode: string
    soulMode: string
    soulModeDescription: string
    heartbeat: string
    heartbeatDescription: string
    messageStyle: string
    messageNavigation: string
    narrowMode: string
    fontSize: string
    sendShortcut: string
    confirmDeleteMessage: string
    confirmDeleteMessageDescription: string
    useCurrentAgent: string
    channelRuntime: {
      title: string
      empty: string
      restart: string
      openCredentialUrl: string
      expiresAt: string
      activeChats: (count: number) => string
      updatedAt: (value: string) => string
      boundChannels: (count: number) => string
    }
  }
  messageStyle: Record<ChatMessageStyle, string>
  messageNavigation: Record<ChatMessageNavigation, string>
  messages: {
    emptyTitle: string
    emptyDescription: string
    userAvatar: string
    userName: string
    copy: string
    quote: string
    copyAria: string
    resend: string
    resendAria: string
    delete: string
    deleteAria: string
    confirmDeleteMessage: string
    loadOlder: string
    navigateTop: string
    navigatePrevious: string
    navigateNext: string
    navigateBottom: string
    anchorRailAria: string
    nonTextContent: string
    tokenUsage: (total: string) => string
    tokenUsageBreakdown: (input: string, output: string) => string
    tokenUsageAria: string
    status: Record<MessageStatus, string>
  }
  runtimeText: {
    connecting: string
    waitingModel: string
    thinking: string
    usingTools: string
    generating: string
    stopped: string
    providerConfigurationRequired: string
    providerRequestFailed: string
    /** PLAT-74：模型生命周期结论（已下线 / 未开通 / 不存在）。 */
    modelRetired: string
    modelNotActivated: string
    modelNotFound: string
  }
  runtimeActivity: {
    title: string
    /** Legacy raw-reference fallback; hosts with a context card supply their own label. */
    contextReference?: string
    waitingForToolApproval: string
    approvalAllowed: string
    approvalDenied: string
    resolvedAt: (resolvedAt: string) => string
    toolCall: (toolCallId: string) => string
    /** Shown above the approval card's field list. */
    approvalRequestParamsNotice: string
    /** Field names for the product write capabilities; unknown fields keep their raw key. */
    approvalFieldLabels: Record<string, string>
    toolInputStarted: string
    toolInputStreaming: string
    toolInputAvailable: string
    toolRunning: string
    toolCompleted: string
    toolFailed: string
    toolDenied: string
    productToolRunning: string
    productToolCompleted: string
    productToolFailed: string
    outputHash: (hash: string) => string
    duration: (durationMs: number) => string
    asOf: (asOf: string) => string
    reasoningTitle: string
    reasoningInProgress: string
    reasoningCompleted: string
    reasoningProcessed: string
    liveResponseTitle: string
    streamingText: string
    runtimeControlEvent: string
    /** Human labels for SDK control subtypes; unknown subtypes fall back to the raw name. */
    runtimeControlLabels: Record<string, string>
    structuredContent: string
    content: string
    output: string
    input: string
    resultPreviewText: string
    resultPreviewJson: string
    resultPreviewImage: string
    resultPreviewResource: string
    resultPreviewTable: string
    resultPreviewError: string
    reasoningGroupTitle: string
    executionGroupTitle: string
    groupSummary: (count: number) => string
    runningTitle: string
    completedSummary: string
    completedIn: (duration: string) => string
    failureTitle: string
    questionTitle: string
    questionFreeform: string
    questionSkip: string
    questionSubmit: string
    questionRecommended: string
    fileArtifacts: {
      editedSummary: (count: number) => string
      touchedSummary: (count: number) => string
      changedStats: (added: number, removed: number) => string
      showMore: (count: number) => string
      showLess: string
      documentKind: string
      codeKind: string
      fileKind: string
      openWith: string
      openWithAria: (fileName: string) => string
      targets: {
        vscode: string
        cursor: string
        default: string
        terminal: string
        iterm2: string
        xcode: string
        'android-studio': string
        'intellij-idea': string
        pycharm: string
        finder: string
      }
    }
    allow: string
    allowOriginalInput: string
    allowWithEditedInput: string
    deny: string
    open: string
    denyMessage: string
    editInput: string
    invalidInputJson: string
    pending: string
    running: string
    done: string
    error: string
    denied: string
  }
  input: {
    placeholder: string
    soulPlaceholder: string
    readFailed: string
    clipboardImageFailed: string
    reasoningEffort: string
    effortLevels: { off: string; low: string; high: string; max: string }
    truncated: string
    removeAttachment: string
    mentionAgent: string
    attachment: string
    availableTools: string
    builtinToolsEnabled: (enabled: number, total: number) => string
    approval: Record<ToolApproval, string>
    mcpSkillsManagedInConfig: string
    tools: string
    noBuiltinCommands: string
    confirmClearMessages: (name: string) => string
    commands: string
    quickActions: string
    quickPanelEmpty: string
    quickPanelSearchPlaceholder: string
    quickActionToolsDescription: string
    quickActionAttachmentDescription: string
    quickActionMentionDescription: string
    quickActionClearDescription: string
    quickActionExpandDescription: string
    quickActionCollapseDescription: string
    runtimeCommandContextTitle: string
    runtimeCommandCostTitle: string
    runtimeCommandTodosTitle: string
    expand: string
    collapse: string
    mentionedModels: string
    mentionModel: string
    mentionModelPlaceholder: string
    mentionedModelSelection: (count: number) => string
    clearMentionedModels: string
    clearMentionedModelsDescription: string
    openModelService: string
    openModelServiceDescription: string
    pinnedSectionLabel: string
    sendFailed: (message: string) => string
    stop: string
    send: string
  }
} & AgentTextWorkbench

import type { AgentText } from './agentTextTypes'
import { agentTextEnRuntime } from './agentTextEnRuntime'
import { agentTextEnWorkbench } from './agentTextEnWorkbench'

export const agentTextEn: AgentText = {
  common: {
    agent: 'Agent',
    noSession: 'No session yet',
    cancel: 'Cancel',
    save: 'Save',
    add: 'Add',
    remove: 'Remove',
    enabled: 'Enabled',
    available: 'Available',
    pinned: 'Pinned',
    recent: 'Recent',
    noDescription: 'No description',
    systemWorkspace: 'System Workspace'
  },
  navbar: {
    hideSidebar: 'Hide sessions',
    showSidebar: 'Show sessions',
    openSessions: 'Open agent sessions',
    search: 'Search',
    createAgent: 'New agent',
    agentSettings: 'Agent settings'
  },
  sidePanel: {
    navigationTabs: 'Agent sidebar', agentsTab: 'Agents',
    sessionsTab: 'Sessions',
    newSession: 'New session',
    defaultSessionName: 'New agent session',
    clearFilteredSessions: 'Clear filtered sessions',
    confirmDeleteFilteredSessions: (count) => `Delete ${count} filtered session${count === 1 ? '' : 's'}?`,
    searchSessions: 'Search sessions',
    sessionCount: (count) => `${count} session${count === 1 ? '' : 's'}`,
    emptyAgents: 'No agents yet. Create one to start.',
    agentSessionCount: (count) => `${count} session${count === 1 ? '' : 's'}`,
    emptySessions: 'No sessions yet. Create one to start.'
  },
  sessionItem: {
    rename: 'Rename',
    pin: 'Pin',
    unpin: 'Unpin',
    delete: 'Delete',
    deleteShortcut: 'Click again to delete, or Cmd/Ctrl-click to delete immediately',
    more: 'More',
    moreAria: 'More session actions',
    panelPosition: 'Session panel position',
    panelPositionLeft: 'Left',
    panelPositionRight: 'Right',
    status: {
      pending: 'Responding',
      done: 'New completed response',
      error: 'Response failed',
      paused: 'Run paused'
    },
    confirmDeleteSession: (name) => `Delete session "${name}"?`,
    channelRuntime: {
      title: 'Channel status',
      lifecycle: 'Lifecycle',
      credential: 'Credential',
      session: 'Session',
      hint: 'Hint',
      message: 'Message',
      retry: 'Retry',
      url: 'Credential URL',
      qr: 'QR text',
      retryable: 'Retryable',
      notRetryable: 'Not retryable',
      expiresAt: (value) => `Expires at ${value}`,
      lastCheckedAt: (value) => `Last checked ${value}`,
      status: {
        connected: 'Connected',
        connecting: 'Connecting',
        error: 'Error',
        inactive: 'Inactive'
      },
      lifecycleState: {
        connecting: 'Connecting',
        'awaiting-credential': 'Awaiting credential',
        'awaiting-qr-scan': 'Awaiting QR scan',
        ready: 'Ready',
        reconnecting: 'Reconnecting',
        'session-expired': 'Session expired',
        'terminal-error': 'Terminal error'
      },
      credentialState: {
        'not-required': 'Not required',
        required: 'Required',
        captured: 'Captured',
        expired: 'Expired'
      },
      sessionState: {
        unknown: 'Unknown',
        active: 'Active',
        reconnecting: 'Reconnecting',
        expired: 'Expired'
      }
    }
  },
  chat: {
    modelServiceUnavailableTitle: 'Model service is not ready',
    loadingModelServiceTitle: 'Loading model service…',
    loadingModelServiceDescription: 'Reading the saved providers and default model.',
    modelServiceUnavailableDescription: 'Configure an enabled provider, API key, and chat model before starting an agent session.',
    modelServiceUnavailableReasons: {
      unset: 'No default agent model is selected yet.',
      unparsable: 'The default agent model setting is malformed.',
      'provider-missing': 'The provider for the default model is no longer in Model Service.',
      'provider-disabled': 'The provider for the default model is disabled.',
      'provider-not-ready': 'The provider for the default model is missing an API key or a usable endpoint.',
      'model-missing': 'The default model is no longer in that provider’s model list.',
      'model-incompatible': 'The default model does not support the Claude Code agent runtime.'
    },
    openModelService: 'Open Model Service',
    ordinaryChatOnlyTitle: 'Chat works, Agent runtime is not ready',
    ordinaryChatOnlyDescription:
      'Ordinary chat connection may succeed, but this model has not passed a Claude Code Agent runtime probe. Run a runtime connection check first.',
    directAuthFailedTitle: 'Claude Code direct auth failed',
    directAuthFailedDescription:
      'Ordinary chat may work, but the Claude Code direct probe failed. Enable the Agent Model Gateway, or use credentials and endpoints that support Anthropic Messages.',
    runtimeUnverifiedTitle: 'Agent runtime is unverified',
    runtimeUnverifiedDescription:
      'This model has not completed a Claude Code runtime probe yet. Run a connection check in settings to verify the direct or gateway route.',
    gatewayRequiredTitle: 'Agent Model Gateway required',
    gatewayRequiredDescription:
      'Ordinary chat may work, but this model has not passed a direct Claude Code probe. Enable and start the platform Agent Model Gateway before using it in agents.',
    gatewayStoppedTitle: 'Agent Model Gateway is stopped',
    gatewayStoppedDescription: 'This model needs the local gateway route. Start the Agent Model Gateway before continuing the agent session.',
    noAgentTitle: 'No available agent',
    noAgentDescription: 'Create an agent and a session before chatting.',
    noSessionTitle: 'No active session',
    noSessionDescription: 'Create or select a session to start chatting with this agent.',
    orphanTitle: 'Session is not bound to this agent',
    orphanDescription: 'This session is orphaned. Bind it to an agent to continue.',
    openAgentConfig: 'Open agent config'
  },
  gatewayStatus: {
    title: 'Local model gateway',
    requiredTitle: 'This model needs the local model gateway',
    requiredDescription:
      'Claude Code agents speak Anthropic Messages. This provider’s Messages endpoint has not passed the direct check (or it only exposes an OpenAI-compatible endpoint), so the local gateway translates the protocol on this machine before forwarding to the provider.',
    currentModel: (name) => `Model: ${name}`,
    enableAndStart: 'Enable and start gateway',
    startingButton: 'Starting…',
    openModelService: 'Check direct route in Model Service',
    localOnly: 'Runs on this machine only. It never uploads or logs your API key.',
    enable: 'Enable',
    disable: 'Disable',
    start: 'Start',
    stop: 'Stop',
    state: {
      disabled: 'Disabled',
      starting: 'Starting',
      running: 'Running',
      stopped: 'Stopped',
      error: 'Error'
    },
    description: {
      disabled: 'Gateway is disabled by default. Enable it to expose a local Anthropic Messages route for OpenAI-compatible models.',
      starting: 'Starting the local gateway…',
      running: 'Local gateway is ready. Claude Code can reach models through converted provider routes.',
      stopped: 'Gateway is enabled but stopped. Start it before probing gateway routes.',
      error: 'Gateway is in an error state. Check configuration and try starting again.'
    }
  },
  chatNavbar: {
    selectLocalDirectory: 'Select local directory...',
    selectModel: 'Select model',
    openWorkspace: 'Open workspace',
    openInExternalApp: (name) => `Open in ${name}`,
    openInExternalAppMenu: 'Choose external editor',
    clearMessages: 'Clear messages',
    taskCenter: 'Task center',
    chatSettings: 'Chat settings',
    agentConfig: 'Agent config',
    confirmClearMessages: (name) => `Clear all messages in "${name}"?`,
  },
  search: {
    title: 'Search agent sessions',
    placeholder: 'Search agents, sessions, or messages',
    empty: 'No matching results',
    unboundAgent: 'Unbound agent'
  },
  settingsDrawer: {
    title: 'Chat settings',
    sessionName: 'Session name',
    boundAgent: 'Bound agent',
    permissionMode: 'Permission mode',
    soulMode: 'Soul Mode',
    soulModeDescription: 'Allow the agent to enter a more autonomous run mode.',
    heartbeat: 'Heartbeat',
    heartbeatDescription: 'Reserved for long-running task status sync.',
    messageStyle: 'Message style',
    messageNavigation: 'Message navigation',
    narrowMode: 'Narrow layout',
    fontSize: 'Font size',
    sendShortcut: 'Send shortcut',
    confirmDeleteMessage: 'Confirm message deletion',
    confirmDeleteMessageDescription: 'Ask for confirmation before deleting a message.',
    useCurrentAgent: 'Use current agent',
    channelRuntime: {
      title: 'Channel runtime',
      empty: 'No channels are bound to this session.',
      restart: 'Reconnect channel',
      openCredentialUrl: 'Open credential link',
      expiresAt: 'Expires',
      activeChats: (count) => `${count} active chat${count === 1 ? '' : 's'}`,
      updatedAt: (value) => `Updated ${value}`,
      boundChannels: (count) => `${count} bound channel${count === 1 ? '' : 's'}`
    }
  },
  messageStyle: {
    plain: 'Plain text',
    bubble: 'Bubble'
  },
  messageNavigation: {
    none: 'Off',
    buttons: 'Navigation buttons',
    anchor: 'Anchor rail'
  },
  messages: {
    emptyTitle: 'Start an agent session',
    emptyDescription: 'Describe the goal, question, or task you want the agent to handle.',
    userAvatar: 'Me',
    userName: 'You',
    copy: 'Copy',
    quote: 'Quote',
    copyAria: 'Copy message',
    resend: 'Resend',
    resendAria: 'Resend message',
    delete: 'Delete',
    deleteAria: 'Delete message',
    confirmDeleteMessage: 'Delete this message?',
    loadOlder: 'Load older messages',
    navigateTop: 'Jump to top',
    navigatePrevious: 'Previous message',
    navigateNext: 'Next message',
    navigateBottom: 'Jump to bottom',
    anchorRailAria: 'Message anchor navigation',
    nonTextContent: '[Non-text content]',
    tokenUsage: (total) => `Token usage ${total}`,
    tokenUsageBreakdown: (input, output) => `Input ${input} · Output ${output}`,
    tokenUsageAria: 'Token usage for this session',
    status: {
      pending: 'Thinking',
      success: '',
      paused: 'Paused',
      error: 'Error'
    }
  },
  input: {
    placeholder: 'Message the agent...',
    soulPlaceholder: 'Enter autonomous task instructions for the agent...',
    readFailed: 'Read failed',
    clipboardImageFailed: 'Could not read the clipboard image.',
    reasoningEffort: 'Reasoning level',
    effortLevels: { off: 'Off', low: 'Low', high: 'High', max: 'Max' },
    truncated: 'Truncated',
    removeAttachment: 'Remove attachment',
    mentionAgent: 'Mention agent',
    attachment: 'Attachment',
    availableTools: 'Available tools',
    builtinToolsEnabled: (enabled, total) => `${enabled}/${total} built-in tools enabled`,
    approval: {
      prompt: 'Needs confirmation',
      auto: 'Auto available'
    },
    mcpSkillsManagedInConfig: 'MCP and Skills are managed from the agent config page.',
    tools: 'Tools',
    noBuiltinCommands: 'This agent has no built-in commands.',
    confirmClearMessages: (name) => `Clear all messages in "${name}"?`,
    commands: 'Commands',
    quickActions: 'Quick actions',
    quickPanelEmpty: 'No matching actions.',
    quickPanelSearchPlaceholder: 'Search actions or models',
    quickActionToolsDescription: 'Open built-in tool toggles',
    quickActionAttachmentDescription: 'Attach local files',
    quickActionMentionDescription: 'Open the model mention picker',
    quickActionClearDescription: 'Clear the current session messages',
    quickActionExpandDescription: 'Expand the input area',
    quickActionCollapseDescription: 'Collapse the input area',
    runtimeCommandContextTitle: 'Context',
    runtimeCommandCostTitle: 'Cost',
    runtimeCommandTodosTitle: 'Todos',
    expand: 'Expand input',
    collapse: 'Collapse input',
    mentionedModels: 'Mentioned models',
    mentionModel: 'Mention model',
    mentionModelPlaceholder: 'Search models to mention',
    mentionedModelSelection: (count) => `${count} model${count === 1 ? '' : 's'} selected`,
    clearMentionedModels: 'Clear all',
    clearMentionedModelsDescription: 'Clear selected mentioned models',
    openModelService: 'Add model...',
    openModelServiceDescription: 'Open model service settings',
    pinnedSectionLabel: 'Pinned',
    sendFailed: (message) => `Send failed: ${message}`,
    stop: 'Stop',
    send: 'Send'
  },
  ...agentTextEnRuntime,
  ...agentTextEnWorkbench
}

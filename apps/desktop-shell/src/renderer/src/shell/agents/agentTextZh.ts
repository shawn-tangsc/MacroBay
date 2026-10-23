import type { AgentText } from './agentTextTypes'
import { agentTextZhRuntime } from './agentTextZhRuntime'
import { agentTextZhWorkbench } from './agentTextZhWorkbench'

export const agentTextZh: AgentText = {
  common: {
    agent: '智能体',
    noSession: '还没有会话',
    cancel: '取消',
    save: '保存',
    add: '添加',
    remove: '移除',
    enabled: '已启用',
    available: '可添加',
    pinned: '置顶',
    recent: '最近',
    noDescription: '暂无描述',
    systemWorkspace: '系统工作区'
  },
  navbar: {
    hideSidebar: '隐藏会话栏',
    showSidebar: '显示会话栏',
    openSessions: '打开智能体会话',
    search: '搜索',
    createAgent: '新建智能体',
    agentSettings: '智能体设置'
  },
  sidePanel: {
    navigationTabs: '智能体侧栏', agentsTab: '智能体',
    sessionsTab: '会话',
    newSession: '新建会话',
    defaultSessionName: '新的智能体会话',
    clearFilteredSessions: '清空当前筛选会话',
    confirmDeleteFilteredSessions: (count) => `确认删除当前筛选出的 ${count} 个会话？`,
    searchSessions: '搜索会话',
    sessionCount: (count) => `${count} 个会话`,
    emptyAgents: '还没有智能体，先创建一个。',
    agentSessionCount: (count) => `${count} 个会话`,
    emptySessions: '还没有会话，先创建一个。'
  },
  sessionItem: {
    rename: '重命名',
    pin: '置顶',
    unpin: '取消置顶',
    delete: '删除',
    deleteShortcut: '再次点击删除，或按住 Cmd/Ctrl 点击直接删除',
    more: '更多',
    moreAria: '更多会话操作',
    panelPosition: '会话栏位置',
    panelPositionLeft: '左侧',
    panelPositionRight: '右侧',
    status: {
      pending: '正在响应',
      done: '有新的完成响应',
      error: '响应出错',
      paused: '运行已暂停'
    },
    confirmDeleteSession: (name) => `确认删除会话“${name}”？`,
    channelRuntime: {
      title: '渠道状态',
      lifecycle: '生命周期',
      credential: '凭证',
      session: '会话',
      hint: '提示',
      message: '消息',
      retry: '重试',
      url: '凭证链接',
      qr: '二维码文本',
      retryable: '可重试',
      notRetryable: '不可重试',
      expiresAt: (value) => `过期时间 ${value}`,
      lastCheckedAt: (value) => `最近检查 ${value}`,
      status: {
        connected: '已连接',
        connecting: '连接中',
        error: '错误',
        inactive: '未启用'
      },
      lifecycleState: {
        connecting: '连接中',
        'awaiting-credential': '等待凭证',
        'awaiting-qr-scan': '等待扫码',
        ready: '已就绪',
        reconnecting: '重连中',
        'session-expired': '会话已过期',
        'terminal-error': '终态错误'
      },
      credentialState: {
        'not-required': '不需要',
        required: '需要',
        captured: '已获取',
        expired: '已过期'
      },
      sessionState: {
        unknown: '未知',
        active: '活跃',
        reconnecting: '重连中',
        expired: '已过期'
      }
    }
  },
  chat: {
    modelServiceUnavailableTitle: '模型服务尚未就绪',
    loadingModelServiceTitle: '正在加载模型服务…',
    loadingModelServiceDescription: '正在读取已保存的供应商和默认模型。',
    modelServiceUnavailableDescription: '先配置可用的模型服务、API Key 和聊天模型，再开始智能体会话。',
    modelServiceUnavailableReasons: {
      unset: '还没有选择默认智能体模型。',
      unparsable: '默认智能体模型的配置格式无效。',
      'provider-missing': '默认模型所属的供应商已不在模型服务里。',
      'provider-disabled': '默认模型所属的供应商未启用。',
      'provider-not-ready': '默认模型所属的供应商缺少 API Key 或端点不可用。',
      'model-missing': '默认模型已不在该供应商的模型列表里。',
      'model-incompatible': '默认模型不支持 Claude Code 智能体运行时。'
    },
    openModelService: '打开模型服务',
    ordinaryChatOnlyTitle: '普通聊天可用，智能体运行时未就绪',
    ordinaryChatOnlyDescription:
      '设置页的普通聊天连接可能已成功，但当前模型尚未通过 Claude Code Agent 运行时探测。请先完成运行时连接检查。',
    directAuthFailedTitle: 'Claude Code 直连鉴权失败',
    directAuthFailedDescription:
      '普通聊天可能可用，但 Claude Code 直连探测失败。可启用 Agent Model Gateway，或更换支持 Anthropic Messages 的密钥与端点。',
    runtimeUnverifiedTitle: '智能体运行时尚未验证',
    runtimeUnverifiedDescription:
      '该模型尚未完成 Claude Code 运行时探测。请先在设置页运行连接检查，确认直连或 Gateway 路由可用。',
    gatewayRequiredTitle: '需要 Agent Model Gateway',
    gatewayRequiredDescription:
      '普通聊天可能可用，但当前模型尚未通过 Claude Code 直连探测。启用并启动平台 Agent Model Gateway 后，才能在智能体中使用该模型。',
    gatewayStoppedTitle: 'Agent Model Gateway 已停止',
    gatewayStoppedDescription: '当前模型需要通过本地 Gateway 路由。请先启动 Agent Model Gateway，再继续智能体会话。',
    noAgentTitle: '还没有可用智能体',
    noAgentDescription: '先创建智能体和会话，再开始对话。',
    noSessionTitle: '还没有活动会话',
    noSessionDescription: '先创建或选择一个会话，再和当前智能体开始对话。',
    orphanTitle: '会话未绑定当前智能体',
    orphanDescription: '这个会话处于孤儿状态，请重新绑定一个智能体。',
    openAgentConfig: '打开智能体配置'
  },
  gatewayStatus: {
    title: '本地模型网关',
    requiredTitle: '这个模型需要本地模型网关',
    requiredDescription:
      'Claude Code 智能体只使用 Anthropic Messages 协议。当前供应商的 Messages 端点没有通过直连检测（或它只提供 OpenAI 兼容端点），本地网关会在本机做协议转换后转发给供应商。',
    currentModel: (name) => `当前模型：${name}`,
    enableAndStart: '启用并启动网关',
    startingButton: '正在启动…',
    openModelService: '去模型服务检查直连',
    localOnly: '网关只在本机运行，不会上传或记录 API Key。',
    enable: '启用',
    disable: '禁用',
    start: '启动',
    stop: '停止',
    state: {
      disabled: '未启用',
      starting: '启动中',
      running: '运行中',
      stopped: '已停止',
      error: '错误'
    },
    description: {
      disabled: 'Gateway 默认关闭。启用后可为 OpenAI 兼容模型提供本地 Anthropic Messages 路由。',
      starting: '正在启动本地 Gateway…',
      running: '本地 Gateway 已就绪，Claude Code 可通过转换后的 provider 路由访问模型。',
      stopped: 'Gateway 已启用但未运行。启动后才能探测 gateway 路由。',
      error: 'Gateway 处于错误状态。请检查配置后重试启动。'
    }
  },
  chatNavbar: {
    selectLocalDirectory: '选择本地目录...',
    selectModel: '选择模型',
    openWorkspace: '打开工作区',
    openInExternalApp: (name) => `在 ${name} 中打开`,
    openInExternalAppMenu: '选择外部编辑器',
    clearMessages: '清空消息',
    taskCenter: '任务中心',
    chatSettings: '聊天设置',
    agentConfig: '智能体配置',
    confirmClearMessages: (name) => `确认清空会话“${name}”的全部消息？`,
  },
  search: {
    title: '搜索智能体会话',
    placeholder: '搜索智能体、会话或消息内容',
    empty: '没有匹配结果',
    unboundAgent: '未绑定智能体'
  },
  settingsDrawer: {
    title: '聊天设置',
    sessionName: '会话名称',
    boundAgent: '绑定智能体',
    permissionMode: '权限模式',
    soulMode: 'Soul Mode',
    soulModeDescription: '允许智能体进入更自主的运行模式。',
    heartbeat: '心跳',
    heartbeatDescription: '保留给长任务运行状态同步。',
    messageStyle: '消息样式',
    messageNavigation: '消息导航',
    narrowMode: '窄栏布局',
    fontSize: '字体大小',
    sendShortcut: '发送快捷键',
    confirmDeleteMessage: '删除消息确认',
    confirmDeleteMessageDescription: '开启后删除消息前需要二次确认。',
    useCurrentAgent: '使用当前智能体',
    channelRuntime: {
      title: '渠道运行时',
      empty: '当前会话还没有绑定渠道。',
      restart: '重新连接渠道',
      openCredentialUrl: '打开凭证链接',
      expiresAt: '过期',
      activeChats: (count) => `${count} 个活跃会话`,
      updatedAt: (value) => `更新于 ${value}`,
      boundChannels: (count) => `${count} 个绑定渠道`
    }
  },
  messageStyle: {
    plain: '纯文本',
    bubble: '气泡'
  },
  messageNavigation: {
    none: '关闭',
    buttons: '导航按钮',
    anchor: '锚点侧栏'
  },
  messages: {
    emptyTitle: '开始一次智能体会话',
    emptyDescription: '可以直接描述目标、问题或需要智能体执行的任务。',
    userAvatar: '我',
    userName: '你',
    copy: '复制',
    quote: '引用',
    copyAria: '复制消息',
    resend: '重新发送',
    resendAria: '重新发送消息',
    delete: '删除',
    deleteAria: '删除消息',
    confirmDeleteMessage: '确认删除这条消息？',
    loadOlder: '加载更早消息',
    navigateTop: '回到顶部',
    navigatePrevious: '上一条消息',
    navigateNext: '下一条消息',
    navigateBottom: '回到底部',
    anchorRailAria: '消息锚点导航',
    nonTextContent: '[非文本内容]',
    tokenUsage: (total) => `Token 用量 ${total}`,
    tokenUsageBreakdown: (input, output) => `输入 ${input} · 输出 ${output}`,
    tokenUsageAria: '本会话 Token 用量',
    status: {
      pending: '思考中',
      success: '',
      paused: '已暂停',
      error: '错误'
    }
  },
  input: {
    placeholder: '给智能体发送消息...',
    soulPlaceholder: '输入希望智能体自主完成的任务指令...',
    readFailed: '读取失败',
    clipboardImageFailed: '剪贴板图片读取失败。',
    reasoningEffort: '推理等级',
    effortLevels: { off: '关闭', low: '低', high: '高', max: '最大' },
    truncated: '已截断',
    removeAttachment: '移除附件',
    mentionAgent: '引用智能体',
    attachment: '附件',
    availableTools: '可用工具',
    builtinToolsEnabled: (enabled, total) => `${enabled}/${total} 个内置工具已启用`,
    approval: {
      prompt: '需要确认',
      auto: '自动可用'
    },
    mcpSkillsManagedInConfig: 'MCP 与 Skills 在智能体配置页统一绑定。',
    tools: '工具',
    noBuiltinCommands: '当前智能体没有内置命令。',
    confirmClearMessages: (name) => `确认清空会话“${name}”的全部消息？`,
    commands: '命令',
    quickActions: '快捷操作',
    quickPanelEmpty: '没有匹配的操作。',
    quickPanelSearchPlaceholder: '搜索操作或模型',
    quickActionToolsDescription: '打开内置工具开关',
    quickActionAttachmentDescription: '添加本地文件附件',
    quickActionMentionDescription: '打开模型提及选择器',
    quickActionClearDescription: '清空当前会话消息',
    quickActionExpandDescription: '展开输入区域',
    quickActionCollapseDescription: '收起输入区域',
    runtimeCommandContextTitle: '上下文',
    runtimeCommandCostTitle: '用量',
    runtimeCommandTodosTitle: '待办',
    expand: '展开输入框',
    collapse: '收起输入框',
    mentionedModels: '已提及模型',
    mentionModel: '提及模型',
    mentionModelPlaceholder: '搜索要提及的模型',
    mentionedModelSelection: (count) => `已选择 ${count} 个模型`,
    clearMentionedModels: '清空全部',
    clearMentionedModelsDescription: '清空当前已提及模型',
    openModelService: '添加模型...',
    openModelServiceDescription: '打开模型服务设置',
    pinnedSectionLabel: '置顶',
    sendFailed: (message) => `发送失败：${message}`,
    stop: '停止',
    send: '发送'
  },
  ...agentTextZhRuntime,
  ...agentTextZhWorkbench
}

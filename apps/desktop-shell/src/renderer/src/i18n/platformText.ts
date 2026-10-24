import type { ProviderCategoryId } from '@platform/ai/providers/providerPresets'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

export type PlatformText = {
  brand: {
    title: string
    subtitle: string
  }
  nav: {
    workspace: string
    chat: string
    assistants: string
    agents: string
    data: string
    docs: string
    settings: string
  }
  status: {
    productLoaded: string
    productsLoaded: string
    loading: string
    saved: string
    failed: string
  }
  workspace: {
    eyebrow: string
    title: string
    copy: string
    loadedProducts: string
    manifestDriven: string
    runtime: string
    preloadApi: string
    app: string
    theme: string
    node: string
    chrome: string
    tools: string
    skills: string
    agents: string
    contributionLoadFailed: string
    panelActions: string
    panelClose: string
    panelReopen: string
    panelEmbedded: string
    panelDockRight: string
    panelDockBottom: string
    panelDetach: string
    panelResetSize: string
    panelUnsupported: string
    panelFallback: string
    panelResize: string
    panelInspector: string
    inspectorTitle: string
    inspectorDraft: string
    inspectorSelection: string
    inspectorSelect: string
    inspectorSelected: string
    panelModeUnsupported: string
    panelCapabilityMissing: string
    panelReturnToPage: string
    panelShowPanel: string
    panelCommandRejected: string
    panelCommandFailed: string
    panelHandoffUnsaved: string
    panelHandoffSensitive: string
    panelHandoffUnsupported: string
    windowHostUnavailableTitle: string
    windowHostUnavailableContext: string
    windowHostUnavailablePanel: string
    /** P1-06h（N2）：error-shell 的下一步提示（与标题/原因同样是成对 EN/ZH 键）。 */
    windowHostUnavailableHint: string
    /** P1-06h（N2）：独立窗准备期壳的专用正文（此前复用通用 loading，无法说明正在接管面板）。 */
    windowPreparingDetail: string
    windowPanelPlaceholder: string
    /** P2-02：顶部 Tab Strip / 页面宿主（A-T02/A-T08 的组件文案；EN/ZH 成对）。 */
    tabStrip: string
    tabClose: string
    tabOpenPage: string
    tabActions: string
    tabCloseOthers: string
    tabCloseRight: string
    tabReopen: string
    /** 「重开」入口不可用时的可见原因（禁用项绝不静默灰掉）。 */
    tabReopenUnavailable: string
    /** 动作在当前标签集合下不可用时的可见原因（禁用项绝不静默灰掉）。 */
    tabCloseUnavailable: string
    tabCloseOthersUnavailable: string
    tabCloseRightUnavailable: string
    /** Main 注册与 shell loader 不一致时 Tab 的兜底标签（Tab 仍必须可见可关闭）。 */
    tabPageMissing: string
    tabEmptyTitle: string
    tabEmptyHint: string
    tabCommandRejected: string
    tabCommandFailed: string
    /** P2-15：Tab 右键上下文菜单的「分离到新窗口」及其可见原因（禁用项绝不静默灰掉）。 */
    tabDetach: string
    tabDetachUnavailable: string
    tabDetachUnsupported: string
    tabDetachAlreadyDetached: string
    tabDetachLimitReached: string
    /** P2-15：独立页面窗右上角的「回停靠到主窗口」悬浮控件。 */
    pageWindowRedock: string
    /** PLAT-40：分离面板窗顶栏的「回停靠到主窗口」入口 + 被拒/失败时的可见提示。 */
    panelWindowRedock: string
    panelWindowRedockFailed: string
    /** P2-02：草稿保护三态提示（敏感 Settings 草稿绝不进入平台 handoff）。 */
    draftGateTitle: string
    draftGateSensitive: string
    draftGateUnsaved: string
    draftGateSave: string
    draftGateDiscard: string
    draftGateCancel: string
    draftGateSaveFailed: string
    draftGateHint: string
  }
  settings: {
    modelService: string
    assistantLibrary: string
    webSearch: string
    storageAndCache: string
    taskAutomation: string
    basicSettings: string
    notifications: string
    channels: string
    channelCreate: string
    channelRefresh: string
    channelPlanned: string
    channelRunning: string
    channelDisable: string
    channelRestart: string
    channelCredentialConfigured: string
    channelCredentialMissing: string
    channelCredentialUnavailable: string
    channelSaveCredential: string
    channelNoInstances: string
    channelName: string
    channelAgentId: string
    channelCredential: string
    channelAppCredential: string
    channelLarkAppId: string
    channelLarkAppSecret: string
    channelQqAppId: string
    channelQqClientSecret: string
    channelDiscordBotToken: string
    channelWechatEnrollment: string
    channelDelete: string
    channelPolicy: string
    channelPolicyCreate: string
    channelPolicySubject: Record<'user' | 'conversation', string>
    channelTarget: string
    channelUpdate: string
    channelEnable: string
    channelEnableBlocked: string
    channelAdapterUnavailable: string
    channelCandidates: string
    channelCandidatesEmpty: string
    channelCandidateUnknown: string
    channelCandidateAllow: string
    channelCandidateIgnore: string
    channelDeleteConfirm: string
    channelCancel: string
    channelRuntimeGeneration: string
    channelRuntimeLifecycle: string
    channelCatalogStatus: Record<'planned' | 'blocked' | 'supported', string>
    channelConversationKind: Record<'direct' | 'group' | 'channel', string>
    channelState: Record<'credential-missing' | 'configuration-ready' | 'disabled' | 'deleting' | 'runtime-ready', string>
  }
  taskAutomation: {
    title: string
    subtitle: string
    refresh: string
    retry: string
    emptyValue: string
    deliveryHealth: string
    healthUpdated: (time: string) => string
    healthEmpty: string
    scheduledTaskDelivery: string
    resourceJobRuns: string
    resourceJobRunsEmpty: string
    healthScopeNote: string
    myTasks: string
    columns: {
      name: string
      status: string
      schedule: string
      nextRun: string
      lastResult: string
      actions: string
      source: string
      registration: string
      lastRun: string
    }
    all: string
    searchTasks: string
    tasksLoading: string
    tasksLoadFailed: string
    loadMore: string
    filterEmpty: string
    clearFilters: string
    emptyTasksTitle: string
    emptyTasksBody: string
    status: Record<'active' | 'paused' | 'completed', string>
    outcome: Record<'success' | 'failed' | 'skipped' | 'never', string>
    details: string
    collapse: string
    taskDeliveryHealth: string
    recentChanges: string
    noChanges: string
    delivered: string
    failed: string
    pending: string
    skipped: string
    unknown: string
    auditAccepted: string
    auditRejected: string
    auditAction: Record<'create' | 'update' | 'pause' | 'resume' | 'delete' | 'run-now' | 'cancel-run' | 'runtime-transition' | 'channel-delete-cleanup', string>
    resourceJobs: string
    resourceLoading: string
    resourceLoadFailed: string
    resourceBridgeMissing: string
    resourceLoadTimeout: string
    resourceEmptyTitle: string
    resourceEmptyBody: string
    resourceNote: string
    allSources: string
    allStatuses: string
    platform: string
    product: string
    registered: string
    notRegistered: string
    resourceCount: (total: number, filtered: number) => string
    resourceCountWithPage: (total: number, filtered: number, page: number, pages: number) => string
    resourcePageSize: string
    resourcePrevPage: string
    resourceNextPage: string
    resourcePageIndicator: (page: number, pages: number) => string
    schedule: {
      everySeconds: (count: number) => string
      everyMinutes: (count: number) => string
      everyHours: (count: number) => string
      cron: (expression: string) => string
      onceAt: (time: string) => string
      manual: string
      startup: string
      event: (topic: string) => string
    }
    policy: string
    balanced: string
    conservative: string
    policyCurrent: string
    policyExplanation: string
    policyConcurrencyLimit: string
    policyConcurrencyValue: (count: number) => string
    policyMinInterval: string
    policyTimeout: string
    policyTimeoutValue: (minutes: number) => string
    policyLoading: string
    policyLoadFailed: string
    policyEmptyNote: string
  }
  assistants: {
    title: string
    assistants: string
    topics: string
    addAssistant: string
    newTopic: string
    noAssistant: string
    noTopics: string
    defaultAssistant: string
    selectTopic: string
    emptyChat: string
    startConversation: string
    inputPlaceholder: string
    send: string
    stop: string
    streaming: string
    /** PLAT-63 第二阶段 B：composer 的图像生成入口与小面板。 */
    imageGenerate: string
    imageGenerateTooltipDisabled: string
    imagePromptPlaceholder: string
    imageSize: string
    imageCount: string
    imageGenerateAction: string
    imageGenerating: string
    imageDownload: string
    imagePreview: string
    imagePromptRequired: string
    imageFailureInvalidCount: string
    imageFailureInvalidSize: string
    imageFailureTooLarge: string
    imageFailureNoEndpoint: string
    imageFailureInvalidRequest: string
    imageFailureModelNotFound: string
    imageFailureInvalidResponse: string
    /** T3：图像编辑入口与原图来源。 */
    imageEdit: string
    imageEditTooltipDisabled: string
    imageEditPromptPlaceholder: string
    imageEditAction: string
    imageEditSourceTitle: string
    imageEditSourceSession: string
    imageEditSourceUpload: string
    imageEditSourceRequired: string
    imageEditGenerating: string
    imageFailureSourceTooLarge: string
    imageFailureSourceTypeUnsupported: string
    imageFailureSourceMissing: string
    imageFailureTopicMissing: string
    pendingMessage: string
    generationStopped: string
    modelNotReady: string
    hideTopics: string
    showTopics: string
    deleteMessage: string
    copyMessage: string
    editMessage: string
    regenerate: string
    resendEdited: string
    deleteConversation: string
    deleteConversationConfirm: (name: string) => string
    moreConversationActions: string
    conversationOperationFailed: string
    /** PLAT-74：模型生命周期失败的真实结论（替代笼统的「请重试」）。 */
    modelRetired: string
    modelNotActivated: string
    modelNotFound: string
    cancel: string
    previousSibling: string
    nextSibling: string
    siblingIndex: string
    searchTopic: string
    searchResults: string
    assistantSettings: string
    saveSettings: string
    assistantName: string
    assistantPrompt: string
    /** 设置抽屉不再重复选模型：模型统一在助手页顶部选择器切换。 */
    modelSwitchHint: string
    enableTemperature: string
    temperature: string
    streamOutput: string
    mcpMode: string
    mcpDisabled: string
    mcpAuto: string
    mcpManual: string
    enableWebSearch: string
    webSearchHint: string
    contextSourcesPlaceholder: string
    comingSoon: string
    mentionedModels: string
    webSearchCardTitle: string
    webFetchCardTitle: string
    webSearchSources: string
    webSearchRunning: string
    webSearchFailed: string
    openSource: string
    newAssistantName: (count: number) => string
    /** 助手没绑定模型时，选择器显示的「跟随默认：<模型>」。 */
    followDefaultModel: (model: string) => string
    clearMentionedModels: string
    mentionedModelSelection: (count: number) => string
    inputbarTools: Record<
      'attachment' | 'new-topic' | 'clear-topic' | 'quick-panel' | 'mcp-tools' | 'web-search' | 'context-source',
      string
    >
    library: {
      title: string
      searchPlaceholder: string
      importExternal: string
      manageAssistants: string
      createAssistant: string
      install: string
      installed: string
      updateAvailable: string
      sourcePlatform: string
      sourceProduct: (name: string) => string
      productGroupsTitle: string
      detailPromptTitle: string
      addToAssistant: string
      emptyTitle: string
      emptyDescription: string
      importTitle: string
      importJson: string
      importJsonPlaceholder: string
      importFile: string
      importClipboard: string
      importUrlDisabled: string
      importSubmit: string
      importSuccess: (count: number) => string
      importFailed: string
      createTitle: string
      icon: string
      name: string
      namePlaceholder: string
      prompt: string
      promptPlaceholder: string
      promptGenerate: string
      tokenCount: (count: number) => string
      knowledgeBase: string
      knowledgeBaseDisabled: string
      cancel: string
      create: string
      required: string
      created: string
      installedMessage: string
      groups: Record<
        | 'mine'
        | 'featured'
        | 'career'
        | 'business'
        | 'tools'
        | 'language'
        | 'office'
        | 'general'
        | 'writing'
        | 'programming'
        | 'emotional'
        | 'education'
        | 'creative'
        | 'academic'
        | 'design'
        | 'art'
        | 'entertainment'
        | 'life'
        | 'medical'
        | 'game'
        | 'translation',
        string
      >
    }
  }
  models: {
    providerList: string
    providerDetail: string
    addProvider: string
    searchProvider: string
    searchProviderPlaceholder: string
    addProviderAction: string
    addProviderName: string
    addProviderNamePlaceholder: string
    addProviderKey: string
    addProviderKeyPlaceholder: string
    addProviderOpenAiBase: string
    addProviderAnthropicBase: string
    addProviderBasePlaceholder: string
    addProviderPreset: string
    addProviderPresetPlaceholder: string
    addProviderDuplicate: (name: string) => string
    addProviderInvalidBase: string
    removeProviderConfirm: (name: string) => string
    providerContextOpen: string
    providerContextEnable: string
    providerContextDisable: string
    providerContextDelete: string
    providerContextSystem: string
    systemProviderCannotDelete: string
    noMatchedProviders: string
    noMatchedModels: string
    systemProvider: string
    customProvider: string
    systemProviderHint: string
    noProviders: string
    apiKey: string
    apiKeyPlaceholder: string
    savedApiKeyPlaceholder: string
    savedApiKeyMaskHint: string
    revealApiKeyFailed: string
    getApiKey: string
    modelCatalog: string
    multipleApiKeysHint: string
    showApiKey: string
    hideApiKey: string
    enabled: string
    providerEnabled: string
    providerDisabled: string
    /** PLAT-62：左栏供应商分组名称（组顺序由 PROVIDER_CATEGORY_ORDER 固定）。 */
    providerCategories: Record<ProviderCategoryId, string>
    /** PLAT-62：左栏顶部「已启用」置顶分组标题。 */
    enabledProviders: string
    /** 左栏「推荐」分组标题（已启用之后、分类组之前）。 */
    recommendedProviders: string
    /** PLAT-62 追加：行内可达性标签（未收录按 direct）。 */
    reachabilityDirect: string
    reachabilityProxy: string
    /** PLAT-62 追加：proxy 供应商详情页说明（仅中文界面渲染）。 */
    mainlandProxyNotice: string
    collapseProviderGroup: string
    expandProviderGroup: string
    apiEndpoint: string
    agentRuntimeCompatibility: string
    saveProvider: string
    removeProvider: string
    testConnection: string
    /** PLAT-61：右上角唯一启用开关的 title（点一下立即生效）。 */
    enableSwitchTitle: string
    /** PLAT-61：品牌块「供应商控制台」胶囊按钮。 */
    providerConsole: string
    /** PLAT-81：品牌块单行 meta（host · 分类 · N 个模型 · 可达性），由渲染层拼装。 */
    providerMetaLine: (host: string, category: string) => string
    /** PLAT-81：品牌块 `⋯` 次要操作菜单的 aria-label。 */
    providerMoreActions: string
    /** PLAT-61：分区右上角高级入口。 */
    advancedSettings: string
    /** PLAT-61：密钥辅助行左侧链接（本地化文案，URL 来自 preset 的 `websites.apiKey`）。 */
    getApiKeyHere: string
    getKeyFromConsole: string
    anthropicEndpoint: string
    openAiEndpoint: string
    anthropicPreviewLabel: string
    chatPreviewLabel: string
    endpointOverride: string
    endpointOverrideRisk: string
    endpointNotSet: string
    fetchModelList: string
    /** PLAT-72：「清空模型」按钮 + 二次确认（模型区工具条，danger）。 */
    clearModels: string
    clearModelsConfirmTitle: string
    clearModelsConfirmBody: (count: number) => string
    /** PLAT-75：顶部「在用模型已下线」提示与「更换模型」入口。 */
    inUseModelRetired: (model: string) => string
    changeModel: string
    modelSearch: string
    /** PLAT-62 追加：模型区「智能体（Anthropic messages）」徽标与筛选。 */
    modelFilterAll: string
    modelFilterMessages: string
    modelFilterUnknownHint: string
    /** PLAT-82：本会话检测结果的只读状态（不落库，刷新即消失）。 */
    detectionStatusLabel: (status: 'testing' | 'ok' | 'failed' | 'skipped' | 'cancelled') => string
    /** 行内「失败：原因 / 跳过：原因」（原因经 `probeReasonLabel` / `probeSkipReasonLabel`）。 */
    detectionFailedWithReason: (reason: string) => string
    detectionSkippedWithReason: (reason: string) => string
    /** PLAT-82：模型行来源说明（与 `data-model-protocol-failed` 同一提示）。 */
    detectionProtocolFailedTitle: (protocols: string) => string
    /**
     * PLAT-82：行内**协议 chip** 的 title = `协议名 · 来源`。
     * 来源只有两种：厂商逐条声明 / 仅按默认端点（模型协议）推断。
     */
    modelProtocolChipTitle: (protocol: string, source: string) => string
    /** 本次检测失败（非厂商声明）的协议 chip 文案。 */
    modelProtocolChipThisRunFailed: (protocol: string, reason: string, source: string) => string
    /** 协议 chip 来源：厂商声明过。 */
    modelProtocolSourceDeclared: string
    /** 协议 chip 来源：只是按默认端点 / 模型协议并入，厂商没有逐条声明。 */
    modelProtocolSourceEndpoint: string
    /** 协议 chip 来源：我们自己实测通过（检测证据，已落库）。 */
    modelProtocolSourceProbe: string
    /** PLAT-82：行内状态追加的协议摘要（`协议 2/2` = 通/总数）。 */
    detectionProtocolCount: (passed: number, total: number) => string
    /** 逐协议明细里，复用联通性结论的协议后缀。 */
    detectionProtocolReusedBadge: string
    /** PLAT-82：两个可多选检测模式 + 进度 + 停止。 */
    detectModels: string
    /** 标题下方一行：本次会检测多少个模型。 */
    detectModelsCount: (count: number) => string
    detectModelsWarning: string
    /** 警告下方更小的一行：结果只在本会话可见。 */
    detectSessionOnly: string
    detectModeConnectivity: string
    detectModeConnectivityHint: string
    /** 卡片第二行：这个检测项覆盖哪些模型。 */
    detectModeConnectivityScope: string
    detectModeProtocol: string
    detectModeProtocolHint: string
    detectModeProtocolScope: string
    /** PLAT-82：供应商只有一条协议通道时的说明（避免"以为测了 4 条"）。 */
    detectProtocolSingleChannel: string
    /** 弹窗协议汇总：全部通过 / M 项不通（M=0 走前一个 key）。 */
    detectProtocolSummaryPassed: (models: number) => string
    detectProtocolSummaryFailed: (models: number, failed: number) => string
    detectModeRequired: string
    detectProgressTitle: string
    detectProgress: (done: number, total: number) => string
    /** 运行中主按钮文案（「检测中 x/y」）。 */
    detectStartRunning: (done: number, total: number) => string
    detectStart: string
    detectStop: string
    detectStopped: string
    detectClose: string
    providerNames: Record<string, string>
    modelRetiredTag: string
    /** PLAT-80：模型服务页顶部「默认模型」区块。 */
    defaultModelAssistant: string
    defaultModelAssistantHint: string
    /** 供应商详情顶部：模型列表完全不返回协议支持。 */
    protocolNoticeNone: (provider: string) => string
    protocolNoticeDismiss: string
    defaultModelAgent: string
    defaultModelAgentHint: string
    defaultModelFast: string
    defaultModelFastHint: string
    defaultModelTranslation: string
    defaultModelTranslationHint: string
    defaultModelImage: string
    defaultModelImageHint: string
    /** 默认模型条：第二行（绘画模型）默认收起，用「更多默认模型设置」展开。 */
    defaultModelsShowMore: string
    defaultModelsCollapse: string
    copyModelId: string
    copied: string
    nonChatModelHint: string
    modelDiscountBadge: string
    apiAddress: string
    /** PLAT-81：摘要态没有任何已启用端点时的文案。 */
    endpointNotConfigured: string
    /**
     * T4/T5：默认端点标记 —— 当前默认端点显示灰色「默认」徽章，其余已配置的聊天端点
     * 显示「设为默认」按钮；模型没声明协议时跟随默认端点。
     */
    endpointDefaultBadge: string
    endpointSetDefault: string
    endpointAdd: string
    /** 端点行的删除按钮（aria-label）与只剩一个端点时的禁用提示。 */
    endpointDelete: string
    endpointKeepAtLeastOne: string
    /**
     * T4/T5：「API 地址」摘要标签 = **端点种类**（不是笼统的协议名）：
     * `Chat`（chat/completions）/ `Responses` / `Anthropic Messages` / `Gemini 原生`。
     */
    endpointKindChat: string
    endpointKindResponses: string
    endpointKindMessages: string
    endpointKindGemini: string
    /** 端点输入框下方的「实际请求」预览（存 base、代码拼叶子）。 */
    endpointActualRequestLabel: (url: string) => string
    /** Gemini 原生端点：主机名占位与说明（不能填中转站 base）。 */
    endpointGeminiHostPlaceholder: string
    endpointGeminiHostHint: string
    /** 请求配置抽屉的三个区块标题（聊天端点 / 图像 / 自定义请求头）。 */
    requestConfigChatEndpoints: string
    requestConfigImageEndpoints: string
    requestConfigImageGenerationHint: string
    requestConfigImageEditHint: string
    requestConfigImageBasePlaceholder: string
    overwrite: string
    requestConfig: string
    requestConfigAddEndpoint: string
    requestConfigResponses: string
    requestConfigGemini: string
    /** PLAT-66：protocol=gemini 时「API 地址」主行标签（主端点就是原生协议）。 */
    requestConfigGeminiNative: string
    requestConfigImageGeneration: string
    requestConfigImageEdit: string
    requestConfigAnthropicEndpoint: string
    endpointTestAvailable: string
    endpointTestExistsParamError: string
    endpointTestExistsAuthFailed: string
    endpointTestExists: string
    endpointTestMissing: string
    endpointTestUnreachable: string
    endpointTestNoModel: string
    endpointTestUnsupported: string
    requestConfigBaseRequired: string
    close: string
    modelCostTitle: (context: string, input: string, output: string, cacheRead: string | null, currency: string) => string
    probeReasonModelNotActivated: string
    probeReasonTimeout: string
    probeReasonAuth: string
    probeReasonRateLimit: string
    probeReasonBalance: string
    probeReasonNetwork: string
    probeReasonHttp4xx: string
    probeReasonHttp5xx: string
    probeReasonOther: string
    probeReasonEndpointUnsupported: string
    probeReasonEndpointMissing: string
    probeReasonNetworkError: string
    probeReasonCancelled: string
    probeSkipNonTextGeneration: string
    probeSkipProviderDisabled: string
    probeSkipNotChatModel: string
    probeSkipProtocolNotConfigured: string
    typeAll: string
    /** 价格筛选：免费 + 折扣模型（不是模型类型，但和类型 pill 同一行）。 */
    typeDeal: string
    typeText: string
    typeImage: string
    typeEmbedding: string
    typeRerank: string
    typeSpeech: string
    typeTranscription: string
    typeOcr: string
    typeVideo: string
    typeVision: string
    typeReasoning: string
    capabilityToolsTitle: string
    /** PLAT-77：能力来源没有上游声明标记时的说明后缀。 */
    capabilitySourceInferred: string
    /** PLAT-77：OpenAI Responses 协议支持。 */
    capabilityResponsesTitle: string

    /** PLAT-77：协议筛选（与模型类型正交的第二维度）。 */
    protocolAnthropic: string
    protocolResponses: string
    /** PLAT-81：协议筛选 pill 的短文案（4 个，恰好 4 个 pill，没有「全部协议」项）。 */
    protocolFilterChat: string
    protocolFilterResponses: string
    protocolFilterMessages: string
    protocolFilterGemini: string
    capabilityReasoningTitle: string
    capabilityVisionTitle: string
    capabilityEmbeddingTitle: string
    capabilityImageTitle: string
    capabilityVideoTitle: string
    capabilityRerankTitle: string
    capabilitySpeechTitle: string
    capabilityTranscriptionTitle: string
    capabilityOcrTitle: string
    modelsHeading: string
    /** PLAT-81：模型工具条筛选漏斗按钮（折叠/展开 pill 筛选行）。 */
    showModelFilters: string
    hideModelFilters: string
    cancel: string
    selectAll: string
    deselectAll: string
    /** 标准化模型选择器（`shell/components/ModelPicker`）：三处下拉 + `@` 面板共用同一组文案。 */
    pickerSearchPlaceholder: string
    pickerSelectModel: string
    pickerClearSelection: string
    pickerFilters: string
    pickerClearFilters: string
    pickerFilteredCount: (count: number) => string
    pickerCategoryVision: string
    pickerCategoryAudio: string
    pickerCategoryVideo: string
    pickerCategoryReasoning: string
    pickerCategoryTools: string
    pickerCategoryDeal: string
    /** 选择器列表里的价格标签；免费复用 `modelFreeTag`。 */
    pickerTagDiscount: string
    pickerEmptyNoModels: string
    pickerEmptyNoMatch: string
    /** 智能体入口没有任何 messages 模型时的空态。 */
    pickerEmptyNoMessages: string
    pickerEmptyNoMessagesHint: string
    /** 绘画入口没有任何图像生成模型时的空态。 */
    pickerEmptyNoImage: string
    pickerEmptyNoImageHint: string
    /** 有候选但全被「已下线」过滤掉。 */
    pickerEmptyRetiredOnly: string
    pickerConfigureCustomModel: string
    /** 已保存的值不满足 messages 约束：保留回显 + 建议更换（不清空）。 */
    pickerMessagesHint: (model: string) => string
    /** 已保存的值不是图像模型：同上。 */
    pickerImageHint: (model: string) => string
    /** 其余不满足约束的旧值：同上。 */
    pickerConstraintHint: (model: string) => string
    /** 已保存的值属于已停用厂商：回显 + 提示，不静默清空。 */
    pickerProviderDisabledHint: (model: string) => string
      connectionCheckTitle: string
      connectionCheckModel: string
      connectionCheckApiKey: string
      connectionCheckStart: string
      connectionCheckOrdinaryChat: string
      /** PLAT-63 第二阶段 A：Gemini 原生端点 lane 标题。 */
      connectionCheckGeminiNative: string
      connectionCheckDirect: string
      connectionCheckGateway: string
      connectionCheckFinal: string
      connectionCheckAgentReady: string
      connectionCheckAgentNotReady: string
      connectionCheckAgentMixed: string
      /** PLAT-62：智能体结论只看 Claude Code 直连/网关；普通聊天另给「助手可用」说明。 */
      connectionCheckAgentUsableDirect: string
      connectionCheckAgentUsableGateway: string
      connectionCheckAssistantUsable: string
      connectionCheckGatewayRequired: string
      connectionCheckProbeTimeout: string
      connectionCheckAgentUnconfirmedTimeout: string
      connectionCheckOptionalRuntimeDisabled: string
      connectionCheckOptionalGatewayDisabled: string
      connectionSucceeded: string
      connectionFailed: string
      connectionReady: string
      connectionNeedsConfig: string
      noChatModelForConnectionCheck: string
      connectionCheckProviderStatus: string
      connectionCheckStatusEnabled: string
      connectionCheckStatusDisabled: string
      connectionCheckEnableProvider: string
      connectionCheckDetailPrefix: string
      connectionCheckIrrelevantHint: string
      connectionCheckReasonProviderDisabled: string
      connectionCheckReasonMissingApiKey: string
      connectionCheckReasonUnauthorized: string
      connectionCheckReasonDns: string
      connectionCheckReasonRefused: string
      connectionCheckReasonTimeout: string
      connectionCheckReasonTls: string
      connectionCheckReasonProxy: string
      connectionCheckReasonModelNotFound: string
      connectionCheckReasonHttp: (status: number) => string
      connectionCheckReasonForbidden: string
      connectionCheckReasonNotFound: string
      connectionCheckReasonServerError: string
      connectionCheckReasonInvalidResponse: string
      connectionCheckReasonUnknown: string
      connectionCheckReasonRateLimited: string
      connectionCheckReasonProtocolUnsupported: string
      connectionCheckReasonProtocolUnsupportedHint: string
      connectionCheckReasonModelRetired: string
      connectionCheckAgentNeedsAnthropicEndpoint: string
      connectionCheckAgentNeedsAnthropicEndpointHint: string
      connectionCheckReasonModelUnavailable: string
      connectionCheckReasonGeminiNativeMissing: string
      connectionCheckReasonAccountBalance: string
      connectionCheckReasonGatewayDisabled: string
      connectionCheckReasonModelRuntimeDisabled: string
      connectionCheckGatewayDisabledHint: string
      connectionCheckEnableModelGateway: string
      connectionCheckEnvironment: string
      connectionCheckProxy: string
      connectionCheckProxyDirect: string
      connectionCheckProxySystem: string
      connectionCheckProxyCustom: string
      connectionCheckTargetHost: string
      connectionCheckNetworkDiagnosis: string
      connectionCheckNetworkDiagnosisNone: string
      connectionCheckProxyNote: string
      connectionCheckNetworkFailureHint: (mode: string) => string
      connectionCheckCustomProxyFailureHint: (host: string) => string
      connectionCheckOpenProxySettings: string
      fetchModelsFailed: string
      retry: string
      modelSyncReasonNetwork: string
      modelSyncReasonInvalidBaseUrl: string
      modelSyncReasonProviderNotFound: string
      modelSyncReasonModelListUnsupported: string
      modelSyncReasonUnknown: string
      runtimeNotEnabledHint: string
      modelSyncNeedsApiKey: string
      modelSyncInProgress: string
    models: string
    modelId: string
    modelName: string
    addModel: string
    editModel: string
    saveModel: string
    removeModel: string
    pinModel: string
    unpinModel: string
    /** 模型抽屉：手动把模型标记为免费（只影响筛选/展示，不改价格）。 */
    freeModel: string
    freeModelHint: string
    /** 价格为 0 时开关锁定，解释为什么不能关。 */
    freeModelAutoHint: string
    /** 模型行与选择器列表共用的「免费」徽章。 */
    modelFreeTag: string
    noModels: string
    ungroupedModels: string
    syncModels: string
    modelSyncTitle: string
    modelSyncAdded: string
    modelSyncMissing: string
    /** PLAT-63 C：第三组「本地多余（预设已变更）」。 */
    modelSyncLocalSurplus: string
    modelSyncLocalSurplusHint: string
    /** 模型计数旁的归档提示（不自动删除）。 */
    modelSyncStaleHint: (count: number) => string
    modelSyncApply: string
    modelSyncApplied: string
    modelSyncAppliedSummary: (added: number, updated: number, removed: number) => string
    modelRemovedNotice: (count: number) => string
    modelsClearedToast: (count: number) => string
    modelSyncFailed: string
    modelSyncUpToDate: string
    modelSyncUpToDateHint: string
    modelSyncRemovedHint: string
    modelSyncAddSummary: string
    modelSyncRemoveSummary: string
    modelTypeCapabilities: string
    /** T4/T5：模型级聊天协议选择。 */
    modelChatProtocol: string
    chatProtocolDefault: string
    chatProtocolChatCompletions: string
    chatProtocolResponses: string
    chatProtocolGemini: string
    /** PLAT-69：Anthropic Messages（`/v1/messages`）。 */
    chatProtocolMessages: string
    chatProtocolEndpointMissing: string
    chatProtocolToolHint: string
    agentProtocolSupport: string
    chat: string
    vision: string
    embedding: string
    tools: string
    reasoning: string
    imageGeneration: string
    videoGeneration: string
    rerank: string
    speech: string
    transcription: string
    ocr: string
    claudeCodeAgent: string
    openaiAgents: string
    newProviderName: string
  }
  preferences: {
    language: string
    displayStyle: string
    accentColor: string
    timeZone: string
    timeZoneFollowSystem: string
    timeZoneSearch: string
    timeZoneUnavailable: string
    proxyMode: string
    proxyAddress: string
    proxyBypassRules: string
    proxyRequestHint: string
    proxySelfTest: string
    proxySelfTestRunning: string
    proxySelfTestPassed: (status: number, seconds: string, proxy: string) => string
    proxySelfTestFailed: (code: string, host: string) => string
    proxyAddressPlaceholder: string
    proxyBypassPlaceholder: string
    proxySystem: string
    proxyCustom: string
    proxyNone: string
    chinese: string
    english: string
    system: string
    light: string
    dark: string
    lime: string
    cyan: string
    violet: string
  }
  notifications: {
    channelsDescription: string
    scopeNote: string
    centerEnabled: string
    centerDescription: string
    desktopEnabled: string
    desktopDescription: string
    toastEnabled: string
    toastDescription: string
    popupEnabled: string
    popupDescription: string
    channelsHeading: string
  }
  webSearch: {
    title: string
    subtitle: string
    general: string
    searchProviders: string
    fetchProviders: string
    defaultBadge: string
    defaultCapabilities: string
    defaultCapabilitiesHint: string
    defaultCapabilitiesMovedHint: string
    deferredBadge: string
    moreProviders: (count: number) => string
    railNoteTitle: string
    railGroupsHint: string
    railNote: string
    enabled: string
    disabled: string
    providerSettings: string
    generalSettings: string
    searchWithDate: string
    searchWithDateHint: string
    maxResults: string
    maxResultsHint: string
    defaultSearchProvider: string
    defaultSearchProviderHint: string
    defaultFetchProvider: string
    defaultFetchProviderHint: string
    summaryDefaultSearch: string
    summaryFetch: string
    summaryMaxResults: string
    summaryResultUnit: string
    summaryCutoff: string
    summaryBlacklist: string
    summaryBlacklistUnit: string
    summaryWithDate: string
    summaryOn: string
    summaryOff: string
    /* PLAT-60 · 策略 / 供应商 两个维度 */
    policyTab: string
    providersTab: string
    savePolicy: string
    defaultProvidersSection: string
    defaultProvidersHint: string
    defaultSearchRow: string
    defaultFetchRow: string
    resultsSection: string
    providerOptionReason: (name: string, reason: string) => string
    optionMissingKey: string
    providerFiltersAll: (count: number) => string
    providerFilterSearch: string
    providerFilterFetch: string
    providerFilterDisabled: (count: number) => string
    providerTableName: string
    providerTableCapabilities: string
    providerTableStatus: string
    providerTableDefault: string
    providerTableCredentials: string
    defaultSearchBadge: string
    defaultFetchBadge: string
    defaultReadonlyHint: string
    credentialKeySaved: (count?: number) => string
    credentialKeyMissing: string
    credentialBasicSaved: string
    credentialBasicMissing: string
    credentialNone: string
    configureProvider: string
    deferredProviderHint: string
    drawerTitle: (name: string) => string
    drawerDefaultHint: string
    toggleImmediateHint: string
    builtinApiHost: string
    capabilityJoin: string
    searchUnavailableDisabled: string
    searchUnavailableMissingKey: string
    fetchUnavailableDisabled: string
    fetchUnavailableMissingKey: string
    compression: string
    compressionMethod: string
    compressionMethodHint: string
    compressionNone: string
    compressionCutoff: string
    compressionRagDeferred: string
    cutoffLimit: string
    cutoffLimitHint: string
    cutoffUnit: string
    cutoffChars: string
    cutoffTokens: string
    compressionEffect: (limit: number, unit: string) => string
    blacklist: string
    blacklistDomains: string
    blacklistPlaceholder: string
    blacklistHint: string
    removeTag: (tag: string) => string
    subscriptionsDeferred: string
    apiKey: string
    getApiKey: string
    docs: string
    fetchApiHostNote: string
    apiKeyRequiredHint: string
    invalidApiKeyError: (status: number) => string
    missingApiKey: string
    apiKeyPlaceholder: string
    savedApiKeyPlaceholder: string
    savedApiKeyMaskHint: string
    savedKeyLength: (count: number) => string
    invalidApiKeyWithLength: (status: number, count: number) => string
    invalidApiKeyCheckHint: string
    providerResponseInvalid: string
    noApiKeyHint: string
    showApiKey: string
    hideApiKey: string
    replaceApiKey: string
    editApiKey: string
    clickToReplace: string
    revealApiKeyFailed: string
    revealApiKeyUnavailable: string
    revealApiKeyBridgeFailed: string
    revealApiKeyMissing: string
    retry: string
    apiKeyRevealedHint: string
    removeApiKey: string
    removeApiKeyConfirm: string
    removeApiKeyConfirmAction: string
    cancel: string
    apiHost: string
    engines: string
    enginesPlaceholder: string
    basicAuthUsername: string
    basicAuthPassword: string
    enableProvider: string
    checkProvider: string
    checkingProvider: string
    checkSucceeded: string
    checkFailed: string
    saveProvider: string
    saveKeyAndAdvanced: string
    savedImmediately: (enabled: boolean) => string
    unsavedChanges: string
    saveFailed: string
    toggleSaveFailed: string
    defaultSaveFailed: string
    saveSettings: string
    saved: string
    unsaved: string
    loadFailed: string
    noProviders: string
    providerDisabledHint: string
    currentInternetOnly: string
    capabilitySearchKeywords: string
    capabilityFetchUrls: string
    capabilitySearchShort: string
    capabilityFetchShort: string
    endpoint: string
    phaseAvailable: string
    phaseAvailableHint: string
    phaseDeferred: string
  }
  storageCache: {
    title: string
    subtitle: string
    loading: string
    refresh: string
    dryRun: string
    dryRunHint: string
    metaSummary: (caches: number, size: string, clearable: number, sensitive: number) => string
    columnName: string
    columnSize: string
    columnRecords: string
    columnStatus: string
    columnUpdated: string
    columnActions: string
    clear: string
    compact: string
    recheck: string
    recheckFailed: string
    flagSensitive: string
    filterEmpty: string
    noCaches: string
    emptyValue: string
    ownerPlatform: string
    ownerProduct: (productId: string) => string
    tabAll: string
    tabPlatform: string
    tabAiRuntime: string
    tabProducts: string
    tabDerivedData: string
    categoryPlatform: string
    categoryAiRuntime: string
    categoryProduct: string
    categoryDerivedData: string
    statusReady: string
    statusEmpty: string
    statusActive: string
    statusInspectionFailed: string
    statusSucceeded: string
    statusFailed: string
    statusSkipped: string
    neverInspected: string
    fieldKind: string
    fieldDurability: string
    fieldSensitivity: string
    fieldLastUpdated: string
    fieldRecordCount: string
    fieldSize: string
    fieldWarnings: string
    fieldBackupPolicy: string
    operationSuccess: string
    operationFailed: string
    confirmClear: (name: string) => string
    confirmCompact: (name: string) => string
    confirmSensitiveClear: string
    confirmSensitiveCompact: string
    confirmDerivedWarning: string
    confirmDryRunHint: string
    historyTitle: string
    historyEmpty: string
    historyColumnCache: string
    historyColumnOperation: string
    historyColumnResult: string
    historyColumnTime: string
    historyDryRun: string
    operationClear: string
    operationCompact: string
    operationInvalidate: string
    backupExclude: string
    backupInclude: string
    backupMetadataOnly: string
    toastCleared: (name: string, dryRun: boolean) => string
    toastCompacted: (name: string, dryRun: boolean) => string
    toastSkipped: (name: string) => string
    kindMemory: string
    kindRuntimeHandle: string
    kindJsonFile: string
    kindSqliteDerived: string
    kindLocalStorage: string
    kindParquetPartition: string
    durabilitySessionOnly: string
    durabilityPersistedDerived: string
    durabilityRebuildable: string
    durabilityUserDataLike: string
    sensitivityNone: string
    sensitivityContainsUserContent: string
    sensitivityContainsSecretRef: string
  }
}

export const platformText: Record<AppLanguage, PlatformText> = {
  'zh-CN': {
    brand: {
      title: 'AI Desktop',
      subtitle: '基础工作台'
    },
    nav: {
      workspace: '工作台',
      chat: '聊天',
      assistants: '助手',
      agents: '智能体',
      data: '数据',
      docs: '文档',
      settings: '设置'
    },
    status: {
      productLoaded: '个产品已加载',
      productsLoaded: '个产品已加载',
      loading: '加载中',
      saved: '已保存',
      failed: '保存失败'
    },
    workspace: {
      eyebrow: 'Electron 壳已运行',
      title: 'Hello World',
      copy: '桌面基础壳已经具备主进程、preload 桥、IPC、菜单、托盘和 React 工作区。',
      loadedProducts: '已加载产品',
      manifestDriven: 'Manifest 驱动',
      runtime: '运行时',
      preloadApi: 'Preload API',
      app: '应用',
      theme: '主题',
      node: 'Node',
      chrome: 'Chrome',
      tools: '工具',
      skills: '技能',
      agents: '智能体',
      contributionLoadFailed: '页面加载失败',
      panelActions: '面板操作', panelClose: '关闭面板', panelReopen: '重新打开面板', panelEmbedded: '嵌入页面',
      panelDockRight: '停靠右侧', panelDockBottom: '停靠底部', panelDetach: '分离窗口', panelResetSize: '恢复默认尺寸',
      panelUnsupported: '当前空间不足', panelFallback: '面板', panelResize: '调整面板大小', panelInspector: '检查器', inspectorTitle: '检查器',
      inspectorDraft: '检查器草稿', inspectorSelection: '检查器选择', inspectorSelect: '选择检查项', inspectorSelected: '已选择',
      panelModeUnsupported: '此面板不支持该位置', panelCapabilityMissing: '当前版本不支持此能力', panelReturnToPage: '返回页面',
      panelShowPanel: '显示面板', panelCommandRejected: '操作被拒绝，面板状态未改变', panelCommandFailed: '操作失败，请重试',
      panelHandoffUnsaved: '面板还有未保存内容，已取消关闭', panelHandoffSensitive: '面板包含敏感草稿，已取消关闭',
      panelHandoffUnsupported: '当前版本不支持内容交接，已取消关闭',
      windowHostUnavailableTitle: '工作区窗口不可用', windowHostUnavailableContext: '未取得宿主上下文，已停止加载窗口内容',
      windowHostUnavailablePanel: '当前窗口没有可承载的面板', windowHostUnavailableHint: '请回到主窗口重试，或重启应用',
      windowPreparingDetail: '正在把面板移入本窗口，请稍候', windowPanelPlaceholder: '此面板内容尚未接线',
      tabStrip: '工作区标签', tabClose: '关闭标签', tabOpenPage: '打开页面', tabActions: '标签操作', tabCloseOthers: '关闭其他标签',
      tabCloseRight: '关闭右侧标签', tabReopen: '重开最近关闭的标签', tabReopenUnavailable: '没有最近关闭的标签',
      tabCloseUnavailable: '当前没有活动标签', tabCloseOthersUnavailable: '没有其他标签可关闭', tabCloseRightUnavailable: '右侧没有标签可关闭',
      tabPageMissing: '页面不可用', tabEmptyTitle: '当前没有打开的页面', tabEmptyHint: '从顶部标签栏打开一个页面开始工作',
      tabCommandRejected: '操作被拒绝，工作区布局未改变', tabCommandFailed: '操作失败，请重试',
      tabDetach: '分离到新窗口', tabDetachUnavailable: '当前没有可分离的标签',
      tabDetachUnsupported: '该页面不支持分离到新窗口', tabDetachAlreadyDetached: '该标签已在独立窗口中',
      tabDetachLimitReached: '独立窗口数量已达上限，请先把其中一个窗口回停靠',
      pageWindowRedock: '回停靠到主窗口',
      panelWindowRedock: '回停靠到主窗口',
      panelWindowRedockFailed: '回停靠失败，请重试或点击窗口关闭按钮',
      draftGateTitle: '有未保存的草稿', draftGateSensitive: '此设置表单里有敏感草稿（API Key）。请先保存、明确丢弃或取消离开。',
      draftGateUnsaved: '此页面有未保存的草稿。请先保存、明确丢弃或取消离开。',
      draftGateSave: '保存并离开', draftGateDiscard: '丢弃并离开', draftGateCancel: '取消',
      draftGateSaveFailed: '保存失败：窗口保持打开，草稿已保留', draftGateHint: '草稿不会被写入工作区布局。'
    },
    settings: {
      modelService: '模型服务',
      assistantLibrary: '助手库',
      webSearch: '网页搜索',
      storageAndCache: '存储与缓存',
      taskAutomation: '任务自动化',
      basicSettings: '基础设置',
      notifications: '通知', channels: '通道', channelCreate: '创建通道', channelRefresh: '刷新', channelPlanned: '等待适配器发布', channelRunning: '运行中', channelDisable: '停用', channelRestart: '重启', channelCredentialConfigured: '凭据已配置', channelCredentialMissing: '凭据缺失', channelCredentialUnavailable: '凭据不可用', channelSaveCredential: '保存凭据', channelNoInstances: '尚无通道实例', channelName: '名称', channelAgentId: 'Agent ID', channelCredential: 'Bot Token', channelAppCredential: 'App Token', channelLarkAppId: '飞书 App ID', channelLarkAppSecret: '飞书 App Secret', channelQqAppId: 'QQ App ID', channelQqClientSecret: 'QQ Client Secret', channelDiscordBotToken: 'Discord Bot Token', channelWechatEnrollment: '微信二维码授权（等待协议冻结）', channelDelete: '删除', channelPolicy: '访问策略', channelPolicyCreate: '添加策略', channelPolicySubject: { user: '用户', conversation: '会话' }, channelTarget: '投递目标', channelUpdate: '保存更改', channelEnable: '请求启用', channelEnableBlocked: '等待适配器支持证据', channelAdapterUnavailable: '适配器尚未实现，暂不接收凭据', channelCandidates: '待授权会话', channelCandidatesEmpty: '当未授权的用户/群发消息时会出现在这里', channelCandidateUnknown: '未知用户', channelCandidateAllow: '允许', channelCandidateIgnore: '忽略', channelDeleteConfirm: '删除通道会断开连接并清理本地密钥引用，确认继续？', channelCancel: '取消', channelRuntimeGeneration: '运行代际', channelRuntimeLifecycle: '运行状态', channelCatalogStatus: { planned: '计划中', blocked: '已阻止', supported: '证据完备' }, channelConversationKind: { direct: '私聊', group: '群组', channel: '频道' }, channelState: { 'credential-missing': '凭据缺失', 'configuration-ready': '配置就绪', disabled: '已停用', deleting: '正在删除', 'runtime-ready': '运行就绪' }
    },
    taskAutomation: {
      title: '任务自动化', subtitle: '平台任务、投递健康与变更审计。', refresh: '刷新', retry: '重试', emptyValue: '—',
      deliveryHealth: '投递健康', healthUpdated: (time) => `最近更新 ${time}`,
      healthEmpty: '暂无投递记录。任务开始运行后，这里会显示成功、失败与跳过计数。',
      scheduledTaskDelivery: '我的定时任务投递',
      resourceJobRuns: '资源任务最近一次运行',
      resourceJobRunsEmpty: '当前没有已注册的资源任务。',
      healthScopeNote: '投递=定时任务把消息投递到通道/通知；运行=产品资源任务最近一次执行。两者口径不同，分别统计。',
      myTasks: '我的定时任务',
      columns: { name: '名称', status: '状态', schedule: '调度', nextRun: '下次运行', lastResult: '最近结果', actions: '操作', source: '来源', registration: '注册状态', lastRun: '最近运行' },
      all: '全部', searchTasks: '搜索任务名称', tasksLoading: '正在加载定时任务…', tasksLoadFailed: '定时任务加载失败。', loadMore: '加载更多',
      filterEmpty: '当前筛选下没有任务。', clearFilters: '清除筛选',
      emptyTasksTitle: '还没有定时任务',
      emptyTasksBody: '在对话里对助手说「每天早上 9 点总结行情」，就会在这里出现一条定时任务；你也可以随时暂停或查看它的投递健康。',
      status: { active: '运行中', paused: '已暂停', completed: '已完成' },
      outcome: { success: '成功', failed: '失败', skipped: '已跳过', never: '从未运行' },
      details: '详情', collapse: '收起', taskDeliveryHealth: '本任务投递健康', recentChanges: '最近变更', noChanges: '暂无变更记录。',
      delivered: '已投递', failed: '失败', pending: '待投递', skipped: '已跳过', unknown: '未知',
      auditAccepted: '已接受', auditRejected: '已拒绝',
      auditAction: { create: '创建', update: '更新', pause: '暂停', resume: '恢复', delete: '删除', 'run-now': '立即运行', 'cancel-run': '取消运行', 'runtime-transition': '运行时状态变更', 'channel-delete-cleanup': '清理投递通道' },
      resourceJobs: '平台与产品资源任务', resourceLoading: '正在加载资源任务…', resourceLoadFailed: '资源任务加载失败。',
      resourceBridgeMissing: '缺少接口，应用可能未重启；请重启应用后重试。', resourceLoadTimeout: '读取资源任务超时，请重试。',
      resourceEmptyTitle: '当前没有产品注册自动任务',
      resourceEmptyBody: '启用某个产品的自动采集能力后，这里会显示它的调度、注册状态、下次运行与最近一次结果。未注册 ≠ 出错，通常代表该能力未启用。',
      resourceNote: '「未注册」表示该产品当前没有把它的调度注册进平台；通常意味着该能力未启用。本页只读，启用/停用在对应产品里操作。',
      allSources: '全部来源', allStatuses: '全部状态', platform: '平台', product: '产品', registered: '已注册', notRegistered: '未注册',
      resourceCount: (total, filtered) => `共 ${total} 项 · 筛选后 ${filtered} 项`,
      resourceCountWithPage: (total, filtered, page, pages) => `共 ${total} 项 · 筛选后 ${filtered} 项 · 第 ${page}/${pages} 页`,
      resourcePageSize: '每页', resourcePrevPage: '上一页', resourceNextPage: '下一页',
      resourcePageIndicator: (page, pages) => `第 ${page} / ${pages} 页`,
      schedule: {
        everySeconds: (count) => `每 ${count} 秒`,
        everyMinutes: (count) => `每 ${count} 分钟`,
        everyHours: (count) => `每 ${count} 小时`,
        cron: (expression) => `Cron ${expression}`,
        onceAt: (time) => `一次 · ${time}`,
        manual: '手动',
        startup: '启动时',
        event: (topic) => `事件 · ${topic}`
      },
      policy: '执行策略', balanced: '平衡', conservative: '保守',
      policyCurrent: '当前策略', policyExplanation: '影响自动化的带宽门槛：并发上限、最短调度间隔、单次运行超时。',
      policyConcurrencyLimit: '并发上限', policyConcurrencyValue: (count) => `${count} 个任务并行`,
      policyMinInterval: '最短调度间隔', policyTimeout: '单次运行超时', policyTimeoutValue: (minutes) => `${minutes} 分钟`,
      policyLoading: '正在加载策略…', policyLoadFailed: '策略加载失败',
      policyEmptyNote: '当前没有自动任务，策略会在任务开始运行后生效。'
    },
    assistants: {
      title: '助手',
      assistants: '助手',
      topics: '话题',
      addAssistant: '添加助手',
      newTopic: '新话题',
      noAssistant: '未选择助手',
      noTopics: '暂无话题',
      defaultAssistant: '平台默认助手',
      selectTopic: '选择一个话题开始聊天',
      emptyChat: '发送第一条消息开始对话',
      startConversation: '输入消息开始新话题',
      inputPlaceholder: '输入消息，Enter 发送，Shift+Enter 换行',
      send: '发送',
      stop: '停止',
      streaming: '生成中',
      imageGenerate: '生成图片',
      imageGenerateTooltipDisabled: '未配置图像生成端点',
      imagePromptPlaceholder: '描述要生成的图片…',
      imageSize: '尺寸',
      imageCount: '数量',
      imageGenerateAction: '生成',
      imageGenerating: '图片生成中…',
      imageDownload: '下载',
      imagePreview: '预览图片',
      imagePromptRequired: '请输入图片描述',
      imageFailureInvalidCount: '数量需为 1–4',
      imageFailureInvalidSize: '尺寸只支持 256x256 / 512x512 / 1024x1024',
      imageFailureTooLarge: '生成的图片超过 2MB 上限',
      imageFailureNoEndpoint: '未配置图像生成端点',
      imageFailureInvalidRequest: '图像生成参数不合法',
      imageFailureModelNotFound: '该图像模型不可用',
      imageFailureInvalidResponse: '图像服务返回了无法识别的响应',
      imageEdit: '编辑图片',
      imageEditTooltipDisabled: '未配置图像编辑端点',
      imageEditPromptPlaceholder: '描述要如何修改这张图片…',
      imageEditAction: '开始编辑',
      imageEditSourceTitle: '原图',
      imageEditSourceSession: '从本会话的图片中选择',
      imageEditSourceUpload: '上传图片',
      imageEditSourceRequired: '请选择或上传一张原图',
      imageEditGenerating: '正在编辑图片…',
      imageFailureSourceTooLarge: '原图超过 4MB 上限',
      imageFailureSourceTypeUnsupported: '原图只支持 PNG / JPEG / WebP',
      imageFailureSourceMissing: '原图已不存在，请重新选择',
      imageFailureTopicMissing: '请先创建或选择一个话题',
      pendingMessage: '等待回复',
      generationStopped: '生成已停止',
      modelNotReady: '请先在设置中启用模型服务并配置 API Key',
      hideTopics: '隐藏侧栏',
      showTopics: '显示侧栏',
      deleteMessage: '删除消息',
      copyMessage: '复制消息',
      editMessage: '编辑消息',
      regenerate: '重新生成',
      resendEdited: '发送编辑',
      deleteConversation: '删除会话',
      deleteConversationConfirm: (name) => `确定删除会话“${name}”吗？此操作会删除其中的所有消息。`,
      moreConversationActions: '更多会话操作',
      conversationOperationFailed: '会话操作未完成，请重试。',
      modelRetired: '该模型已下线，请更换模型。',
      modelNotActivated: '该模型未开通，请到供应商控制台开通。',
      modelNotFound: '该模型不存在或已下线，请更换模型。',
      cancel: '取消',
      previousSibling: '上一条分支',
      nextSibling: '下一条分支',
      siblingIndex: '{current} / {total}',
      searchTopic: '搜索话题消息',
      searchResults: '搜索结果',
      assistantSettings: '助手设置',
      saveSettings: '保存设置',
      assistantName: '助手名称',
      assistantPrompt: '系统提示词',
      modelSwitchHint: '模型在助手页顶部的模型选择器里切换。',
      enableTemperature: '启用温度',
      temperature: '温度',
      streamOutput: '流式输出',
      mcpMode: 'MCP 模式',
      mcpDisabled: '禁用',
      mcpAuto: '自动',
      mcpManual: '手动',
      enableWebSearch: '启用网页搜索',
      webSearchHint: '允许此助手调用当前互联网搜索与网页读取工具。',
      contextSourcesPlaceholder: '知识库与上下文源将在后续平台能力中接入。',
      comingSoon: '即将推出',
      mentionedModels: '提及模型',
      webSearchCardTitle: '网页搜索',
      webFetchCardTitle: '网页读取',
      webSearchSources: '来源',
      webSearchRunning: '搜索中',
      webSearchFailed: '搜索失败',
      openSource: '打开来源',
      newAssistantName: (count) => `助手 ${count}`,
      followDefaultModel: (model) => `跟随默认：${model}`,
      clearMentionedModels: '清除选择',
      mentionedModelSelection: (count) => `已选择 ${count} 个模型`,
      inputbarTools: {
        attachment: '附件',
        'new-topic': '新话题',
        'clear-topic': '清空话题',
        'quick-panel': '快捷面板',
        'mcp-tools': 'MCP 工具',
        'web-search': '网页搜索',
        'context-source': '上下文源'
      },
      library: {
        title: '助手库',
        searchPlaceholder: '搜索助手、提示词或标签',
        importExternal: '外部导入',
        manageAssistants: '管理助手',
        createAssistant: '创建助手',
        install: '安装',
        installed: '已安装',
        updateAvailable: '有更新',
        sourcePlatform: '平台',
        sourceProduct: (name) => `产品：${name}`,
        productGroupsTitle: '产品助手',
        detailPromptTitle: '提示词',
        addToAssistant: '添加到助手',
        emptyTitle: '没有匹配的助手',
        emptyDescription: '换个分类或关键词再试。',
        importTitle: '导入助手',
        importJson: 'JSON 内容',
        importJsonPlaceholder: '粘贴助手 JSON',
        importFile: '选择文件',
        importClipboard: '从剪贴板读取',
        importUrlDisabled: 'URL 导入需要主进程代理能力，当前版本暂不开放。',
        importSubmit: '导入',
        importSuccess: (count) => `已导入 ${count} 个助手`,
        importFailed: '导入失败，请检查 JSON 格式。',
        createTitle: '创建助手',
        icon: '图标',
        name: '名称',
        namePlaceholder: '输入助手名称',
        prompt: '提示词',
        promptPlaceholder: '输入系统提示词',
        promptGenerate: '提示词生成稍后接入',
        tokenCount: (count) => `约 ${count} token`,
        knowledgeBase: '知识库',
        knowledgeBaseDisabled: '知识库将在后续平台能力中接入。',
        cancel: '取消',
        create: '创建',
        required: '请填写名称和提示词',
        created: '助手已创建',
        installedMessage: '模板已安装为可编辑助手',
        groups: {
          mine: '我的',
          featured: '精选',
          career: '职业',
          business: '商业',
          tools: '工具',
          language: '语言',
          office: '办公',
          general: '通用',
          writing: '写作',
          programming: '编程',
          emotional: '情感',
          education: '教育',
          creative: '创意',
          academic: '学术',
          design: '设计',
          art: '艺术',
          entertainment: '娱乐',
          life: '生活',
          medical: '医疗',
          game: '游戏',
          translation: '翻译'
        }
      }
    },
    models: {
      providerList: '供应商',
      providerDetail: '供应商配置',
      addProvider: '新增供应商',
      searchProvider: '搜索供应商',
      searchProviderPlaceholder: '搜索模型平台…',
      addProviderAction: '添加',
      addProviderName: '供应商名称',
      addProviderNamePlaceholder: '例如 OpenAI',
      addProviderKey: 'API Key',
      addProviderKeyPlaceholder: '输入 API 密钥',
      addProviderOpenAiBase: 'OpenAI Base URL',
      addProviderAnthropicBase: 'Anthropic Base URL',
      addProviderBasePlaceholder: 'https://example.com',
      addProviderPreset: '从预设创建（可选）',
      addProviderPresetPlaceholder: '选择预设自动填充',
      addProviderDuplicate: (name) => `已存在同名供应商「${name}」`,
      addProviderInvalidBase: '请输入合法的 Base URL',
      providerContextOpen: '打开',
      providerContextEnable: '启用',
      providerContextDisable: '停用',
      providerContextDelete: '删除',
      providerContextSystem: '系统',
      removeProviderConfirm: (name) => `确定删除「${name}」吗？此操作不可撤销，将同时清除其 API Key 与模型列表。`,
      systemProviderCannotDelete: '系统供应商不可删除',
      noMatchedProviders: '没有匹配的供应商',
      noMatchedModels: '没有匹配的模型',
      systemProvider: '系统',
      customProvider: '自定义',
      systemProviderHint: '系统供应商保留在列表中',
      noProviders: '还没有模型供应商',
      apiKey: 'API Key',
      apiKeyPlaceholder: '粘贴 API Key（必填）',
      savedApiKeyPlaceholder: '已保存 API Key，重新输入可替换',
      savedApiKeyMaskHint: '点击输入框即可替换；眼睛查看已保存的 Key（30 秒后自动隐藏）。',
      revealApiKeyFailed: '读取已保存的 Key 失败，请重试。',
      getApiKey: '获取密钥',
      modelCatalog: '模型',
      multipleApiKeysHint: '多个密钥使用逗号分隔',
      showApiKey: '显示密钥',
      hideApiKey: '隐藏密钥',
      enabled: '启用',
      providerEnabled: '已启用',
      providerDisabled: '未启用',
      providerCategories: {
        relay: '中转聚合站',
        domestic: '国内站',
        international: '国际站',
        local: '本地与自托管',
        gateway: '自建网关'
      },
      collapseProviderGroup: '折叠分组',
      expandProviderGroup: '展开分组',
      enabledProviders: '已启用',
      recommendedProviders: '推荐',
      reachabilityDirect: '国内直连',
      reachabilityProxy: '需代理',
      mainlandProxyNotice: '中国大陆用户需通过代理访问此服务。',
      apiEndpoint: 'API 地址',
      agentRuntimeCompatibility: '智能体兼容性',
      saveProvider: '保存',
      removeProvider: '删除',
      testConnection: '检测',
      enableSwitchTitle: '启用/停用（点一下立即生效）',
      providerConsole: '供应商控制台',
      // 模型数量紧挨着下方就有「模型 N」，可达性另有「需代理」徽章 —— 这一行只留 host 与分类。
      providerMetaLine: (host, category) => `${host} · ${category}`,
      providerMoreActions: '更多操作',
      advancedSettings: '高级设置',
      getApiKeyHere: '点击这里获取密钥',
      getKeyFromConsole: '打开控制台获取密钥',
      anthropicEndpoint: 'Anthropic API 地址',
      openAiEndpoint: 'API 地址（OpenAI 兼容）',
      anthropicPreviewLabel: 'Anthropic 预览：',
      chatPreviewLabel: '预览：',
      endpointOverride: '覆盖',
      endpointOverrideRisk: '修改后需与供应商协议一致，否则会出现 401/404',
      endpointNotSet: '未设置',
      fetchModelList: '获取模型列表',
      clearModels: '清空模型',
      clearModelsConfirmTitle: '清空全部模型',
      clearModelsConfirmBody: (count) =>
        `将删除 ${count} 个模型（含预设模型）。删除后不会被预设自动加回；可用「获取模型列表」重新同步。`,
      inUseModelRetired: (model) => `你正在使用的 ${model} 已下线，请更换模型。`,
      changeModel: '更换模型',
      modelSearch: '搜索模型',
      modelFilterAll: '全部',
      modelFilterMessages: '支持智能体',
      modelFilterUnknownHint: '未验证的模型不在此列表',
      detectionStatusLabel: (status) => ({
        testing: '测试中…', ok: '成功', failed: '失败', skipped: '跳过', cancelled: '已停止'
      })[status],
      detectionFailedWithReason: (reason) => `失败：${reason}`,
      detectionSkippedWithReason: (reason) => `跳过：${reason}`,
      detectionProtocolFailedTitle: (protocols) => `厂商声明支持但本次实测失败：${protocols}`,
      modelProtocolChipTitle: (protocol, source) => `${protocol} · ${source}`,
      modelProtocolChipThisRunFailed: (protocol, reason, source) =>
        `${protocol} · 本次检测失败：${reason}（${source}，失败不撤销已有结论）`,
      modelProtocolSourceDeclared: '厂商声明',
      modelProtocolSourceEndpoint: '按默认端点推断',
      modelProtocolSourceProbe: '实测通过',
      detectionProtocolCount: (passed, total) => `协议 ${passed}/${total}`,
      detectionProtocolReusedBadge: '复用联通性',
      detectModels: '检测模型',
      detectModelsCount: (count) => `将检测 ${count} 个模型`,
      detectModelsWarning: '会发送真实请求，可能产生少量费用；图片/视频/语音/转录模型会被跳过。',
      detectSessionOnly: '结果只在本会话显示，不落库。',
      detectModeConnectivity: '联通性',
      detectModeConnectivityHint: '每个模型按自己的协议发一次最小请求',
      detectModeConnectivityScope: '覆盖全部文本模型',
      detectModeProtocol: '协议支持',
      detectModeProtocolHint: '只测已录入地址的协议端点',
      detectModeProtocolScope: '仅聊天模型',
      detectProtocolSingleChannel: '该供应商只有 1 条协议可测',
      detectProtocolSummaryPassed: (models) => `协议支持：已测 ${models} 个模型，全部通过`,
      detectProtocolSummaryFailed: (models, failed) => `协议支持：已测 ${models} 个模型，${failed} 项不通`,
      detectModeRequired: '至少选择一个检测项',
      detectProgressTitle: '进度',
      detectProgress: (done, total) => `已完成 ${done}/${total}`,
      detectStartRunning: (done, total) => `检测中 ${done}/${total}`,
      detectStart: '开始',
      detectStop: '停止',
      detectStopped: '已停止',
      detectClose: '关闭',
      providerNames: {
        silicon: '硅基流动',
        tokenrhythm: '基元律动',
        zhipu: '智谱 AI',
        moonshot: '月之暗面 Kimi',
        dashscope: '阿里云百炼',
        doubao: '火山方舟 · 豆包',
        baichuan: '百川智能',
        stepfun: '阶跃星辰',
        yi: '零一万物',
        hunyuan: '腾讯混元',
        'tencent-cloud-ti': '腾讯云 TI',
        'baidu-cloud': '百度智能云',
        qiniu: '七牛云',
        mimo: '小米 MiMo',
        modelscope: '魔搭 ModelScope',
        ppio: '派欧云 PPIO',
        lanyun: '蓝耘',
        tokenhub: '腾讯云 TokenHub',
        longcat: '美团 LongCat'
      },
      modelRetiredTag: '下线',
      defaultModelAssistant: '默认助手模型',
      defaultModelAssistantHint: '新建对话时使用',
      protocolNoticeNone: (provider) =>
        `${provider} 的模型列表不返回协议支持信息。同步模型后请用「检测模型」逐模型探测，否则智能体可能选不到模型。`,
      protocolNoticeDismiss: '关闭提示',
      defaultModelAgent: '默认智能体模型',
      defaultModelAgentHint: '新建智能体时使用',
      defaultModelFast: '快速模型',
      defaultModelFastHint: '轻量任务使用',
      defaultModelTranslation: '翻译模型',
      defaultModelTranslationHint: '翻译任务使用',
      defaultModelImage: '绘画模型',
      defaultModelImageHint: '图片生成使用',
      defaultModelsShowMore: '更多默认模型设置',
      defaultModelsCollapse: '收起',
      copyModelId: '复制',
      copied: '已复制',
      nonChatModelHint: '非聊天模型不会出现在对话模型选择中',
      modelDiscountBadge: '特惠',
      apiAddress: 'API 地址',
      endpointNotConfigured: '未配置端点',
      endpointDefaultBadge: '默认',
      endpointSetDefault: '设为默认',
      endpointAdd: '添加端点',
      endpointDelete: '删除该端点',
      endpointKeepAtLeastOne: '至少保留一个端点',
      endpointKindChat: 'Chat',
      endpointKindResponses: 'Responses',
      endpointKindMessages: 'Anthropic Messages',
      endpointKindGemini: 'Gemini 原生',
      endpointActualRequestLabel: (url) => `实际请求：${url}`,
      endpointGeminiHostPlaceholder: 'https://generativelanguage.googleapis.com',
      endpointGeminiHostHint: '填 Gemini 原生主机名，不是中转站地址',
      requestConfigChatEndpoints: '聊天端点',
      requestConfigImageEndpoints: '图像',
      // 诚实文案：图像端点没有"回落到默认聊天端点"的实现（主进程要求显式地址），留空 = 不启用。
      requestConfigImageGenerationHint: '用于 /images/generations；留空则不启用图像生成',
      requestConfigImageEditHint: '用于 /images/edits；留空则不启用图像编辑',
      requestConfigImageBasePlaceholder: 'Base URL：https://example.com',
      overwrite: '覆盖',
      requestConfig: '请求配置',
      // 「默认」现在是端点行上的独立徽章（写端点清单顺序），名字里不再带默认。
      requestConfigAddEndpoint: '添加端点',
      requestConfigResponses: 'OpenAI Responses',
      requestConfigGemini: 'Gemini',
      requestConfigGeminiNative: 'Gemini（原生）',
      requestConfigImageGeneration: '图像生成',
      requestConfigImageEdit: '图像编辑',
      requestConfigAnthropicEndpoint: 'Anthropic',
      endpointTestAvailable: '可用',
      endpointTestExistsParamError: '端点存在（参数问题）',
      endpointTestExistsAuthFailed: '端点存在但鉴权失败',
      endpointTestExists: '端点存在',
      endpointTestMissing: '路径不存在',
      endpointTestUnreachable: '不可达',
      endpointTestNoModel: '未配置聊天模型，无法测试',
      endpointTestUnsupported: '暂不支持测试',
      requestConfigBaseRequired: 'Base URL 必填',
      close: '关闭',
      modelCostTitle: (context, input, output, cacheRead, currency) =>
        `上下文 ${context} · 输入 ${input}/M · 输出 ${output}/M${cacheRead === null ? '' : ` · 缓存读 ${cacheRead}/M`} · 币种 ${currency}`,
      probeReasonModelNotActivated: '该模型未对你的账号开通，请在供应商控制台开通后重试',
      probeReasonTimeout: '超时',
      probeReasonAuth: '鉴权失败',
      probeReasonRateLimit: '限流',
      probeReasonBalance: '余额不足',
      probeReasonNetwork: '网络错误',
      probeReasonHttp4xx: 'HTTP 4xx',
      probeReasonHttp5xx: 'HTTP 5xx',
      probeReasonOther: '其它错误',
      probeReasonEndpointUnsupported: '该端点不支持此协议',
      probeReasonEndpointMissing: '未配置该协议端点',
      probeReasonNetworkError: '网络错误',
      probeReasonCancelled: '已停止',
      probeSkipNonTextGeneration: '非文本生成模型',
      probeSkipProviderDisabled: '供应商未启用',
      probeSkipNotChatModel: '非聊天模型',
      probeSkipProtocolNotConfigured: '未配置协议端点',
      typeAll: '全部',
      typeDeal: '免费&折扣',
      typeText: '文本',
      typeImage: '图片',
      typeEmbedding: '嵌入',
      typeRerank: '重排',
      typeSpeech: '语音',
      typeTranscription: '转录',
      typeOcr: 'OCR',
      typeVideo: '视频',
      typeVision: '视觉',
      typeReasoning: '推理',
      capabilityToolsTitle: '支持工具调用',
      capabilitySourceInferred: '来源未标注',
      capabilityResponsesTitle: '支持 OpenAI Responses 协议',
      protocolAnthropic: 'Anthropic 协议',
      protocolResponses: 'Responses 协议',
      protocolFilterChat: 'OpenAI Chat',
      protocolFilterResponses: 'OpenAI Responses',
      protocolFilterMessages: 'Anthropic Messages',
      protocolFilterGemini: 'Gemini 原生',
      capabilityReasoningTitle: '推理模型',
      capabilityVisionTitle: '视觉模型',
      capabilityEmbeddingTitle: '嵌入模型',
      capabilityImageTitle: '图片生成',
      capabilityVideoTitle: '视频生成',
      capabilityRerankTitle: '重排（Rerank）',
      capabilitySpeechTitle: '语音合成（TTS）',
      capabilityTranscriptionTitle: '语音转写（ASR）',
      capabilityOcrTitle: 'OCR 模型',
      modelsHeading: '模型',
      showModelFilters: '展开筛选',
      hideModelFilters: '收起筛选',
      cancel: '取消',
      selectAll: '全选',
      deselectAll: '取消全选',
      pickerSearchPlaceholder: '搜索模型或厂商…',
      pickerSelectModel: '请选择模型',
      pickerClearSelection: '清除选择',
      pickerFilters: '筛选',
      pickerClearFilters: '清除筛选',
      pickerFilteredCount: (count) => `已筛选 · ${count} 个结果`,
      pickerCategoryVision: '视觉',
      pickerCategoryAudio: '音频',
      pickerCategoryVideo: '视频',
      pickerCategoryReasoning: '推理',
      pickerCategoryTools: '工具',
      pickerCategoryDeal: '折扣&免费',
      pickerTagDiscount: '折扣',
      pickerEmptyNoModels: '还没有可用模型',
      pickerEmptyNoMatch: '无匹配模型',
      pickerEmptyNoMessages: '没有支持 Messages 协议的模型',
      pickerEmptyNoMessagesHint: '请在模型服务为模型配置 Anthropic 端点，或检测模型是否支持 messages',
      pickerEmptyNoImage: '没有支持图像生成的模型',
      pickerEmptyNoImageHint: '请在模型服务配置图像生成端点',
      pickerEmptyRetiredOnly: '可用模型均已下线',
      pickerConfigureCustomModel: '配置自定义模型',
      pickerMessagesHint: (model) => `「${model}」不支持 Messages，建议更换`,
      pickerImageHint: (model) => `「${model}」不支持图像生成，建议更换`,
      pickerConstraintHint: (model) => `「${model}」不在当前可选范围，建议更换`,
      pickerProviderDisabledHint: (model) => `「${model}」所属厂商已停用，建议更换`,
      connectionCheckTitle: '连接检查',
      connectionCheckModel: '检查模型',
      connectionCheckApiKey: 'API Key',
      connectionCheckStart: '开始检查',
      connectionCheckOrdinaryChat: '普通聊天',
      connectionCheckGeminiNative: 'Gemini（原生）',
      connectionCheckDirect: 'Claude Code 直连',
      connectionCheckGateway: 'Claude Code Gateway',
      connectionCheckFinal: '智能体最终结论',
      connectionCheckAgentReady: '智能体运行时可用',
      connectionCheckAgentNotReady: '智能体运行时不可用',
      connectionCheckAgentMixed: '普通聊天可用，但智能体运行时尚未就绪',
      connectionCheckAgentUsableDirect: '智能体可用（直连 Anthropic 协议）',
      connectionCheckAgentUsableGateway: '智能体可用（经模型网关转换）',
      connectionCheckAssistantUsable: '助手可用（普通聊天通过）',
      connectionCheckGatewayRequired: '需开启模型网关后可用',
      connectionCheckProbeTimeout: '直连探测超时（模型可能较慢，请重试）',
      connectionCheckAgentUnconfirmedTimeout: '暂无法确认（直连超时）· 可重试或开启网关',
      connectionCheckOptionalRuntimeDisabled: '该模型未启用 Claude Code 运行时（可选，不影响智能体对话）',
      connectionCheckOptionalGatewayDisabled: '模型网关未开启（可选，不影响智能体对话）',
      connectionSucceeded: '连接成功',
      connectionFailed: '连接失败',
      connectionReady: '配置已就绪，可以进行真实连接测试',
      connectionNeedsConfig: '请先启用供应商并填写 API Key',
      noChatModelForConnectionCheck: '请先添加至少一个聊天模型',
      connectionCheckProviderStatus: '供应商',
      connectionCheckStatusEnabled: '已启用',
      connectionCheckStatusDisabled: '已停用',
      connectionCheckEnableProvider: '启用',
      connectionCheckDetailPrefix: '原始信息：',
      connectionCheckIrrelevantHint: '不影响普通聊天',
      connectionCheckReasonProviderDisabled: '供应商当前是停用状态，请在上方启用后重试。',
      connectionCheckReasonMissingApiKey: '还没有可用的 API Key，请先填写并保存。',
      connectionCheckReasonUnauthorized: '供应商拒绝了这把 Key（401/403），请确认 Key 有效且有该模型权限。',
      connectionCheckReasonDns: '域名解析失败，请检查 API 地址拼写、DNS 或网络。',
      connectionCheckReasonRefused: '连接被拒绝，请确认地址与端口可访问（本地服务是否已启动）。',
      connectionCheckReasonTimeout: '请求超时，请检查网络或代理。',
      connectionCheckReasonTls: 'TLS/证书校验失败，请检查证书与代理。',
      connectionCheckReasonProxy: '代理连接失败，请检查系统/自定义代理设置。',
      connectionCheckReasonModelNotFound: '模型 id 无效，或该账号没有这个模型的权限。',
      connectionCheckReasonHttp: (status) => `供应商返回 HTTP ${status}，请按状态码排查。`,
      connectionCheckReasonForbidden: '供应商拒绝访问（403），请确认这把 Key 有该模型权限。',
      connectionCheckReasonNotFound: '接口不存在（404），请检查 API 地址是否写错。',
      connectionCheckReasonServerError: '供应商服务端错误（5xx），请稍后重试。',
      connectionCheckReasonInvalidResponse: '供应商返回了无法识别的响应，请检查 API 地址或代理。',
      connectionCheckReasonUnknown: '检查失败，原因无法判定（见原始信息）。',
      connectionCheckReasonRateLimited: '供应商限流或过载，请稍后重试',
      connectionCheckReasonProtocolUnsupported: '该模型不支持 Anthropic 协议（/v1/messages）',
      connectionCheckReasonProtocolUnsupportedHint:
        '智能体/Claude Code 需要该协议：请开启模型网关做协议转换，或改用支持 messages 的模型。',
      connectionCheckReasonModelRetired: '该模型已下线（供应商已停止提供），请改用其它模型',
      connectionCheckAgentNeedsAnthropicEndpoint: '该供应商未配置 Anthropic 端点，智能体运行时不可用',
      connectionCheckAgentNeedsAnthropicEndpointHint: '不影响普通聊天；需要智能体请配置 Anthropic 端点或开启模型网关。',
      connectionCheckReasonModelUnavailable: '该模型当前无可用渠道（可能未开通或渠道故障）',
      connectionCheckReasonGeminiNativeMissing: '未配置 Gemini 原生端点，请在上方「API 地址」填写主机名（如 https://generativelanguage.googleapis.com）。',
      connectionCheckReasonAccountBalance: '账户余额/额度不足，请到供应商控制台充值',
      connectionCheckReasonGatewayDisabled: '模型网关未启用',
      connectionCheckReasonModelRuntimeDisabled: '该模型未启用 Claude Code 运行时',
      connectionCheckGatewayDisabledHint: '开启后才能用 Claude Code 网关路由；不影响普通聊天',
      connectionCheckEnableModelGateway: '开启网关',
      connectionCheckEnvironment: '环境',
      connectionCheckProxy: '代理',
      connectionCheckProxyDirect: '直连（未使用代理）',
      connectionCheckProxySystem: '跟随系统',
      connectionCheckProxyCustom: '自定义',
      connectionCheckTargetHost: '目标 Host',
      connectionCheckNetworkDiagnosis: '网络诊断',
      connectionCheckNetworkDiagnosisNone: '本次检查没有归类到网络类失败。',
      connectionCheckProxyNote: '浏览器能打开不代表应用能连：应用请求走平台代理设置。',
      connectionCheckNetworkFailureHint: (mode) => `当前为${mode}；若浏览器能访问而应用不能，请改用自定义代理或检查系统代理。`,
      connectionCheckCustomProxyFailureHint: (host) => `已配置自定义代理但仍失败：请确认该代理能访问 ${host}（部分代理按域名分流）。`,
      connectionCheckOpenProxySettings: '去设置代理',
      fetchModelsFailed: '获取模型列表失败：',
      retry: '重试',
      modelSyncReasonNetwork: '网络错误，请检查网络或代理。',
      modelSyncReasonInvalidBaseUrl: 'API 地址无效，请检查地址格式。',
      modelSyncReasonProviderNotFound: '供应商不存在，请刷新后重试。',
      modelSyncReasonModelListUnsupported: '该供应商不支持模型列表，请手动添加',
      modelSyncReasonUnknown: '未知错误，请重试。',
      runtimeNotEnabledHint: '该模型未启用 Claude Code 运行时（可选，不影响智能体对话）',
      modelSyncNeedsApiKey: '先填写 API Key',
      modelSyncInProgress: '同步中…',
      models: '模型列表',
      modelId: '模型 ID',
      modelName: '模型名称',
      addModel: '添加模型',
      editModel: '编辑模型',
      saveModel: '保存',
      removeModel: '移除',
      pinModel: '置顶模型',
      unpinModel: '取消置顶模型',
      freeModel: '免费模型',
      freeModelHint: '仅作为筛选与展示标记，不修改价格；关闭后按价格自动判定。',
      freeModelAutoHint: '该模型价格已为 0，自动判定为免费。',
      modelFreeTag: '免费',
      noModels: '还没有模型',
      ungroupedModels: '未分组',
      syncModels: '同步模型',
      modelSyncTitle: '同步模型列表',
      modelSyncAdded: '远端新增模型',
      modelSyncMissing: '本地缺失于远端',
      modelSyncLocalSurplus: '本地多余（预设已变更）',
      modelSyncLocalSurplusHint: '这些模型已不在当前预设清单中；勾选后会从本地删除，取消勾选则保留。',
      modelSyncStaleHint: (count) => `${count} 个模型已不在当前预设中，可在「获取模型列表」里清理`,
      modelSyncApply: '应用变更',
      modelSyncApplied: '模型同步已应用',
      modelSyncAppliedSummary: (added, updated, removed) => `新增 ${added} · 更新 ${updated} · 移除 ${removed}`,
      modelRemovedNotice: (count) => `已移除 ${count} 个模型`,
      modelsClearedToast: (count) => `已清空 ${count} 个模型`,
      modelSyncFailed: '模型同步失败',
      modelSyncUpToDate: '模型已是最新',
      modelSyncUpToDateHint: '远端模型列表和本地配置没有差异',
      modelSyncRemovedHint: '以下模型在远端列表中没有返回，只有确认后才会从本地移除。',
      modelSyncAddSummary: '新增 {selected}/{total}',
      modelSyncRemoveSummary: '移除 {selected}/{total}',
      modelTypeCapabilities: '模型类型',
      modelChatProtocol: '请求协议',
      chatProtocolDefault: '默认（chat/completions）',
      chatProtocolChatCompletions: 'OpenAI Chat（chat/completions）',
      chatProtocolResponses: 'OpenAI Responses',
      chatProtocolGemini: 'Gemini 原生',
      chatProtocolMessages: 'Anthropic Messages',
      chatProtocolEndpointMissing: '未配置端点',
      chatProtocolToolHint: '非默认协议暂不支持工具调用，网页搜索在这个模型上不可用',
      agentProtocolSupport: 'Agent 协议支持',
      chat: '聊天',
      vision: '视觉',
      embedding: '嵌入',
      tools: '工具',
      reasoning: '推理',
      imageGeneration: '图片',
      videoGeneration: '视频',
      rerank: '重排',
      speech: '语音',
      transcription: '转录',
      ocr: 'OCR',
      claudeCodeAgent: 'Claude Code 智能体',
      openaiAgents: 'OpenAI Agents',
      newProviderName: '新模型供应商'
    },
    preferences: {
      language: '语言',
      displayStyle: '显示风格',
      accentColor: '强调色',
      timeZone: '时区',
      timeZoneFollowSystem: '跟随系统',
      timeZoneSearch: '搜索时区',
      timeZoneUnavailable: '无法读取系统时区，暂时按 UTC 显示。',
      proxyMode: '代理模式',
      proxyAddress: '代理地址',
      proxyBypassRules: '代理绕过规则',
      proxyRequestHint: '应用请求走这里的代理设置；浏览器能打开不代表应用能连。',
      proxySelfTest: '测试代理',
      proxySelfTestRunning: '测试中…',
      proxySelfTestPassed: (status, seconds, proxy) => `代理自检：通过（HTTP ${status}，${seconds}s，经 ${proxy}）`,
      proxySelfTestFailed: (code, host) => `代理自检：失败（${code}）· 目标 ${host}`,
      proxyAddressPlaceholder: '例如 socks5://127.0.0.1:6153',
      proxyBypassPlaceholder: 'localhost,127.0.0.1,::1',
      proxySystem: '系统代理',
      proxyCustom: '自定义代理',
      proxyNone: '不使用代理',
      chinese: '中文',
      english: 'English',
      system: '跟随系统',
      light: '浅色',
      dark: '深色',
      lime: '绿色',
      cyan: '蓝色',
      violet: '紫色'
    },
    notifications: {
      channelsHeading: '投递渠道',
      channelsDescription: '控制平台如何分发消息。这里的开关是平台级配置，会影响所有产品的通知展示方式。',
      scopeNote: '建议至少保留一个轻量渠道。桌面通知适合离开应用时接收提醒，高优先级弹窗适合需要立即处理的事件。',
      centerEnabled: '通知中心',
      centerDescription: '保留所有通知记录，便于回看系统消息与任务结果。',
      desktopEnabled: '桌面通知',
      desktopDescription: '通过系统桌面通知提醒你，不要求应用当前保持在前台。',
      toastEnabled: '应用内提示',
      toastDescription: '在应用内显示轻量横幅，适合日常运行状态与普通提醒。',
      popupEnabled: '高优先级弹窗',
      popupDescription: '为高优先级事件提供更明显的应用内弹窗提示。'
    },
    webSearch: {
      title: '网页搜索',
      subtitle: '给助手用的联网搜索与网页读取。',
      general: '通用',
      searchProviders: '搜索供应商',
      fetchProviders: '网页读取供应商',
      defaultBadge: '默认',
      defaultCapabilities: '设为默认能力',
      defaultCapabilitiesHint: '把这家的哪些能力设为默认',
      defaultCapabilitiesMovedHint: '默认能力在「通用设置」里配置。',
      deferredBadge: '未接入',
      moreProviders: (count) => `更多供应商（${count} 未接入）`,
      railNoteTitle: '说明',
      railGroupsHint: '同一供应商可同时出现在两组；「默认」按所在组的能力显示。',
      railNote: '「未接入」= 已规划、当前版本还不能用；默认供应商用于所有助手，单个助手可在其设置里覆盖。',
      enabled: '已启用',
      disabled: '未启用',
      providerSettings: '供应商设置',
      generalSettings: '通用设置',
      searchWithDate: '附加当前日期',
      searchWithDateHint: '让模型知道「今天」是哪天；不影响历史 asOf 查询',
      maxResults: '最大结果数',
      maxResultsHint: '一次搜索最多返回几条（1–10）',
      defaultSearchProvider: '默认搜索供应商',
      defaultSearchProviderHint: '单个助手可覆盖',
      defaultFetchProvider: '默认网页读取供应商',
      defaultFetchProviderHint: '抓取网页正文用',
      summaryDefaultSearch: '搜索默认',
      summaryFetch: '读取默认',
      summaryMaxResults: '最多',
      summaryResultUnit: '条',
      summaryCutoff: '截断',
      summaryBlacklist: '黑名单',
      summaryBlacklistUnit: '条',
      summaryWithDate: '附加日期',
      summaryOn: '开',
      summaryOff: '关',
      policyTab: '策略',
      providersTab: '供应商',
      savePolicy: '保存',
      defaultProvidersSection: '默认供应商',
      defaultProvidersHint: '只列「已启用」的供应商；未启用项置灰并注明原因',
      defaultSearchRow: '搜索默认',
      defaultFetchRow: '读取默认',
      resultsSection: '结果',
      providerOptionReason: (name, reason) => `${name}（${reason}）`,
      optionMissingKey: '缺 Key',
      providerFiltersAll: (count) => `全部 ${count}`,
      providerFilterSearch: '搜索',
      providerFilterFetch: '读取',
      providerFilterDisabled: (count) => `未启用 ${count}`,
      providerTableName: '名称',
      providerTableCapabilities: '能力',
      providerTableStatus: '状态',
      providerTableDefault: '默认',
      providerTableCredentials: '凭据',
      defaultSearchBadge: '搜索默认',
      defaultFetchBadge: '读取默认',
      defaultReadonlyHint: '只读：在「策略」里修改默认供应商。',
      credentialKeySaved: (count) => (count ? `Key 已保存（${count} 位）` : 'Key 已保存'),
      credentialKeyMissing: 'Key 未配置',
      credentialBasicSaved: 'Basic Auth 已保存',
      credentialBasicMissing: 'Basic Auth 未配置',
      credentialNone: '无需凭据',
      configureProvider: '配置',
      deferredProviderHint: '已规划，当前版本还不能用。',
      drawerTitle: (name) => `配置 · ${name}`,
      drawerDefaultHint: '只读：默认能力在「策略」里设置',
      toggleImmediateHint: '点一下立即生效',
      builtinApiHost: '内置地址，不可改',
      capabilityJoin: ' · ',
      searchUnavailableDisabled: '搜索不可用：默认供应商未启用',
      searchUnavailableMissingKey: '搜索不可用：缺少 API Key',
      fetchUnavailableDisabled: '网页读取不可用：默认供应商未启用',
      fetchUnavailableMissingKey: '网页读取不可用：缺少 API Key',
      compression: '内容压缩',
      compressionMethod: '方式',
      compressionMethodHint: 'RAG 压缩后续接入',
      compressionNone: '不压缩',
      compressionCutoff: '截断',
      compressionRagDeferred: 'RAG（未接入）',
      cutoffLimit: '截断长度',
      cutoffLimitHint: '超过后截断，避免把整页塞进模型',
      cutoffUnit: '截断单位',
      cutoffChars: '字符',
      cutoffTokens: 'Token',
      compressionEffect: (limit, unit) => `效果：单页正文超过 ${limit} ${unit} 时会被截断，前 ${limit} ${unit} 交给模型。`,
      blacklist: '结果黑名单',
      blacklistDomains: '域名',
      blacklistPlaceholder: '输入域名后回车，例如 example.com / *.example.com',
      blacklistHint: '命中的结果在传给模型前被过滤',
      removeTag: (tag) => `删除 ${tag}`,
      subscriptionsDeferred: '订阅源同步是后续能力，当前版本仅保留设置结构。',
      apiKey: 'API Key',
      getApiKey: '获取 API Key',
      docs: '文档',
      fetchApiHostNote: '内置直连抓取，无需填写地址',
      apiKeyRequiredHint: '必填，用于鉴权',
      invalidApiKeyError: (status) => `API Key 无效或已过期（${status}）`,
      missingApiKey: 'API Key 缺失或无效',
      apiKeyPlaceholder: '粘贴 API Key（必填）',
      savedApiKeyPlaceholder: '已保存 API Key，留空则保留',
      savedApiKeyMaskHint: '完整 Key 不会显示（安全策略）；如需更换请重新输入。',
      savedKeyLength: (count) => `已保存（${count} 位）`,
      invalidApiKeyWithLength: (status, count) =>
        `API Key 无效或已过期（${status}）· 当前已保存 ${count} 位，请确认完整复制`,
      invalidApiKeyCheckHint: '请确认完整复制（Jina/Tavily 的 Key 较长），或先重新生成再粘贴。',
      providerResponseInvalid: '供应商返回的不是 JSON（可能缺少 Accept 头或该端点不支持该能力）。',
      noApiKeyHint: '尚无 Key',
      showApiKey: '显示 API Key',
      hideApiKey: '隐藏 API Key',
      replaceApiKey: '替换 Key',
      editApiKey: '编辑 API Key',
      clickToReplace: '点击可替换 Key',
      revealApiKeyFailed: '读取已保存 Key 失败，已保持掩码。',
      revealApiKeyUnavailable: '应用进程缺少该接口，请重启应用后重试。',
      revealApiKeyBridgeFailed: '与主进程通信失败，请重启应用后重试。',
      revealApiKeyMissing: '没有找到已保存的 Key（可能已被移除）。',
      retry: '重试',
      apiKeyRevealedHint: '完整 Key 已显示，30 秒后自动隐藏（失焦也会隐藏）。',
      removeApiKey: '移除 Key',
      removeApiKeyConfirm: '移除后需要重新填写，确定移除？',
      removeApiKeyConfirmAction: '确认移除',
      cancel: '取消',
      apiHost: 'API 地址',
      engines: '搜索引擎',
      enginesPlaceholder: '多个引擎用逗号分隔',
      basicAuthUsername: 'Basic Auth 用户名',
      basicAuthPassword: 'Basic Auth 密码',
      enableProvider: '启用供应商',
      checkProvider: '检查供应商',
      checkingProvider: '检查中',
      checkSucceeded: '检查通过',
      checkFailed: '检查失败',
      saveProvider: '保存供应商',
      saveKeyAndAdvanced: '保存 Key 与高级设置',
      savedImmediately: (enabled) => (enabled ? '已启用' : '已停用'),
      unsavedChanges: '有未保存修改',
      saveFailed: '保存失败',
      toggleSaveFailed: '开关保存失败',
      defaultSaveFailed: '默认能力保存失败',
      saveSettings: '保存设置',
      saved: '已保存',
      unsaved: '未保存',
      loadFailed: '网页搜索设置加载失败',
      noProviders: '没有可用供应商',
      providerDisabledHint: '此供应商已规划，当前版本还不能用。',
      currentInternetOnly: '网页搜索只查询当前互联网，不用于可回放历史证据。',
      capabilitySearchKeywords: '关键词搜索',
      capabilityFetchUrls: '网页读取',
      capabilitySearchShort: '搜索',
      capabilityFetchShort: '读取',
      endpoint: '端点',
      phaseAvailable: '已接入',
      phaseAvailableHint: '表示该供应商已接入，不代表已配置可用。',
      phaseDeferred: '未接入'
    },
    storageCache: {
      title: '存储与缓存',
      subtitle: '只治理可重建的派生缓存；凭证、消息和源数据不在此列。',
      loading: '正在加载缓存…',
      refresh: '刷新',
      dryRun: '预演模式',
      dryRunHint: '只预览结果，不删除',
      metaSummary: (caches, size, clearable, sensitive) =>
        `${caches} 个缓存 · 总计 ${size} · ${clearable} 个可清理${sensitive > 0 ? ` · ${sensitive} 个含用户内容` : ''}`,
      columnName: '缓存',
      columnSize: '体积',
      columnRecords: '记录',
      columnStatus: '状态',
      columnUpdated: '最近更新',
      columnActions: '操作',
      clear: '清理',
      compact: '压缩',
      recheck: '重新检查',
      recheckFailed: '重新检查失败',
      flagSensitive: '含用户内容',
      filterEmpty: '此分类下没有缓存',
      noCaches: '当前没有已注册缓存',
      emptyValue: '暂无',
      ownerPlatform: '平台',
      ownerProduct: (productId) => `产品：${productId}`,
      tabAll: '全部',
      tabPlatform: '平台',
      tabAiRuntime: 'AI 运行时',
      tabProducts: '产品',
      tabDerivedData: '派生数据',
      categoryPlatform: '平台',
      categoryAiRuntime: 'AI 运行时',
      categoryProduct: '产品',
      categoryDerivedData: '派生数据',
      statusReady: '可用',
      statusEmpty: '为空',
      statusActive: '活跃',
      statusInspectionFailed: '检查失败',
      statusSucceeded: '成功',
      statusFailed: '失败',
      statusSkipped: '跳过',
      neverInspected: '尚未检查',
      fieldKind: '形态',
      fieldDurability: '耐久性',
      fieldSensitivity: '敏感性',
      fieldLastUpdated: '最近更新',
      fieldRecordCount: '记录数',
      fieldSize: '体积',
      fieldWarnings: '影响提示',
      fieldBackupPolicy: '备份策略',
      operationSuccess: '缓存操作已完成',
      operationFailed: '缓存操作失败',
      confirmClear: (name) => `确认清理缓存“${name}”？`,
      confirmCompact: (name) => `确认压缩缓存“${name}”？`,
      confirmSensitiveClear: '该缓存包含用户内容或敏感引用，清理后需要重新生成这些派生结果。',
      confirmSensitiveCompact: '该缓存可能删除派生记录以回收体积，请确认你理解压缩影响。',
      confirmDerivedWarning: '这里只会操作已注册的派生缓存，不会删除产品真值数据或凭证。',
      confirmDryRunHint: '当前为试运行，只会预演结果，不会真正删除内容。',
      historyTitle: '操作记录',
      historyEmpty: '还没有操作记录',
      historyColumnCache: '缓存',
      historyColumnOperation: '操作',
      historyColumnResult: '结果',
      historyColumnTime: '时间',
      historyDryRun: '预演',
      operationClear: '清理',
      operationCompact: '压缩',
      operationInvalidate: '失效',
      backupExclude: '不纳入备份',
      backupInclude: '纳入备份',
      backupMetadataOnly: '仅备份元数据',
      toastCleared: (name, dryRun) => dryRun ? `已预演清理“${name}”` : `已清理“${name}”`,
      toastCompacted: (name, dryRun) => dryRun ? `已预演压缩“${name}”` : `已压缩“${name}”`,
      toastSkipped: (name) => `“${name}”当前没有可执行变更`,
      kindMemory: '内存',
      kindRuntimeHandle: '运行时句柄',
      kindJsonFile: 'JSON 文件',
      kindSqliteDerived: 'SQLite 派生数据',
      kindLocalStorage: '本地存储',
      kindParquetPartition: 'Parquet 分区',
      durabilitySessionOnly: '仅会话',
      durabilityPersistedDerived: '持久化派生',
      durabilityRebuildable: '可重建',
      durabilityUserDataLike: '类用户数据',
      sensitivityNone: '无',
      sensitivityContainsUserContent: '包含用户内容',
      sensitivityContainsSecretRef: '包含敏感引用'
    }
  },
  'en-US': {
    brand: {
      title: 'AI Desktop',
      subtitle: 'Platform workspace'
    },
    nav: {
      workspace: 'Workspace',
      chat: 'Chat',
      assistants: 'Assistants',
      agents: 'Agents',
      data: 'Data',
      docs: 'Docs',
      settings: 'Settings'
    },
    status: {
      productLoaded: 'product loaded',
      productsLoaded: 'products loaded',
      loading: 'Loading',
      saved: 'Saved',
      failed: 'Save failed'
    },
    workspace: {
      eyebrow: 'Electron shell is alive',
      title: 'Hello World',
      copy: 'The desktop foundation is running with main process, preload bridge, IPC, menu, tray, and a React workspace.',
      loadedProducts: 'Loaded Products',
      manifestDriven: 'Manifest driven',
      runtime: 'Runtime',
      preloadApi: 'Preload API',
      app: 'App',
      theme: 'Theme',
      node: 'Node',
      chrome: 'Chrome',
      tools: 'Tools',
      skills: 'Skills',
      agents: 'Agents',
      contributionLoadFailed: 'Failed to load page',
      panelActions: 'Panel actions', panelClose: 'Close panel', panelReopen: 'Reopen panel', panelEmbedded: 'Embed',
      panelDockRight: 'Dock right', panelDockBottom: 'Dock bottom', panelDetach: 'Detach window', panelResetSize: 'Reset size',
      panelUnsupported: 'Not available at this size', panelFallback: 'Panel', panelResize: 'Resize panel', panelInspector: 'Inspector', inspectorTitle: 'Inspector',
      inspectorDraft: 'Inspector draft', inspectorSelection: 'Inspector selection', inspectorSelect: 'Select item', inspectorSelected: 'Selected',
      panelModeUnsupported: 'This panel does not support that position', panelCapabilityMissing: 'Not supported in this version', panelReturnToPage: 'Back to page',
      panelShowPanel: 'Show panel', panelCommandRejected: 'The action was rejected; the panel state is unchanged', panelCommandFailed: 'The action failed. Try again',
      panelHandoffUnsaved: 'The panel has unsaved content, so it was not closed', panelHandoffSensitive: 'The panel holds a sensitive draft, so it was not closed',
      panelHandoffUnsupported: 'Content handoff is not supported in this version, so the panel was not closed',
      windowHostUnavailableTitle: 'Workspace window unavailable', windowHostUnavailableContext: 'The host context could not be read, so window content was not loaded',
      windowHostUnavailablePanel: 'This window has no panel to host', windowHostUnavailableHint: 'Return to the main window and try again, or restart the app',
      windowPreparingDetail: 'Moving this panel into this window, please wait', windowPanelPlaceholder: 'Panel content is not wired up yet',
      tabStrip: 'Workspace tabs', tabClose: 'Close tab', tabOpenPage: 'Open page', tabActions: 'Tab actions', tabCloseOthers: 'Close other tabs',
      tabCloseRight: 'Close tabs to the right', tabReopen: 'Reopen last closed tab', tabReopenUnavailable: 'No recently closed tab',
      tabCloseUnavailable: 'No active tab', tabCloseOthersUnavailable: 'No other tab to close', tabCloseRightUnavailable: 'No tab to the right',
      tabPageMissing: 'Page unavailable', tabEmptyTitle: 'No page is open', tabEmptyHint: 'Open a page from the tab bar to start working',
      tabCommandRejected: 'The action was refused; the workspace layout is unchanged', tabCommandFailed: 'The action failed. Try again',
      tabDetach: 'Detach to new window', tabDetachUnavailable: 'No tab can be detached right now',
      tabDetachUnsupported: 'This page cannot be detached into a new window', tabDetachAlreadyDetached: 'This tab already has its own window',
      tabDetachLimitReached: 'Too many separate windows; dock one of them back first',
      pageWindowRedock: 'Dock back into the main window',
      panelWindowRedock: 'Dock back into the main window',
      panelWindowRedockFailed: 'Dock back failed. Retry, or use the window close button',
      draftGateTitle: 'Unsaved draft', draftGateSensitive: 'This settings form holds a sensitive draft (API key). Save it, discard it, or cancel to stay.',
      draftGateUnsaved: 'This page has an unsaved draft. Save it, discard it, or cancel to stay.',
      draftGateSave: 'Save and leave', draftGateDiscard: 'Discard and leave', draftGateCancel: 'Cancel',
      draftGateSaveFailed: 'Saving failed: the window stayed open and the draft was kept', draftGateHint: 'The draft is never written into the workspace layout.'
    },
    settings: {
      modelService: 'Model Service',
      assistantLibrary: 'Assistant Library',
      webSearch: 'Web Search',
      storageAndCache: 'Storage and Cache',
      taskAutomation: 'Task Automation',
      basicSettings: 'Basic Settings',
      notifications: 'Notifications', channels: 'Channels', channelCreate: 'Create channel', channelRefresh: 'Refresh', channelPlanned: 'Waiting for adapter release', channelRunning: 'Running', channelDisable: 'Disable', channelRestart: 'Restart', channelCredentialConfigured: 'Credential configured', channelCredentialMissing: 'Credential missing', channelCredentialUnavailable: 'Credential unavailable', channelSaveCredential: 'Save credential', channelNoInstances: 'No channel instances', channelName: 'Name', channelAgentId: 'Agent ID', channelCredential: 'Bot Token', channelAppCredential: 'App Token', channelLarkAppId: 'Lark App ID', channelLarkAppSecret: 'Lark App Secret', channelQqAppId: 'QQ App ID', channelQqClientSecret: 'QQ Client Secret', channelDiscordBotToken: 'Discord Bot Token', channelWechatEnrollment: 'WeChat QR enrollment (protocol pending)', channelDelete: 'Delete', channelPolicy: 'Access policy', channelPolicyCreate: 'Add policy', channelPolicySubject: { user: 'User', conversation: 'Conversation' }, channelTarget: 'Delivery target', channelUpdate: 'Save changes', channelEnable: 'Request enable', channelEnableBlocked: 'Adapter support evidence is pending', channelAdapterUnavailable: 'Adapter is not implemented yet; credentials are disabled', channelCandidates: 'Pending conversations', channelCandidatesEmpty: 'Unknown users or groups appear here after they message the bot', channelCandidateUnknown: 'Unknown user', channelCandidateAllow: 'Allow', channelCandidateIgnore: 'Ignore', channelDeleteConfirm: 'Deleting the channel disconnects it and clears local credential references. Continue?', channelCancel: 'Cancel', channelRuntimeGeneration: 'Generation', channelRuntimeLifecycle: 'Runtime', channelCatalogStatus: { planned: 'Planned', blocked: 'Blocked', supported: 'Evidence complete' }, channelConversationKind: { direct: 'Direct', group: 'Group', channel: 'Channel' }, channelState: { 'credential-missing': 'Credential missing', 'configuration-ready': 'Configuration ready', disabled: 'Disabled', deleting: 'Deleting', 'runtime-ready': 'Runtime ready' }
    },
    taskAutomation: {
      title: 'Task Automation', subtitle: 'Platform jobs, delivery health, and mutation audits.', refresh: 'Refresh', retry: 'Retry', emptyValue: '—',
      deliveryHealth: 'Delivery health', healthUpdated: (time) => `Updated ${time}`,
      healthEmpty: 'No deliveries yet. Success, failure and skipped counts appear here once a task runs.',
      scheduledTaskDelivery: 'Scheduled task delivery',
      resourceJobRuns: 'Latest product job runs',
      resourceJobRunsEmpty: 'No registered product jobs.',
      healthScopeNote: 'Delivery = a scheduled task delivering a message to a channel or notification; runs = the latest execution of a product job. The two are counted separately.',
      myTasks: 'My scheduled tasks',
      columns: { name: 'Name', status: 'Status', schedule: 'Schedule', nextRun: 'Next run', lastResult: 'Last result', actions: 'Actions', source: 'Source', registration: 'Registration', lastRun: 'Last run' },
      all: 'All', searchTasks: 'Search job name', tasksLoading: 'Loading scheduled tasks…', tasksLoadFailed: 'Failed to load scheduled tasks.', loadMore: 'Load more',
      filterEmpty: 'No jobs match these filters.', clearFilters: 'Clear filters',
      emptyTasksTitle: 'No scheduled tasks yet',
      emptyTasksBody: 'Ask the assistant something like “summarize the market every day at 9am” and it will appear here. You can pause it or check its delivery health at any time.',
      status: { active: 'Active', paused: 'Paused', completed: 'Completed' },
      outcome: { success: 'Succeeded', failed: 'Failed', skipped: 'Skipped', never: 'Never' },
      details: 'Details', collapse: 'Collapse', taskDeliveryHealth: 'Delivery health for this task', recentChanges: 'Recent changes', noChanges: 'No changes yet.',
      delivered: 'Delivered', failed: 'Failed', pending: 'Pending', skipped: 'Skipped', unknown: 'Unknown',
      auditAccepted: 'Accepted', auditRejected: 'Rejected',
      auditAction: { create: 'Created', update: 'Updated', pause: 'Paused', resume: 'Resumed', delete: 'Deleted', 'run-now': 'Run now', 'cancel-run': 'Cancelled run', 'runtime-transition': 'Runtime transition', 'channel-delete-cleanup': 'Channel cleanup' },
      resourceJobs: 'Platform & product jobs', resourceLoading: 'Loading platform jobs…', resourceLoadFailed: 'Failed to load platform jobs.',
      resourceBridgeMissing: 'The app process is missing this interface; restart the app and retry.', resourceLoadTimeout: 'Timed out reading platform jobs. Please retry.',
      resourceEmptyTitle: 'No product jobs registered',
      resourceEmptyBody: 'Once a product enables its automatic collection capability, its schedule, registration state, next run, and last result appear here. Not registered does not mean broken; it usually means the capability is disabled.',
      resourceNote: '“Not registered” means the product has not registered its schedule with the platform; it usually means the capability is disabled. This page is read-only — enable or disable it in the owning product.',
      allSources: 'All sources', allStatuses: 'All statuses', platform: 'Platform', product: 'Product', registered: 'Registered', notRegistered: 'Not registered',
      resourceCount: (total, filtered) => `${filtered} of ${total} jobs`,
      resourceCountWithPage: (total, filtered, page, pages) => `${filtered} of ${total} jobs · page ${page}/${pages}`,
      resourcePageSize: 'Rows per page', resourcePrevPage: 'Previous', resourceNextPage: 'Next',
      resourcePageIndicator: (page, pages) => `Page ${page} of ${pages}`,
      schedule: {
        everySeconds: (count) => `Every ${count} s`,
        everyMinutes: (count) => `Every ${count} min`,
        everyHours: (count) => `Every ${count} h`,
        cron: (expression) => `Cron ${expression}`,
        onceAt: (time) => `Once at ${time}`,
        manual: 'Manual',
        startup: 'At startup',
        event: (topic) => `Event · ${topic}`
      },
      policy: 'Execution policy', balanced: 'Balanced', conservative: 'Conservative',
      policyCurrent: 'Current policy', policyExplanation: 'Affects automation bandwidth: concurrency limit, minimum interval, run timeout.',
      policyConcurrencyLimit: 'Concurrency limit', policyConcurrencyValue: (count) => `${count} concurrent tasks`,
      policyMinInterval: 'Minimum interval', policyTimeout: 'Run timeout', policyTimeoutValue: (minutes) => `${minutes} min`,
      policyLoading: 'Loading policy…', policyLoadFailed: 'Failed to load policy',
      policyEmptyNote: 'There are no automatic tasks yet; the policy applies once a task starts running.'
    },
    assistants: {
      title: 'Assistants',
      assistants: 'Assistants',
      topics: 'Topics',
      addAssistant: 'Add assistant',
      newTopic: 'New topic',
      noAssistant: 'No assistant selected',
      noTopics: 'No topics yet',
      defaultAssistant: 'Platform default assistant',
      selectTopic: 'Select a topic to start chatting',
      emptyChat: 'Send the first message to begin',
      startConversation: 'Type a message to start a new topic',
      inputPlaceholder: 'Type a message. Enter to send, Shift+Enter for newline',
      send: 'Send',
      stop: 'Stop',
      streaming: 'Generating',
      imageGenerate: 'Generate image',
      imageGenerateTooltipDisabled: 'No image generation endpoint configured',
      imagePromptPlaceholder: 'Describe the image to generate…',
      imageSize: 'Size',
      imageCount: 'Count',
      imageGenerateAction: 'Generate',
      imageGenerating: 'Generating image…',
      imageDownload: 'Download',
      imagePreview: 'Preview image',
      imagePromptRequired: 'Enter a prompt for the image',
      imageFailureInvalidCount: 'Count must be between 1 and 4',
      imageFailureInvalidSize: 'Size must be 256x256, 512x512 or 1024x1024',
      imageFailureTooLarge: 'The generated image exceeds the 2 MB limit',
      imageFailureNoEndpoint: 'No image generation endpoint configured',
      imageFailureInvalidRequest: 'The image generation request is invalid',
      imageFailureModelNotFound: 'The image model is not available',
      imageFailureInvalidResponse: 'The image service returned an unrecognized response',
      imageEdit: 'Edit image',
      imageEditTooltipDisabled: 'No image edit endpoint configured',
      imageEditPromptPlaceholder: 'Describe how to change this image…',
      imageEditAction: 'Apply edit',
      imageEditSourceTitle: 'Source image',
      imageEditSourceSession: 'Pick one of this topic’s images',
      imageEditSourceUpload: 'Upload image',
      imageEditSourceRequired: 'Choose or upload a source image',
      imageEditGenerating: 'Editing image…',
      imageFailureSourceTooLarge: 'The source image exceeds the 4 MB limit',
      imageFailureSourceTypeUnsupported: 'Only PNG, JPEG, or WebP source images are supported',
      imageFailureSourceMissing: 'The source image is no longer available; pick another one',
      imageFailureTopicMissing: 'Create or select a topic first',
      pendingMessage: 'Waiting for reply',
      generationStopped: 'Generation stopped',
      modelNotReady: 'Enable Model Service and configure an API key in Settings first',
      hideTopics: 'Hide sidebar',
      showTopics: 'Show sidebar',
      deleteMessage: 'Delete message',
      copyMessage: 'Copy message',
      editMessage: 'Edit message',
      regenerate: 'Regenerate',
      resendEdited: 'Send edited',
      deleteConversation: 'Delete conversation',
      deleteConversationConfirm: (name) => `Delete conversation "${name}" and all its messages?`,
      moreConversationActions: 'More conversation actions',
      conversationOperationFailed: 'The conversation action could not be completed. Try again.',
      modelRetired: 'This model has been retired. Switch to another model.',
      modelNotActivated: 'This model is not activated. Enable it in the provider console.',
      modelNotFound: 'This model no longer exists. Switch to another model.',
      cancel: 'Cancel',
      previousSibling: 'Previous branch',
      nextSibling: 'Next branch',
      siblingIndex: '{current} / {total}',
      searchTopic: 'Search topic messages',
      searchResults: 'Search results',
      assistantSettings: 'Assistant settings',
      saveSettings: 'Save settings',
      assistantName: 'Assistant name',
      assistantPrompt: 'System prompt',
      modelSwitchHint: 'Switch the model from the picker at the top of the assistant page.',
      enableTemperature: 'Enable temperature',
      temperature: 'Temperature',
      streamOutput: 'Stream output',
      mcpMode: 'MCP mode',
      mcpDisabled: 'Disabled',
      mcpAuto: 'Auto',
      mcpManual: 'Manual',
      enableWebSearch: 'Enable web search',
      webSearchHint: 'Allow this assistant to use current web search and web page fetch tools.',
      contextSourcesPlaceholder: 'Knowledge and context sources will connect through later platform capabilities.',
      comingSoon: 'Coming soon',
      mentionedModels: 'Mentioned models',
      webSearchCardTitle: 'Web Search',
      webFetchCardTitle: 'Page fetch',
      webSearchSources: 'Sources',
      webSearchRunning: 'Searching',
      webSearchFailed: 'Search failed',
      openSource: 'Open source',
      newAssistantName: (count) => `Assistant ${count}`,
      followDefaultModel: (model) => `Following default: ${model}`,
      clearMentionedModels: 'Clear selection',
      mentionedModelSelection: (count) => `${count} model${count === 1 ? '' : 's'} selected`,
      inputbarTools: {
        attachment: 'Attachment',
        'new-topic': 'New topic',
        'clear-topic': 'Clear topic',
        'quick-panel': 'Quick panel',
        'mcp-tools': 'MCP tools',
        'web-search': 'Web search',
        'context-source': 'Context source'
      },
      library: {
        title: 'Assistant Library',
        searchPlaceholder: 'Search assistants, prompts, or tags',
        importExternal: 'Import From External',
        manageAssistants: 'Manage Assistants',
        createAssistant: 'Create Assistant',
        install: 'Install',
        installed: 'Installed',
        updateAvailable: 'Update available',
        sourcePlatform: 'Platform',
        sourceProduct: (name) => `Product: ${name}`,
        productGroupsTitle: 'Product assistants',
        detailPromptTitle: 'Prompt',
        addToAssistant: 'Add to Assistants',
        emptyTitle: 'No matching assistants',
        emptyDescription: 'Try another category or keyword.',
        importTitle: 'Import Assistants',
        importJson: 'JSON content',
        importJsonPlaceholder: 'Paste assistant JSON',
        importFile: 'Choose file',
        importClipboard: 'Read clipboard',
        importUrlDisabled: 'URL import needs a proxy-aware main-process path and is disabled in this version.',
        importSubmit: 'Import',
        importSuccess: (count) => `${count} assistant${count === 1 ? '' : 's'} imported`,
        importFailed: 'Import failed. Check the JSON format.',
        createTitle: 'Create Assistant',
        icon: 'Icon',
        name: 'Name',
        namePlaceholder: 'Enter assistant name',
        prompt: 'Prompt',
        promptPlaceholder: 'Enter system prompt',
        promptGenerate: 'Prompt generation will be added later',
        tokenCount: (count) => `~${count} tokens`,
        knowledgeBase: 'Knowledge base',
        knowledgeBaseDisabled: 'Knowledge base support will connect through a later platform capability.',
        cancel: 'Cancel',
        create: 'Create',
        required: 'Name and prompt are required',
        created: 'Assistant created',
        installedMessage: 'Template installed as an editable assistant',
        groups: {
          mine: 'Mine',
          featured: 'Featured',
          career: 'Career',
          business: 'Business',
          tools: 'Tools',
          language: 'Language',
          office: 'Office',
          general: 'General',
          writing: 'Writing',
          programming: 'Programming',
          emotional: 'Emotional',
          education: 'Education',
          creative: 'Creative',
          academic: 'Academic',
          design: 'Design',
          art: 'Art',
          entertainment: 'Entertainment',
          life: 'Life',
          medical: 'Medical',
          game: 'Game',
          translation: 'Translation'
        }
      }
    },
    models: {
      providerList: 'Providers',
      providerDetail: 'Provider Settings',
      addProvider: 'Add Provider',
      searchProvider: 'Search providers',
      searchProviderPlaceholder: 'Search model platforms…',
      addProviderAction: 'Add',
      addProviderName: 'Provider name',
      addProviderNamePlaceholder: 'e.g. OpenAI',
      addProviderKey: 'API Key',
      addProviderKeyPlaceholder: 'Enter API key',
      addProviderOpenAiBase: 'OpenAI Base URL',
      addProviderAnthropicBase: 'Anthropic Base URL',
      addProviderBasePlaceholder: 'https://example.com',
      addProviderPreset: 'Create from preset (optional)',
      addProviderPresetPlaceholder: 'Pick a preset to fill the fields',
      addProviderDuplicate: (name) => `A provider named "${name}" already exists`,
      addProviderInvalidBase: 'Enter a valid base URL',
      providerContextOpen: 'Open',
      providerContextEnable: 'Enable',
      providerContextDisable: 'Disable',
      providerContextDelete: 'Delete',
      providerContextSystem: 'System',
      removeProviderConfirm: (name) => `Delete "${name}"? This cannot be undone and will also remove its API key and model list.`,
      systemProviderCannotDelete: 'System providers cannot be deleted',
      noMatchedProviders: 'No matching providers',
      noMatchedModels: 'No matching models',
      systemProvider: 'System',
      customProvider: 'Custom',
      systemProviderHint: 'System providers stay in the preset list',
      noProviders: 'No model providers yet',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'Paste API key (required)',
      savedApiKeyPlaceholder: 'API Key saved. Enter a new key to replace it',
      savedApiKeyMaskHint: 'Click the field to replace it; use the eye to view the saved key (auto-hides after 30 seconds).',
      revealApiKeyFailed: 'Failed to read the saved key. Try again.',
      getApiKey: 'Get key',
      modelCatalog: 'Models',
      multipleApiKeysHint: 'Separate multiple keys with commas',
      showApiKey: 'Show key',
      hideApiKey: 'Hide key',
      enabled: 'Enabled',
      providerEnabled: 'Enabled',
      providerDisabled: 'Disabled',
      providerCategories: {
        relay: 'Relays & Aggregators',
        domestic: 'Chinese Sites',
        international: 'International Sites',
        local: 'Local & Self-hosted',
        gateway: 'Self-hosted Gateways'
      },
      collapseProviderGroup: 'Collapse group',
      expandProviderGroup: 'Expand group',
      enabledProviders: 'Enabled',
      recommendedProviders: 'Recommended',
      reachabilityDirect: 'Direct in China',
      reachabilityProxy: 'Requires proxy',
      mainlandProxyNotice: 'Mainland China users need a proxy to access this service.',
      apiEndpoint: 'API Endpoint',
      agentRuntimeCompatibility: 'Agent compatibility',
      saveProvider: 'Save',
      removeProvider: 'Delete',
      testConnection: 'Check',
      enableSwitchTitle: 'Enable / disable (applies immediately)',
      providerConsole: 'Provider console',
      providerMetaLine: (host, category) => `${host} · ${category}`,
      providerMoreActions: 'More actions',
      advancedSettings: 'Advanced settings',
      getApiKeyHere: 'Get your key here',
      // 极端兜底文案（没有专门 key 页的家，例如本地运行时）：与 `getApiKeyHere` 成对出现。
      getKeyFromConsole: 'Open the console to get a key',
      anthropicEndpoint: 'Anthropic API base URL',
      openAiEndpoint: 'API base URL (OpenAI compatible)',
      anthropicPreviewLabel: 'Anthropic preview: ',
      chatPreviewLabel: 'Preview: ',
      endpointOverride: 'Override',
      endpointOverrideRisk: 'Must match the provider protocol, otherwise requests fail with 401/404',
      endpointNotSet: 'Not set',
      fetchModelList: 'Fetch model list',
      clearModels: 'Clear models',
      clearModelsConfirmTitle: 'Clear all models',
      clearModelsConfirmBody: (count) =>
        `This deletes ${count} model(s), including preset models. Presets will not add them back; use "Fetch model list" to sync again.`,
      inUseModelRetired: (model) => `The model you are using (${model}) has been retired. Switch to another model.`,
      changeModel: 'Change model',
      modelSearch: 'Search models',
      modelFilterAll: 'All',
      modelFilterMessages: 'Agent-capable',
      modelFilterUnknownHint: 'Unverified models are hidden from this list',
      detectionStatusLabel: (status) => ({
        testing: 'Testing…', ok: 'OK', failed: 'Failed', skipped: 'Skipped', cancelled: 'Stopped'
      })[status],
      detectionFailedWithReason: (reason) => `Failed: ${reason}`,
      detectionSkippedWithReason: (reason) => `Skipped: ${reason}`,
      detectionProtocolFailedTitle: (protocols) => `Provider-declared but failed this run: ${protocols}`,
      modelProtocolChipTitle: (protocol, source) => `${protocol} · ${source}`,
      modelProtocolChipThisRunFailed: (protocol, reason, source) =>
        `${protocol} · failed in this run: ${reason} (${source}; a failure does not revoke existing evidence)`,
      modelProtocolSourceDeclared: 'Provider declared',
      modelProtocolSourceEndpoint: 'Inferred from the default endpoint',
      modelProtocolSourceProbe: 'Passed by detection',
      detectionProtocolCount: (passed, total) => `Protocols ${passed}/${total}`,
      detectionProtocolReusedBadge: 'reused connectivity',
      detectModels: 'Detect models',
      detectModelsCount: (count) => `Will check ${count} model${count === 1 ? '' : 's'}`,
      detectModelsWarning:
        'Sends real requests and may cost a little; image, video, speech, and transcription models are skipped.',
      detectSessionOnly: 'Results stay in this session and are not saved.',
      detectModeConnectivity: 'Connectivity',
      detectModeConnectivityHint: 'One minimal request per model, in its own protocol',
      detectModeConnectivityScope: 'Covers all text models',
      detectModeProtocol: 'Protocol support',
      detectModeProtocolHint: 'Only endpoints that already have an address',
      detectModeProtocolScope: 'Chat models only',
      detectProtocolSingleChannel: 'Only one protocol is testable for this provider',
      detectProtocolSummaryPassed: (models) => `Protocol support: ${models} model${models === 1 ? '' : 's'} checked, all passed`,
      detectProtocolSummaryFailed: (models, failed) =>
        `Protocol support: ${models} model${models === 1 ? '' : 's'} checked, ${failed} failed`,
      detectModeRequired: 'Select at least one check',
      detectProgressTitle: 'Progress',
      detectProgress: (done, total) => `Completed ${done}/${total}`,
      detectStartRunning: (done, total) => `Detecting ${done}/${total}`,
      detectStart: 'Start',
      detectStop: 'Stop',
      detectStopped: 'Stopped',
      detectClose: 'Close',
      providerNames: {
        silicon: 'SiliconFlow',
        tokenrhythm: 'TokenRhythm',
        zhipu: 'Zhipu AI',
        moonshot: 'Moonshot Kimi',
        dashscope: 'Alibaba Bailian',
        doubao: 'Doubao (Volcano Ark)',
        baichuan: 'Baichuan AI',
        stepfun: 'StepFun',
        yi: '01.AI',
        hunyuan: 'Tencent Hunyuan',
        'tencent-cloud-ti': 'Tencent Cloud TI',
        'baidu-cloud': 'Baidu AI Cloud',
        qiniu: 'Qiniu Cloud',
        mimo: 'Xiaomi MiMo',
        modelscope: 'ModelScope',
        ppio: 'PPIO',
        lanyun: 'Lanyun',
        tokenhub: 'Tencent Cloud TokenHub',
        longcat: 'Meituan LongCat'
      },
      modelRetiredTag: 'Retired',
      defaultModelAssistant: 'Default assistant model',
      defaultModelAssistantHint: 'Used for new conversations',
      protocolNoticeNone: (provider) =>
        `${provider} does not return protocol support in its model list. After syncing, run "Detect models" to probe each model, otherwise agents may not be able to select it.`,
      protocolNoticeDismiss: 'Dismiss',
      defaultModelAgent: 'Default agent model',
      defaultModelAgentHint: 'Used for new agents',
      defaultModelFast: 'Fast model',
      defaultModelFastHint: 'Used for lightweight tasks',
      defaultModelTranslation: 'Translation model',
      defaultModelTranslationHint: 'Used for translations',
      defaultModelImage: 'Image model',
      defaultModelImageHint: 'Used for image generation',
      defaultModelsShowMore: 'More default model settings',
      defaultModelsCollapse: 'Collapse',
      copyModelId: 'Copy',
      copied: 'Copied',
      nonChatModelHint: 'Non-chat models do not appear in chat model selection.',
      modelDiscountBadge: 'Deal',
      apiAddress: 'API address',
      endpointNotConfigured: 'No endpoint configured',
      endpointDefaultBadge: 'Default',
      endpointSetDefault: 'Set as default',
      endpointAdd: 'Add endpoint',
      endpointDelete: 'Delete this endpoint',
      endpointKeepAtLeastOne: 'Keep at least one endpoint',
      endpointKindChat: 'Chat',
      endpointKindResponses: 'Responses',
      endpointKindMessages: 'Anthropic Messages',
      endpointKindGemini: 'Gemini native',
      endpointActualRequestLabel: (url) => `Actual request: ${url}`,
      endpointGeminiHostPlaceholder: 'https://generativelanguage.googleapis.com',
      endpointGeminiHostHint: 'Use the Gemini native host name, not a relay base URL',
      requestConfigChatEndpoints: 'Chat endpoints',
      requestConfigImageEndpoints: 'Image',
      // Honest copy: image endpoints do not fall back to the chat endpoint; empty = disabled.
      requestConfigImageGenerationHint: 'Used for /images/generations; leave it empty to disable image generation',
      requestConfigImageEditHint: 'Used for /images/edits; leave it empty to disable image editing',
      requestConfigImageBasePlaceholder: 'Base URL: https://example.com',
      overwrite: 'Override',
      requestConfig: 'Request configuration',
      requestConfigAddEndpoint: 'Add endpoint',
      requestConfigResponses: 'OpenAI Responses',
      requestConfigGemini: 'Gemini',
      requestConfigGeminiNative: 'Gemini (native)',
      requestConfigImageGeneration: 'Image generation',
      requestConfigImageEdit: 'Image edit',
      requestConfigAnthropicEndpoint: 'Anthropic',
      endpointTestAvailable: 'Available',
      endpointTestExistsParamError: 'Endpoint exists (parameter error)',
      endpointTestExistsAuthFailed: 'Endpoint exists but authentication failed',
      endpointTestExists: 'Endpoint exists',
      endpointTestMissing: 'Endpoint path not found',
      endpointTestUnreachable: 'Unreachable',
      endpointTestNoModel: 'Add a chat model before testing',
      endpointTestUnsupported: 'Test not supported yet',
      requestConfigBaseRequired: 'Base URL is required',
      close: 'Close',
      modelCostTitle: (context, input, output, cacheRead, currency) =>
        `Context ${context} · Input ${input}/M · Output ${output}/M${cacheRead === null ? '' : ` · Cache read ${cacheRead}/M`} · Currency ${currency}`,
      probeReasonModelNotActivated: 'This model is not activated for your account; activate it in the provider console and retry',
      probeReasonTimeout: 'timeout',
      probeReasonAuth: 'authentication',
      probeReasonRateLimit: 'rate limit',
      probeReasonBalance: 'insufficient balance',
      probeReasonNetwork: 'network error',
      probeReasonHttp4xx: 'HTTP 4xx',
      probeReasonHttp5xx: 'HTTP 5xx',
      probeReasonOther: 'other error',
      probeReasonEndpointUnsupported: 'this endpoint does not support the protocol',
      probeReasonEndpointMissing: 'no endpoint configured for the protocol',
      probeReasonNetworkError: 'network error',
      probeReasonCancelled: 'stopped',
      probeSkipNonTextGeneration: 'non-text generation model',
      probeSkipProviderDisabled: 'provider disabled',
      probeSkipNotChatModel: 'not a chat model',
      probeSkipProtocolNotConfigured: 'no protocol endpoint configured',
      typeAll: 'All',
      typeDeal: 'Free & deals',
      typeText: 'Text',
      typeImage: 'Image',
      typeEmbedding: 'Embedding',
      typeRerank: 'Rerank',
      typeSpeech: 'Speech',
      typeTranscription: 'Transcription',
      typeOcr: 'OCR',
      typeVideo: 'Video',
      typeVision: 'Vision',
      typeReasoning: 'Reasoning',
      capabilityToolsTitle: 'Supports tool calls',
      capabilitySourceInferred: 'Source not declared',
      capabilityResponsesTitle: 'Supports the OpenAI Responses API',
      protocolAnthropic: 'Anthropic Messages',
      protocolResponses: 'OpenAI Responses',
      protocolFilterChat: 'OpenAI Chat',
      protocolFilterResponses: 'OpenAI Responses',
      protocolFilterMessages: 'Anthropic Messages',
      protocolFilterGemini: 'Gemini native',
      capabilityReasoningTitle: 'Reasoning model',
      capabilityVisionTitle: 'Vision model',
      capabilityEmbeddingTitle: 'Embedding model',
      capabilityImageTitle: 'Image generation',
      capabilityVideoTitle: 'Video generation',
      capabilityRerankTitle: 'Rerank',
      capabilitySpeechTitle: 'Speech (TTS)',
      capabilityTranscriptionTitle: 'Transcription (ASR)',
      capabilityOcrTitle: 'OCR model',
      modelsHeading: 'Models',
      showModelFilters: 'Show filters',
      hideModelFilters: 'Hide filters',
      cancel: 'Cancel',
      selectAll: 'Select all',
      deselectAll: 'Deselect all',
      pickerSearchPlaceholder: 'Search models or providers…',
      pickerSelectModel: 'Select a model',
      pickerClearSelection: 'Clear selection',
      pickerFilters: 'Filters',
      pickerClearFilters: 'Clear filters',
      pickerFilteredCount: (count) => `Filtered · ${count} result${count === 1 ? '' : 's'}`,
      pickerCategoryVision: 'Vision',
      pickerCategoryAudio: 'Audio',
      pickerCategoryVideo: 'Video',
      pickerCategoryReasoning: 'Reasoning',
      pickerCategoryTools: 'Tools',
      pickerCategoryDeal: 'Deals & free',
      pickerTagDiscount: 'Discount',
      pickerEmptyNoModels: 'No models available yet',
      pickerEmptyNoMatch: 'No matching models',
      pickerEmptyNoMessages: 'No model supports the Messages protocol',
      pickerEmptyNoMessagesHint:
        'Configure an Anthropic endpoint for a model in Model Service, or detect whether it supports Messages',
      pickerEmptyNoImage: 'No model supports image generation',
      pickerEmptyNoImageHint: 'Configure an image generation endpoint in Model Service',
      pickerEmptyRetiredOnly: 'All available models are retired',
      pickerConfigureCustomModel: 'Configure custom models',
      pickerMessagesHint: (model) => `"${model}" does not support Messages; switching is recommended`,
      pickerImageHint: (model) => `"${model}" does not support image generation; switching is recommended`,
      pickerConstraintHint: (model) => `"${model}" is outside the current selection; switching is recommended`,
      pickerProviderDisabledHint: (model) => `"${model}" belongs to a disabled provider; switching is recommended`,
      connectionCheckTitle: 'Connection Check',
      connectionCheckModel: 'Model',
      connectionCheckApiKey: 'API Key',
      connectionCheckStart: 'Start Check',
      connectionCheckOrdinaryChat: 'Ordinary chat',
      connectionCheckGeminiNative: 'Gemini (native)',
      connectionCheckDirect: 'Claude Code direct',
      connectionCheckGateway: 'Claude Code gateway',
      connectionCheckFinal: 'Final Agent verdict',
      connectionCheckAgentReady: 'Agent runtime ready',
      connectionCheckAgentNotReady: 'Agent runtime not ready',
      connectionCheckAgentMixed: 'Chat works, but Agent runtime is not ready',
      connectionCheckAgentUsableDirect: 'Agent usable (direct Anthropic protocol)',
      connectionCheckAgentUsableGateway: 'Agent usable (converted via the model gateway)',
      connectionCheckAssistantUsable: 'Assistant usable (ordinary chat passed)',
      connectionCheckGatewayRequired: 'Enable the model gateway to use the Agent runtime',
      connectionCheckProbeTimeout: 'Direct probe timed out (the model may be slow; try again)',
      connectionCheckAgentUnconfirmedTimeout:
        'Unconfirmed (direct probe timed out) · retry or enable the gateway',
      connectionCheckOptionalRuntimeDisabled:
        'This model does not enable the Claude Code runtime (optional; does not affect Agent chat)',
      connectionCheckOptionalGatewayDisabled:
        'Model gateway is off (optional; does not affect Agent chat)',
      connectionSucceeded: 'Connection succeeded',
      connectionFailed: 'Connection failed',
      connectionReady: 'Configuration is ready for a live connection test',
      connectionNeedsConfig: 'Enable the provider and set an API key first',
      noChatModelForConnectionCheck: 'Add at least one chat-capable model first',
      connectionCheckProviderStatus: 'Provider',
      connectionCheckStatusEnabled: 'Enabled',
      connectionCheckStatusDisabled: 'Disabled',
      connectionCheckEnableProvider: 'Enable',
      connectionCheckDetailPrefix: 'Raw message: ',
      connectionCheckIrrelevantHint: 'Does not affect ordinary chat',
      connectionCheckReasonProviderDisabled: 'The provider is disabled. Enable it above and run the check again.',
      connectionCheckReasonMissingApiKey: 'No usable API key yet. Enter and save one first.',
      connectionCheckReasonUnauthorized: 'The provider rejected this key (401/403). Check the key and its model access.',
      connectionCheckReasonDns: 'DNS lookup failed. Check the API address, DNS and network.',
      connectionCheckReasonRefused: 'Connection refused. Check the host/port and whether the local service is running.',
      connectionCheckReasonTimeout: 'The request timed out. Check the network or proxy.',
      connectionCheckReasonTls: 'TLS/certificate verification failed. Check the certificate and proxy.',
      connectionCheckReasonProxy: 'The proxy connection failed. Check the system/custom proxy settings.',
      connectionCheckReasonModelNotFound: 'The model id is invalid, or this account has no access to it.',
      connectionCheckReasonHttp: (status) => `The provider returned HTTP ${status}. Check that status code.`,
      connectionCheckReasonForbidden: 'The provider refused access (403). Check that this key can use the model.',
      connectionCheckReasonNotFound: 'The endpoint does not exist (404). Check the API address.',
      connectionCheckReasonServerError: 'The provider had a server error (5xx). Try again later.',
      connectionCheckReasonInvalidResponse: 'The provider returned an unreadable response. Check the API address or proxy.',
      connectionCheckReasonUnknown: 'The check failed and the cause could not be classified (see raw message).',
      connectionCheckReasonRateLimited: 'The provider is rate limiting or overloaded. Try again later.',
      connectionCheckReasonProtocolUnsupported: 'This model does not support the Anthropic protocol (/v1/messages)',
      connectionCheckReasonProtocolUnsupportedHint:
        'Agents / Claude Code need this protocol: enable the agent gateway to translate it, or switch to a model that supports messages.',
      connectionCheckReasonModelRetired: 'This model has been retired by the provider. Pick another model.',
      connectionCheckAgentNeedsAnthropicEndpoint: 'This provider has no Anthropic endpoint, so agent runtimes are unavailable',
      connectionCheckAgentNeedsAnthropicEndpointHint: 'Ordinary chat is unaffected. Add an Anthropic endpoint or enable the gateway to use agents.',
      connectionCheckReasonModelUnavailable: 'No available channel for this model right now.',
      connectionCheckReasonGeminiNativeMissing: 'The Gemini native endpoint is not configured. Fill in the host name in the API address above.',
      connectionCheckReasonAccountBalance: 'Account balance or quota is insufficient; top up in the provider console',
      connectionCheckReasonGatewayDisabled: 'The model gateway is not enabled',
      connectionCheckReasonModelRuntimeDisabled: 'This model is not enabled for the Claude Code runtime',
      connectionCheckGatewayDisabledHint: 'Enable it to use Claude Code gateway routing; does not affect ordinary chat',
      connectionCheckEnableModelGateway: 'Enable gateway',
      connectionCheckEnvironment: 'Environment',
      connectionCheckProxy: 'Proxy',
      connectionCheckProxyDirect: 'Direct (no proxy)',
      connectionCheckProxySystem: 'Follow system',
      connectionCheckProxyCustom: 'Custom',
      connectionCheckTargetHost: 'Target host',
      connectionCheckNetworkDiagnosis: 'Network diagnosis',
      connectionCheckNetworkDiagnosisNone: 'No network-classified failure in this check.',
      connectionCheckProxyNote: 'The browser opening the site does not mean the app can connect: app requests use the platform proxy.',
      connectionCheckNetworkFailureHint: (mode) => `Currently ${mode}; if the browser can reach it but the app cannot, switch to a custom proxy or check the system proxy.`,
      connectionCheckCustomProxyFailureHint: (host) => `A custom proxy is configured but still fails: make sure it can reach ${host} (some proxies route by domain).`,
      connectionCheckOpenProxySettings: 'Open proxy settings',
      fetchModelsFailed: 'Could not fetch the model list: ',
      retry: 'Retry',
      modelSyncReasonNetwork: 'Network error. Check the network or proxy.',
      modelSyncReasonInvalidBaseUrl: 'The API address is invalid. Check its format.',
      modelSyncReasonProviderNotFound: 'The provider was not found. Refresh and try again.',
      modelSyncReasonModelListUnsupported: 'This provider has no model list. Add models manually.',
      modelSyncReasonUnknown: 'Unknown error. Please retry.',
      runtimeNotEnabledHint: 'This model does not enable the Claude Code runtime (optional; does not affect Agent chat)',
      modelSyncNeedsApiKey: 'Add an API key first',
      modelSyncInProgress: 'Syncing…',
      models: 'Models',
      modelId: 'Model ID',
      modelName: 'Model Name',
      addModel: 'Add Model',
      editModel: 'Edit Model',
      saveModel: 'Save',
      removeModel: 'Remove',
      pinModel: 'Pin Model',
      unpinModel: 'Unpin Model',
      freeModel: 'Free model',
      freeModelHint: 'Only affects filtering and display; prices are unchanged. Turn off to fall back to price-based detection.',
      freeModelAutoHint: 'This model already costs 0, so it is detected as free automatically.',
      modelFreeTag: 'Free',
      noModels: 'No models yet',
      ungroupedModels: 'Ungrouped',
      syncModels: 'Sync Models',
      modelSyncTitle: 'Sync Model List',
      modelSyncAdded: 'Remote additions',
      modelSyncMissing: 'Missing remotely',
      modelSyncLocalSurplus: 'Local surplus (preset changed)',
      modelSyncLocalSurplusHint:
        'These models are no longer part of the current preset. They are deleted only when selected; uncheck to keep them.',
      modelSyncStaleHint: (count) =>
        `${count} model(s) are no longer part of the current preset. Clean them up from "Fetch model list".`,
      modelSyncApply: 'Apply Changes',
      modelSyncApplied: 'Model sync applied',
      modelSyncAppliedSummary: (added, updated, removed) => `Added ${added} · updated ${updated} · removed ${removed}`,
      modelRemovedNotice: (count) => `Removed ${count} model(s)`,
      modelsClearedToast: (count) => `Cleared ${count} model(s)`,
      modelSyncFailed: 'Model sync failed',
      modelSyncUpToDate: 'Models are up to date',
      modelSyncUpToDateHint: 'The remote model list matches the local configuration',
      modelSyncRemovedHint: 'These models were not returned by the remote provider. They are removed only after confirmation.',
      modelSyncAddSummary: 'Add {selected}/{total}',
      modelSyncRemoveSummary: 'Remove {selected}/{total}',
      modelTypeCapabilities: 'Model Type',
      modelChatProtocol: 'Request protocol',
      chatProtocolDefault: 'Default (chat/completions)',
      chatProtocolChatCompletions: 'OpenAI Chat (chat/completions)',
      chatProtocolResponses: 'OpenAI Responses',
      chatProtocolGemini: 'Gemini native',
      chatProtocolMessages: 'Anthropic Messages',
      chatProtocolEndpointMissing: 'endpoint not configured',
      chatProtocolToolHint: 'Non-default protocols do not support tool calls yet, so web search is unavailable for this model',
      agentProtocolSupport: 'Agent Protocol Support',
      chat: 'Chat',
      vision: 'Vision',
      embedding: 'Embedding',
      tools: 'Tools',
      reasoning: 'Reasoning',
      imageGeneration: 'Image',
      videoGeneration: 'Video',
      rerank: 'Rerank',
      speech: 'Speech',
      transcription: 'Transcription',
      ocr: 'OCR',
      claudeCodeAgent: 'Claude Code Agent',
      openaiAgents: 'OpenAI Agents',
      newProviderName: 'New Model Provider'
    },
    preferences: {
      language: 'Language',
      displayStyle: 'Display Style',
      accentColor: 'Accent Color',
      timeZone: 'Time zone',
      timeZoneFollowSystem: 'Follow system',
      timeZoneSearch: 'Search time zones',
      timeZoneUnavailable: 'The system time zone is unavailable; times are shown in UTC.',
      proxyMode: 'Proxy Mode',
      proxyAddress: 'Proxy Address',
      proxyBypassRules: 'Proxy Bypass Rules',
      proxyRequestHint: 'App requests use the proxy settings here; the browser reaching a site does not mean the app can.',
      proxySelfTest: 'Test proxy',
      proxySelfTestRunning: 'Testing…',
      proxySelfTestPassed: (status, seconds, proxy) => `Proxy check: passed (HTTP ${status}, ${seconds}s, via ${proxy})`,
      proxySelfTestFailed: (code, host) => `Proxy check: failed (${code}) · target ${host}`,
      proxyAddressPlaceholder: 'e.g. socks5://127.0.0.1:6153',
      proxyBypassPlaceholder: 'localhost,127.0.0.1,::1',
      proxySystem: 'System Proxy',
      proxyCustom: 'Custom Proxy',
      proxyNone: 'No Proxy',
      chinese: '中文',
      english: 'English',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
      lime: 'Lime',
      cyan: 'Cyan',
      violet: 'Violet'
    },
    notifications: {
      channelsHeading: 'Delivery Channels',
      channelsDescription:
        'Control how the platform delivers messages. These are platform-level switches and apply across all products.',
      scopeNote:
        'Keep at least one lightweight channel enabled. Desktop delivery is useful away from the app, while popups are better for events that need immediate attention.',
      centerEnabled: 'Notification center',
      centerDescription: 'Keep an in-app record of notifications so results and system messages can be reviewed later.',
      desktopEnabled: 'Desktop notifications',
      desktopDescription: 'Use system notifications even when the app is not the active window.',
      toastEnabled: 'In-app toasts',
      toastDescription: 'Show lightweight banners inside the app for routine status changes and reminders.',
      popupEnabled: 'High-priority popups',
      popupDescription: 'Show stronger in-app popups for events that need immediate attention.'
    },
    webSearch: {
      title: 'Web Search',
      subtitle: 'Web search and page fetch for assistants.',
      general: 'General',
      searchProviders: 'Search providers',
      fetchProviders: 'Fetch providers',
      defaultBadge: 'Default',
      defaultCapabilities: 'Set as default capabilities',
      defaultCapabilitiesHint: 'Choose which capabilities this provider handles by default',
      defaultCapabilitiesMovedHint: 'Default capabilities are configured in General settings.',
      deferredBadge: 'Unavailable',
      moreProviders: (count) => `More providers (${count} unavailable)`,
      railNoteTitle: 'Notes',
      railGroupsHint: 'A provider can appear in both groups; "Default" reflects that group’s capability.',
      railNote: '"Unavailable" means planned but not usable in this version; the default provider applies to every assistant, and a single assistant can override it in its own settings.',
      enabled: 'Enabled',
      disabled: 'Disabled',
      providerSettings: 'Provider Settings',
      generalSettings: 'General Settings',
      searchWithDate: 'Attach current date',
      searchWithDateHint: 'Tells the model what "today" is; it does not affect historical asOf queries',
      maxResults: 'Max results',
      maxResultsHint: 'How many results one search returns (1–10)',
      defaultSearchProvider: 'Default search provider',
      defaultSearchProviderHint: 'A single assistant can override this',
      defaultFetchProvider: 'Default fetch provider',
      defaultFetchProviderHint: 'Used to fetch page text',
      summaryDefaultSearch: 'Search default',
      summaryFetch: 'Fetch default',
      summaryMaxResults: 'Max',
      summaryResultUnit: 'results',
      summaryCutoff: 'Cutoff',
      summaryBlacklist: 'Blacklist',
      summaryBlacklistUnit: 'domains',
      summaryWithDate: 'Attach date',
      summaryOn: 'On',
      summaryOff: 'Off',
      policyTab: 'Policy',
      providersTab: 'Providers',
      savePolicy: 'Save',
      defaultProvidersSection: 'Default providers',
      defaultProvidersHint: 'Only enabled providers are selectable; disabled ones are greyed out with a reason',
      defaultSearchRow: 'Search default',
      defaultFetchRow: 'Fetch default',
      resultsSection: 'Results',
      providerOptionReason: (name, reason) => `${name} (${reason})`,
      optionMissingKey: 'Missing key',
      providerFiltersAll: (count) => `All ${count}`,
      providerFilterSearch: 'Search',
      providerFilterFetch: 'Fetch',
      providerFilterDisabled: (count) => `Disabled ${count}`,
      providerTableName: 'Name',
      providerTableCapabilities: 'Capabilities',
      providerTableStatus: 'Status',
      providerTableDefault: 'Default',
      providerTableCredentials: 'Credentials',
      defaultSearchBadge: 'Search default',
      defaultFetchBadge: 'Fetch default',
      defaultReadonlyHint: 'Read-only: change default providers in Policy.',
      credentialKeySaved: (count) => (count ? `Key saved (${count} chars)` : 'Key saved'),
      credentialKeyMissing: 'Key not configured',
      credentialBasicSaved: 'Basic Auth saved',
      credentialBasicMissing: 'Basic Auth not configured',
      credentialNone: 'No credentials needed',
      configureProvider: 'Configure',
      deferredProviderHint: 'Planned, but not usable in this version.',
      drawerTitle: (name) => `Configure · ${name}`,
      drawerDefaultHint: 'Read-only: default capabilities are set in Policy',
      toggleImmediateHint: 'Takes effect immediately',
      builtinApiHost: 'Built-in address, read-only',
      capabilityJoin: ' · ',
      searchUnavailableDisabled: 'Search unavailable: the default provider is disabled',
      searchUnavailableMissingKey: 'Search unavailable: missing API key',
      fetchUnavailableDisabled: 'Page reading unavailable: the default provider is disabled',
      fetchUnavailableMissingKey: 'Page reading unavailable: missing API key',
      compression: 'Content compression',
      compressionMethod: 'Method',
      compressionMethodHint: 'RAG compression lands later',
      compressionNone: 'None',
      compressionCutoff: 'Cutoff',
      compressionRagDeferred: 'RAG (unavailable)',
      cutoffLimit: 'Cutoff limit',
      cutoffLimitHint: 'Text beyond this is truncated so whole pages do not fill the model',
      cutoffUnit: 'Cutoff unit',
      cutoffChars: 'Characters',
      cutoffTokens: 'Tokens',
      compressionEffect: (limit, unit) => `Effect: page text over ${limit} ${unit} is truncated; the first ${limit} ${unit} goes to the model.`,
      blacklist: 'Result blacklist',
      blacklistDomains: 'Domains',
      blacklistPlaceholder: 'Type a domain and press Enter, e.g. example.com / *.example.com',
      blacklistHint: 'Matching results are filtered before they reach the model',
      removeTag: (tag) => `Remove ${tag}`,
      subscriptionsDeferred: 'Subscription sync is a later capability. This version keeps only the settings seam.',
      apiKey: 'API Key',
      getApiKey: 'Get API Key',
      docs: 'Docs',
      fetchApiHostNote: 'Built-in direct fetch; no address needed',
      apiKeyRequiredHint: 'Required for authentication',
      invalidApiKeyError: (status) => `Invalid or expired API key (${status})`,
      missingApiKey: 'API key missing or invalid',
      apiKeyPlaceholder: 'Paste the API key (required)',
      savedApiKeyPlaceholder: 'API key saved. Leave blank to keep it',
      savedApiKeyMaskHint: 'The full key is never shown (security policy). Enter a new key to replace it.',
      savedKeyLength: (count) => `Saved (${count} chars)`,
      invalidApiKeyWithLength: (status, count) =>
        `Invalid or expired API key (${status}) · ${count} characters are saved; make sure the whole key was pasted`,
      invalidApiKeyCheckHint: 'Make sure the whole key was pasted (these keys are long), or regenerate it and paste again.',
      providerResponseInvalid: 'The provider did not return JSON (missing Accept header or unsupported endpoint capability).',
      noApiKeyHint: 'No key yet',
      showApiKey: 'Show API key',
      hideApiKey: 'Hide API key',
      replaceApiKey: 'Replace key',
      editApiKey: 'Edit API key',
      clickToReplace: 'Click to replace the key',
      revealApiKeyFailed: 'Could not read the saved key; keeping the mask.',
      revealApiKeyUnavailable: 'The app process is missing this interface; restart the app and retry.',
      revealApiKeyBridgeFailed: 'Failed to reach the main process; restart the app and retry.',
      revealApiKeyMissing: 'No saved key was found (it may have been removed).',
      retry: 'Retry',
      apiKeyRevealedHint: 'Full key visible; hides automatically after 30s (or on blur).',
      removeApiKey: 'Remove key',
      removeApiKeyConfirm: 'You will need to enter it again. Remove this key?',
      removeApiKeyConfirmAction: 'Remove',
      cancel: 'Cancel',
      apiHost: 'API Host',
      engines: 'Engines',
      enginesPlaceholder: 'Separate multiple engines with commas',
      basicAuthUsername: 'Basic Auth username',
      basicAuthPassword: 'Basic Auth password',
      enableProvider: 'Enable provider',
      checkProvider: 'Check provider',
      checkingProvider: 'Checking',
      checkSucceeded: 'Check succeeded',
      checkFailed: 'Check failed',
      saveProvider: 'Save provider',
      saveKeyAndAdvanced: 'Save key & advanced',
      savedImmediately: (enabled) => (enabled ? 'Enabled' : 'Disabled'),
      unsavedChanges: 'Unsaved changes',
      saveFailed: 'Save failed',
      toggleSaveFailed: 'Failed to save the toggle',
      defaultSaveFailed: 'Failed to save default capabilities',
      saveSettings: 'Save settings',
      saved: 'Saved',
      unsaved: 'Unsaved',
      loadFailed: 'Failed to load Web Search settings',
      noProviders: 'No providers available',
      providerDisabledHint: 'This provider is planned but not usable in this version.',
      currentInternetOnly: 'Web Search queries the current internet only; it is not replayable historical evidence.',
      capabilitySearchKeywords: 'Keyword search',
      capabilityFetchUrls: 'URL fetch',
      capabilitySearchShort: 'Search',
      capabilityFetchShort: 'Fetch',
      endpoint: 'Endpoint',
      phaseAvailable: 'Connected',
      phaseAvailableHint: 'This provider is connected; it does not mean it is configured and usable.',
      phaseDeferred: 'Unavailable'
    },
    storageCache: {
      title: 'Storage and Cache',
      subtitle: 'Rebuildable derived caches only. Credentials, messages, and source data are out of scope.',
      loading: 'Loading caches…',
      refresh: 'Refresh',
      dryRun: 'Dry run',
      dryRunHint: 'Preview only, no deletion',
      metaSummary: (caches, size, clearable, sensitive) =>
        `${caches} caches · ${size} total · ${clearable} clearable${sensitive > 0 ? ` · ${sensitive} hold user content` : ''}`,
      columnName: 'Cache',
      columnSize: 'Size',
      columnRecords: 'Records',
      columnStatus: 'Status',
      columnUpdated: 'Updated',
      columnActions: 'Actions',
      clear: 'Clear',
      compact: 'Compact',
      recheck: 'Recheck',
      recheckFailed: 'Recheck failed',
      flagSensitive: 'User content',
      filterEmpty: 'No caches in this category',
      noCaches: 'No registered caches yet',
      emptyValue: 'None',
      ownerPlatform: 'Platform',
      ownerProduct: (productId) => `Product: ${productId}`,
      tabAll: 'All',
      tabPlatform: 'Platform',
      tabAiRuntime: 'AI runtime',
      tabProducts: 'Products',
      tabDerivedData: 'Derived data',
      categoryPlatform: 'Platform',
      categoryAiRuntime: 'AI runtime',
      categoryProduct: 'Product',
      categoryDerivedData: 'Derived data',
      statusReady: 'Ready',
      statusEmpty: 'Empty',
      statusActive: 'Active',
      statusInspectionFailed: 'Inspection failed',
      statusSucceeded: 'Succeeded',
      statusFailed: 'Failed',
      statusSkipped: 'Skipped',
      neverInspected: 'Not inspected',
      fieldKind: 'Kind',
      fieldDurability: 'Durability',
      fieldSensitivity: 'Sensitivity',
      fieldLastUpdated: 'Updated',
      fieldRecordCount: 'Records',
      fieldSize: 'Size',
      fieldWarnings: 'Effects',
      fieldBackupPolicy: 'Backup',
      operationSuccess: 'Cache operation completed',
      operationFailed: 'Cache operation failed',
      confirmClear: (name) => `Clear cache "${name}"?`,
      confirmCompact: (name) => `Compact cache "${name}"?`,
      confirmSensitiveClear: 'This cache contains user content or secret references. Derived results will be rebuilt after clearing.',
      confirmSensitiveCompact: 'This cache may delete derived records during compaction to reclaim space.',
      confirmDerivedWarning: 'Only registered derived caches are affected here; source-of-truth data and credentials are not deleted.',
      confirmDryRunHint: 'Dry run is enabled, so this action will only simulate the result.',
      historyTitle: 'Operations',
      historyEmpty: 'No operations yet',
      historyColumnCache: 'Cache',
      historyColumnOperation: 'Operation',
      historyColumnResult: 'Result',
      historyColumnTime: 'Time',
      historyDryRun: 'dry run',
      operationClear: 'Clear',
      operationCompact: 'Compact',
      operationInvalidate: 'Invalidate',
      backupExclude: 'Excluded from backup',
      backupInclude: 'Included in backup',
      backupMetadataOnly: 'Metadata only',
      toastCleared: (name, dryRun) => dryRun ? `Dry-run clear completed for "${name}"` : `Cleared "${name}"`,
      toastCompacted: (name, dryRun) => dryRun ? `Dry-run compaction completed for "${name}"` : `Compacted "${name}"`,
      toastSkipped: (name) => `No changes were needed for "${name}"`,
      kindMemory: 'Memory',
      kindRuntimeHandle: 'Runtime handle',
      kindJsonFile: 'JSON file',
      kindSqliteDerived: 'SQLite derived data',
      kindLocalStorage: 'Local storage',
      kindParquetPartition: 'Parquet partition',
      durabilitySessionOnly: 'Session only',
      durabilityPersistedDerived: 'Persisted derived',
      durabilityRebuildable: 'Rebuildable',
      durabilityUserDataLike: 'User-data-like',
      sensitivityNone: 'None',
      sensitivityContainsUserContent: 'Contains user content',
      sensitivityContainsSecretRef: 'Contains secret references'
    }
  }
}

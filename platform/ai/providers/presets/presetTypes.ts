import type {
  ModelCapabilities,
  ProviderChatEndpoint,
  ProviderWebsiteLinks
} from '../modelProviderTypes'

export type PresetModelInput = {
  id: string
  name?: string
  group?: string
  capabilities?: Partial<ModelCapabilities>
}

/**
 * 预设配置只声明**事实**：端点是**一份有序清单**，`[0]` 就是默认端点。
 *
 * 旧形状把同一件事拆成"协议清单" + "端点覆盖" + "默认端点"三个字段，合并时任何一处被覆盖
 * 都会让请求打到错地址；现在每家的端点（协议 + base，已去尾斜杠）
 * 直接写出来：空串 = 已声明但还没配置地址。请求 URL 一律由 `providerEndpoints` 计算。
 *
 * **纯展示元数据**（分类、可达性）也写在同一条配置里：分类 = 它所在的
 * 预设文件（见 `presets/groups.ts`），可达性 = `requiresProxy`。两者都不进 ModelProvider
 * 契约、不写设置、不做持久化，但只允许有这一个来源 —— 不再维护平行的 id 清单。
 */
/**
 * 这家厂商的**模型列表接口能提供多少协议信息**（实测结论）。
 *
 * 决定供应商详情顶部是否提示"要去检测模型"：
 *  - `declared`       逐模型声明协议（LANYUN 的 api_paths、TokenRhythm 的 supports_*）⇒ 不提示
 *  - `endpoint-types` 只声明端点/端点类型，不说协议（Poe、AIHubMix、BurnCloud）⇒ 不提示
 *  - `single-hint`    只给单一子串，判断不了模型能给什么用（DeepSeek 只声明 anthropic_messages）⇒ 提示
 *  - `none`           完全没有协议信息 ⇒ 提示
 *  - `protocol-agnostic` 网关层做格式转换，三条协议对**全部模型**都可用
 *                     （OpenRouter 实测：用 minimax 免费模型发 messages / responses 都 200）
 *                     ⇒ 不提示，也不需要逐模型探测
 *  - `native`         官方直连：协议由 API 本身决定（OpenAI 的 chat/responses、
 *                     Anthropic 的 messages、Gemini 的原生 generateContent），列表不给协议
 *                     是正常的，**不需要**逐模型探测 ⇒ 不提示
 *
 * **缺省 = 还没测过**：不提示（不给没有依据的警告）。
 */
export type PresetProtocolDeclaration =
  | 'declared'
  | 'endpoint-types'
  | 'single-hint'
  | 'none'
  | 'protocol-agnostic'
  | 'native'

export type ProviderPresetInput = {
  id: string
  name: string
  /** 有序端点清单（`[0]` = 默认端点）；空数组 = 没有任何可用端点。 */
  endpoints: readonly ProviderChatEndpoint[]
  /**
   * 国内网络环境下是否通常需要代理访问（左栏「需代理」标签的唯一来源）。
   * 缺省 ⇒ 直连；未收录的自定义供应商同样走直连兜底。属经验数据，可按需修正。
   */
  requiresProxy?: boolean
  /** 模型列表的协议声明覆盖情况；缺省 = 未测（不提示）。 */
  protocolDeclaration?: PresetProtocolDeclaration
  models?: readonly PresetModelInput[]
  websites?: ProviderWebsiteLinks
}

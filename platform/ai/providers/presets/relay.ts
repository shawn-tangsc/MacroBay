import type { ProviderPresetInput } from './presetTypes'

/**
 * 预设数据：中转 / 聚合（relay）：一个入口调多家模型的中转站与聚合站。
 *
 * **分类就是所在文件**：一家供应商写在这里，它的左栏分类就是 `relay`，
 * 不再有第二份 id 清单。
 *
 * 纯数据：只声明事实。聊天端点写在 `endpoints`（`[0]` = 默认端点，base 已去尾斜杠；
 * 空串 = 已声明未配置地址），请求 URL 由 `providerEndpoints` 统一拼接，不在配置里重复。
 * 组内顺序即左栏渲染顺序；全局顺序见 `presets/groups.ts`。
 *
 * 「获取密钥」(`websites.apiKey`) 来源：各供应商官方文档与控制台路由；
 * 我们自己的邀请链接优先且**不覆盖**；只给站点根的家在行内注释写明人工映射依据。
 * 守卫见 `providerKeyLinks.test.ts`，UI 解析口径见 `resolveProviderKeyUrl`。
 */
export const relayPresets = [
  {
    id: 'silicon',
    name: 'Silicon',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
      { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
    ],
    models: [
      { id: 'deepseek-ai/DeepSeek-V3.2', group: 'deepseek-ai' },
      { id: 'deepseek-ai/DeepSeek-R1', group: 'deepseek-ai' },
      { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507', name: 'Qwen3-235B-A22B-Instruct-2507', group: 'Qwen' }
    ],
    websites: {
      // PLAT-61：这里的 `apiKey` 是**邀请/推广链接**（产品 owner 指定），用于设置页
      // 「点击这里获取密钥」。它不是普通控制台入口，改回普通地址前请先确认推广归属。
      official: 'https://cloud.siliconflow.cn',
      apiKey: 'https://cloud.siliconflow.cn/i/9GmeSjFn',
      docs: 'https://docs.siliconflow.cn/',
      models: 'https://cloud.siliconflow.cn/models'
    }
  },
  {
    id: 'tokenrhythm',
    name: 'TokenRhythm',
    protocolDeclaration: 'declared',
    // PLAT-77：实测 `POST /v1/responses` 返回 400（`max_output_tokens` 校验错误，OpenAI 形状），
    // 不是 404 ⇒ 该端点存在；模型级能否用 responses 由各自的 `responsesSupport` 决定。
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' },
      { protocol: 'responses', baseUrl: 'https://tokenrhythm.studio/v1' },
      { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' }
    ],
    models: [],
    websites: {
      // 「供应商控制台」指向真实控制台；「获取密钥」用下方 `apiKey` 的邀请链接。
      official: 'https://tokenrhythm.studio/account',
      apiKey: 'https://tokenrhythm.studio/i/rf_tr_C4LK8Z?share_id=ad1db639-8069-4f57-9c08-fa4a114a276d',
      docs: 'https://tokenrhythm.studio/docs/overview'
    }
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    protocolDeclaration: 'endpoint-types',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://aihubmix.com' },
      // 实测（2026-10-21，带 Key）：`POST /v1/responses` 与
      // `POST /gemini/v1beta/models/{id}:generateContent`（需 `x-goog-api-key`）都存在——
      // 两者都走到应用层的计费校验（余额不足 403），而 `/v1/__nope__` 是 404。
      // 模型列表里也有 14 条声明 `responses`、11 条声明 `gemini_api`。
      { protocol: 'responses', baseUrl: 'https://aihubmix.com/v1' },
      { protocol: 'messages', baseUrl: 'https://aihubmix.com' },
      { protocol: 'gemini', baseUrl: 'https://aihubmix.com/gemini' }
    ],
    requiresProxy: true,
    models: [
      { id: 'gpt-5', group: 'OpenAI' },
      { id: 'gpt-5-mini', group: 'OpenAI' },
      { id: 'gpt-5-chat-latest', group: 'OpenAI' },
      { id: 'DeepSeek-V3', group: 'DeepSeek' },
      { id: 'DeepSeek-R1', group: 'DeepSeek' },
      { id: 'claude-sonnet-4-20250514', group: 'Claude' },
      { id: 'gemini-2.5-pro', group: 'Gemini' },
      { id: 'gemini-2.5-flash', group: 'Gemini' },
      // 免费模型（`https://aihubmix.com/models?tag=free`，$0/M；产品 owner 指定内置）。
      // 说明：带 `-free` 后缀的 id 取自官方模型页文案；Qwen 两项的 id 若与官方「Copy ID」不一致，
      // 用户可在模型行的 ⚙ 里直接改 id（不影响已有模型）。
      { id: 'qwen3.8-flash', group: 'Free' },
      { id: 'qwen3.8-max', group: 'Free' },
      { id: 'xiaomi-mimo-v2.6-pro-free', group: 'Free' },
      { id: 'xiaomi-mimo-v2.6-flash-free', group: 'Free' },
      { id: 'decision-model-preview', group: 'Free' },
      { id: 'jina-ocr-v1', group: 'Free' }
    ],
    websites: {
      official: 'https://aihubmix.com',
      // 邀请链接（产品 owner 指定）：仅「获取密钥」入口走邀请链接。
      apiKey: 'https://aihubmix.com/?aff=Rs0c',
      docs: 'https://doc.aihubmix.com/',
      models: 'https://aihubmix.com/models'
    }
  },
  {
    id: 'ocoolai',
    name: 'ocoolAI',
    // 实测（2026-10-21）：`api.ocoolai.com` 已经连不上（DNS 有记录但连接被拒，0.03s），
    // 实际服务在 `one.ocoolai.com`；`POST /v1/messages` 对 claude-sonnet-4 返回 200。
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://one.ocoolai.com' },
      { protocol: 'messages', baseUrl: 'https://one.ocoolai.com' }
    ],
    models: [
      { id: 'deepseek-chat', group: 'DeepSeek' },
      { id: 'deepseek-reasoner', group: 'DeepSeek' },
      { id: 'gpt-4o', group: 'OpenAI' },
      { id: 'gpt-4o-mini', group: 'OpenAI' }
    ],
    websites: {
      official: 'https://one.ocoolai.com/',
      apiKey: 'https://one.ocoolai.com/token',
      docs: 'https://docs.ocoolai.com/',
      models: 'https://api.ocoolai.com/info/models/'
    }
  },
  {
    id: 'aionly',
    name: 'AIOnly',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://llm.aiionly.com' },
      { protocol: 'messages', baseUrl: 'https://llm.aiionly.com' }
    ],
    // 官方控制台标注：OpenAI 兼容 = https://llm.aiionly.com/v1/chat/completions，
    // Anthropic 兼容 = https://llm.aiionly.com/v1/messages（产品 owner 提供截图核对）。
    models: [
      // 实际 id 取自 AIOnly `/v1/models`（`deepseek-chat` / `gpt-4o` 在该平台不存在）。
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', group: 'DeepSeek' },
      { id: 'deepseek-r1-0528', name: 'DeepSeek R1 0528', group: 'DeepSeek' },
      { id: 'qwen3-235b-a22b', name: 'Qwen3 235B A22B', group: 'Qwen' },
      { id: 'qwen3-max-vip', name: 'Qwen3 Max VIP', group: 'Qwen' }
    ],
    websites: {
      // 邀请链接（产品 owner 指定）：官网入口同样走邀请链接。
      official: 'https://maas.aiionly.com',
      apiKey: 'https://maas.aiionly.com/login?inviteCode=8566406797',
      docs: 'https://maas.aiionly.com/document'
    }
  },
  {
    id: 'burncloud',
    name: 'BurnCloud',
    protocolDeclaration: 'endpoint-types',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://ai.burncloud.com' },
      { protocol: 'messages', baseUrl: 'https://ai.burncloud.com' },
      // 实测（2026-10-21，带 Key）：`gemini-2.5-flash` 走
      // `POST /v1beta/models/gemini-2.5-flash:generateContent` 返回 200（candidates 形状），
      // 与它列表里 30 条 `supported_endpoint_types: [...,"gemini"]` 的声明一致。
      { protocol: 'gemini', baseUrl: 'https://ai.burncloud.com' }
    ],
    // 实测 `POST /v1/messages` 返回 401（而非 404）⇒ 该端点存在（new-api 系支持 Anthropic 格式）。
    // **不要**声明 responses：路由存在（空 body 400）但真实请求返回
    // `500 not implemented`（new_api_error）⇒ 只是注册了路径。
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', group: 'Gemini 2.5' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', group: 'Gemini 2.5' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', group: 'deepseek-ai' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', group: 'deepseek-ai' }
    ],
    websites: {
      // 「供应商控制台」指向真实控制台；「获取密钥」用下方 `apiKey` 的邀请链接。
      official: 'https://ai.burncloud.com/',
      apiKey: 'https://ai.burncloud.com/register?aff=Uwn0',
      docs: 'https://ai.burncloud.com/docs',
      models: 'https://ai.burncloud.com/pricing'
    }
  },
  {
    id: 'cephalon',
    name: 'Cephalon',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://cephalon.cloud/user-center/v1/model' },
      { protocol: 'messages', baseUrl: 'https://cephalon.cloud/user-center/v1' }
    ],
    // 实测：`POST /user-center/v1/messages` 返回 401（Anthropic 风格错误）⇒ 该端点存在，
    // 且**路径与 OpenAI 不同**（OpenAI 是 `/user-center/v1/model/chat/completions`）。
    models: [
      { id: 'deepseek-chat', group: 'DeepSeek' },
      { id: 'gpt-4o', group: 'OpenAI' }
    ],
    websites: {
      // 「供应商控制台」指向真实控制台；「获取密钥」用下方 `apiKey` 的邀请链接。
      official: 'https://cephalon.cloud',
      apiKey: 'https://cephalon.cloud/share/register-landing?invite_id=s2y8zQ',
      docs: 'https://cephalon.cloud/apitoken/1864244127731589124',
      models: 'https://cephalon.cloud/model'
    }
  },
  {
    id: 'lanyun',
    name: 'LANYUN',
    protocolDeclaration: 'declared',
    // PLAT-77：实测 `x_lanyun.api_paths` 里有模型声明 `/v1/responses` ⇒ 该供应商确实提供 Responses 端点，
    // 因此在预设里声明出来（模型能否用 responses 由各自的 `responsesSupport` 决定，不在这里替模型表态）。
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://maas-api.lanyun.net' },
      { protocol: 'responses', baseUrl: 'https://maas-api.lanyun.net/v1' },
      { protocol: 'messages', baseUrl: 'https://maas-api.lanyun.net' }
    ],
    models: [
      { id: 'deepseek-ai/DeepSeek-R1', group: 'deepseek-ai' },
      { id: 'deepseek-ai/DeepSeek-V3', group: 'deepseek-ai' }
    ],
    websites: {
      // 「供应商控制台」指向真实控制台；「获取密钥」用下方 `apiKey` 的邀请链接。
      official: 'https://console.lanyun.net/',
      apiKey: 'https://console.lanyun.net/#/register?promoterCode=9847f33a11',
      docs: 'https://archive.lanyun.net/#/maas/',
      models: 'https://maas.lanyun.net/#/model/modelSquare'
    }
  },
  {
    id: 'ph8',
    name: 'PH8',
    // 实测（2026-10-21，带 Key）：列表 75 条只有 id/object/created/owned_by，
    // 没有价格、上下文、协议 ⇒ 归到"列表不返回协议"，同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://ph8.co' },
      { protocol: 'responses', baseUrl: 'https://ph8.co/v1' },
      { protocol: 'messages', baseUrl: 'https://ph8.co' }
    ],
    // 官方列表已无 `deepseek-v3-241226` / `deepseek-r1-250120`，换成在列表里的 id。
    models: [
      { id: 'deepseek-v4.1-flash', group: 'DeepSeek' },
      { id: 'deepseek-r1', group: 'DeepSeek' }
    ],
    websites: {
      official: 'https://ph8.co',
      apiKey: 'https://ph8.co/console/keys',
      docs: 'https://m1r239or5aw.feishu.cn/wiki/SegzwS4x1i2P4OksFY2cMvujn9f',
      models: 'https://ph8.co/v1/models'
    }
  },
  {
    id: 'sophnet',
    name: 'SophNet',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://www.sophnet.com/api/open-apis/v1' },
      { protocol: 'messages', baseUrl: 'https://www.sophnet.com/api/open-apis/v1' }
    ],
    websites: {
      official: 'https://sophnet.com',
      apiKey: 'https://sophnet.com/#/project/key',
      docs: 'https://sophnet.com/docs/component/introduce.html',
      models: 'https://sophnet.com/#/model/list'
    }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    // 列表没有逐模型协议，原因是**不需要**：网关层把三种格式互相转换，
    // 实测拿 minimax 免费模型发 messages / responses 都返回 200。
    protocolDeclaration: 'protocol-agnostic',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://openrouter.ai/api/v1' },
      // 实测（2026-10-21，带 Key）：/api/v1/responses 与 /api/v1/messages 对免费模型均返回 200。
      { protocol: 'responses', baseUrl: 'https://openrouter.ai/api/v1' },
      { protocol: 'messages', baseUrl: 'https://openrouter.ai/api' }
    ],
    requiresProxy: true,
    models: [
      { id: 'google/gemini-2.5-flash-preview', name: 'Google: Gemini 2.5 Flash Preview', group: 'google' },
      { id: 'qwen/qwen-2.5-7b-instruct:free', name: 'Qwen: Qwen-2.5-7B Instruct', group: 'qwen' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek: V3', group: 'deepseek' },
      { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral: Mistral 7B Instruct', group: 'mistralai' }
    ],
    websites: {
      official: 'https://openrouter.ai/',
      apiKey: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs/quick-start',
      models: 'https://openrouter.ai/models'
    }
  },
  {
    id: 'poe',
    name: 'Poe',
    protocolDeclaration: 'endpoint-types',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.poe.com/v1' },
      { protocol: 'responses', baseUrl: 'https://api.poe.com/v1' },
      { protocol: 'messages', baseUrl: 'https://api.poe.com/v1' }
    ],
    requiresProxy: true,
    // 实测（2026-10-21）：旧 id `GPT-4o` / `Claude-Sonnet-4` 已不在官方列表，换成在列表里的。
    models: [
      { id: 'gpt-5-mini', group: 'OpenAI' },
      { id: 'claude-opus-4.8', group: 'Anthropic' }
    ],
    websites: {
      official: 'https://poe.com/',
      apiKey: 'https://poe.com/api/keys',
      docs: 'https://creator.poe.com/docs/external-applications/openai-compatible-api',
      models: 'https://poe.com/'
    }
  },
] as const satisfies readonly ProviderPresetInput[]

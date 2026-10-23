import type { ProviderPresetInput } from './presetTypes'

/**
 * 预设数据：国内站（domestic）：国内模型厂 + 国内云 / 推理托管站点。
 *
 * **分类就是所在文件**：一家供应商写在这里，它的左栏分类就是 `domestic`，
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
export const domesticPresets = [
  {
    id: 'zhipu',
    name: 'ZhiPu',
    // 实测（2026-10-21，带 Key）：`/api/paas/v4/models` 11 条，只有 id/object/created/owned_by
    // ⇒ 没有价格/上下文/协议，同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      { protocol: 'messages', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }
    ],
    // 官方列表 11 条：glm-4.5 / 4.5-air / 4.6 / 4.7 / 5 / 5-turbo / 5.1 / 5.2 / 5.3 /
    // 5.3-flash / 5.3-flashx。原来的 `glm-4.5v` 已不在列表。
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', group: 'GLM' },
      { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', group: 'GLM' },
      { id: 'glm-5', name: 'GLM-5', group: 'GLM' },
      { id: 'glm-4.7', name: 'GLM-4.7', group: 'GLM' }
    ],
    websites: {
      official: 'https://open.bigmodel.cn/',
      apiKey: 'https://open.bigmodel.cn/apikey/platform',
      docs: 'https://docs.bigmodel.cn/',
      models: 'https://open.bigmodel.cn/modelcenter/square'
    }
  },
  {
    id: 'deepseek',
    name: 'deepseek',
    protocolDeclaration: 'single-hint',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' },
      // 实测（2026-10-21，带 Key）：`/v1/responses` 对 deepseek-flash / deepseek-v4-pro
      // 返回 200（Responses 形状）；空 body 时 422 里点名 `ResponsesApiRequest`。
      { protocol: 'responses', baseUrl: 'https://api.deepseek.com/v1' },
      { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
    ],
    // 官方 `/v1/models` 只列 deepseek-flash / deepseek-v4-pro；deepseek-chat / deepseek-reasoner /
    // deepseek-v4-flash 已不在列表里，但实测仍可调用（隐藏别名），先保留。
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', group: 'DeepSeek', capabilities: { tools: true, vision: true, reasoning: true, agentRuntimes: { claudeCode: true } } },
      { id: 'deepseek-v4-flash', group: 'DeepSeek', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'deepseek-v4-pro', group: 'DeepSeek', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'deepseek-chat', group: 'DeepSeek', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'deepseek-reasoner', group: 'DeepSeek', capabilities: { agentRuntimes: { claudeCode: true } } }
    ],
    websites: {
      official: 'https://deepseek.com/',
      apiKey: 'https://platform.deepseek.com/api_keys',
      docs: 'https://platform.deepseek.com/api-docs/',
      models: 'https://platform.deepseek.com/api-docs/'
    }
  },
  {
    id: 'ppio',
    name: 'PPIO',
    // 列表逐模型声明 `endpoints`（chat/completions、anthropic、responses）⇒ 端点类型档。
    protocolDeclaration: 'endpoint-types',
    endpoints: [
      // 官方文档给的 base 是 `https://api.ppio.com/openai`；
      // 旧品牌域名 `api.ppinfra.com/v3/openai` 仍然可用，这里统一到文档口径。
      { protocol: 'chat-completions', baseUrl: 'https://api.ppio.com/openai' },
      // 实测（2026-10-21）：`/openai/v1/responses` 空 body → 404 MODEL_NOT_FOUND（路由存在），
      // 对照 `/openai/v1/__nope__` → 404 page not found。
      { protocol: 'responses', baseUrl: 'https://api.ppio.com/openai' },
      // Anthropic 兼容入口在**另一个域名**上（官方文档 llm-anthropic-compatibility 的
      // `ANTHROPIC_BASE_URL`）：`https://api.ppio.com/anthropic`，与 chat 用的
      // `api.ppinfra.com` 不是同一台。
      // 实测（2026-10-21）：`/anthropic/v1/messages` 空 body → 404 MODEL_NOT_FOUND（路由存在、
      // 只缺 model），对照 `/anthropic/v1/__nope__` → 404 page not found。
      { protocol: 'messages', baseUrl: 'https://api.ppio.com/anthropic' }
    ],
    // 旧预设模型（deepseek-v3.2 / qwen3-235b）已不在列表，换成在列表里的。
    models: [
      { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', group: 'deepseek' },
      { id: 'zai-org/glm-5.3', name: 'GLM-5.3', group: 'zai-org' }
    ],
    websites: {
      official: 'https://ppio.com',
      apiKey: 'https://ppio.com/settings/key-management',
      docs: 'https://ppio.com/model-api',
      models: 'https://ppio.com/model-api/product/llm-api'
    }
  },
  {
    id: 'dashscope',
    name: 'Bailian',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { protocol: 'messages', baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic' }
    ],
    models: [
      { id: 'qwen3.5-plus', name: 'Qwen3.5-Plus', group: 'Qwen' },
      { id: 'qwen3.5-flash', name: 'Qwen3.5-Flash', group: 'Qwen' },
      { id: 'qwen3-max', name: 'Qwen3-Max', group: 'Qwen' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', group: 'Kimi' },
      { id: 'glm-5', name: 'GLM-5', group: 'GLM' },
      { id: 'MiniMax/MiniMax-M2.5', name: 'MiniMax M2.5', group: 'MiniMax' },
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', group: 'DeepSeek' }
    ],
    websites: {
      // 邀请有礼链接（产品 owner 指定）：官网/获取密钥入口都走邀请链接。
      official: 'https://bailian.console.aliyun.com/',
      apiKey: 'https://www.aliyun.com/benefit/ai/aistar?clubBiz=subTask..12939034..10274..',
      docs: 'https://help.aliyun.com/zh/model-studio/getting-started/',
      models: 'https://bailian.console.aliyun.com/?tab=model#/model-market'
    }
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    // 实测（2026-10-21，带 Key）：`/v1/models` 9 条只有 id/object/created/owned_by
    // ⇒ 没有价格/上下文/协议，同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.minimaxi.com/v1' },
      // 实测：三条协议都真实存在（都返回 402 insufficient balance，对照 404 page not found）：
      // `/v1/chat/completions`、`/anthropic/v1/messages`、**`/v1/responses`**（此前未声明）。
      { protocol: 'responses', baseUrl: 'https://api.minimaxi.com/v1' },
      { protocol: 'messages', baseUrl: 'https://api.minimaxi.com/anthropic' }
    ],
    // 官方列表 9 条；旧预设模型 `abab6.5s-chat` 已不在列表。
    models: [
      { id: 'MiniMax-M3.1-Flash', group: 'MiniMax' },
      { id: 'MiniMax-M2.7', group: 'MiniMax' },
      { id: 'MiniMax-M2.5', group: 'MiniMax' }
    ],
    websites: {
      official: 'https://platform.minimaxi.com/',
      apiKey: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      docs: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
      models: 'https://platform.minimaxi.com/document/Models'
    }
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.moonshot.cn' },
      // 实测（2026-10-21，带 Key）：`POST /v1/responses` 对 kimi-k3 返回 200（Responses 形状）；
      // chat 与 `/anthropic/v1/messages` 同样 200。
      { protocol: 'responses', baseUrl: 'https://api.moonshot.cn/v1' },
      { protocol: 'messages', baseUrl: 'https://api.moonshot.cn/anthropic' }
    ],
    // 官方列表（2026-10）只有 kimi-k2.6 / kimi-k3 / kimi-k2.7-code / -highspeed；
    // 旧的 kimi-k2-0711-preview / moonshot-v1-128k 已不在列表里。
    models: [
      { id: 'kimi-k3', group: 'Kimi' },
      { id: 'kimi-k2.6', group: 'Kimi' }
    ],
    websites: {
      official: 'https://www.moonshot.cn/',
      apiKey: 'https://platform.moonshot.cn/console/api-keys',
      docs: 'https://platform.moonshot.cn/docs/'
    }
  },
  {
    id: 'qiniu',
    name: 'Qiniu',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.qnaigc.com' },
      { protocol: 'messages', baseUrl: 'https://api.qnaigc.com' }
    ],
    models: [
      { id: 'deepseek-v3', group: 'DeepSeek' },
      { id: 'deepseek-r1', group: 'DeepSeek' }
    ],
    websites: {
      // 「供应商控制台」指向真实控制台；「获取密钥」用下方 `apiKey` 的邀请链接。
      official: 'https://portal.qiniu.com/',
      apiKey: 'https://s.qiniu.com/EJraaq',
      docs: 'https://developer.qiniu.com/aitokenapi',
      models: 'https://developer.qiniu.com/aitokenapi/12883/model-list'
    }
  },
  {
    id: 'doubao',
    name: 'doubao',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
      { protocol: 'responses', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
      { protocol: 'messages', baseUrl: 'https://ark.cn-beijing.volces.com/api/compatible' }
    ],
    // 火山方舟三条官方路径（console docs / 模型列表；顺序 = 端点清单顺序）：
    //  chat        https://ark.cn-beijing.volces.com/api/v3/chat/completions
    //  responses   https://ark.cn-beijing.volces.com/api/v3/responses
    //  anthropic   https://ark.cn-beijing.volces.com/api/compatible/v1/messages  ← 不是 /api/v3
    // 产品决定（2026-10-19，二次确认）：**默认仍走 chat/completions** —— 工具调用（网页搜索）与流式
    // 都在这条链路上；Responses 端点预置好，需要的人可在模型抽屉里按模型显式切换（等 Responses
    // 补上工具 + 流式 + previous_response_id 后再考虑改默认）。
    // 顺序钉死：`endpoints[0]` 就是默认端点，这里放 chat/completions，避免以后调整清单时
    // 把默认链路悄悄换成 responses。
    // 模型 id 以方舟控制台「模型列表」文档为准（2026-10 这一代）：
    // 旧一代（doubao-seed-1-8-251228 / doubao-1-5-* / deepseek-r1-250120 / deepseek-v3-250324）
    // 在账号里已不存在，调用会返回 404 `InvalidEndpointOrModel`。
    models: [
      { id: 'doubao-seed-2-1-pro-260915', name: 'Doubao-Seed-2.1-pro', group: 'Doubao-Seed-2.1' },
      { id: 'doubao-seed-2-1-lite-260915', name: 'Doubao-Seed-2.1-lite', group: 'Doubao-Seed-2.1' },
      { id: 'doubao-seed-2-1-pro-260628', name: 'Doubao-Seed-2.1-pro-0628', group: 'Doubao-Seed-2.1' },
      { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao-Seed-2.1-turbo', group: 'Doubao-Seed-2.1' },
      { id: 'doubao-seed-2-0-pro-260215', name: 'Doubao-Seed-2.0-pro', group: 'Doubao-Seed-2.0' },
      { id: 'doubao-seed-2-0-lite-260215', name: 'Doubao-Seed-2.0-lite', group: 'Doubao-Seed-2.0' },
      { id: 'doubao-seed-2-0-mini-260215', name: 'Doubao-Seed-2.0-mini', group: 'Doubao-Seed-2.0' },
      { id: 'doubao-seed-evolving', name: 'Doubao-Seed-Evolving', group: 'Doubao-Seed' },
      { id: 'deepseek-v4-pro-260425', name: 'DeepSeek-V4-Pro', group: 'DeepSeek' },
      { id: 'deepseek-v4-flash-ga-260731', name: 'DeepSeek-V4-Flash', group: 'DeepSeek' },
      { id: 'deepseek-v4-1-flash-261017', name: 'DeepSeek-V4.1-Flash', group: 'DeepSeek' },
      { id: 'glm-5-2-260617', name: 'GLM-5.2', group: 'GLM' }
    ],
    websites: {
      official: 'https://console.volcengine.com/ark/',
      apiKey: 'https://www.volcengine.com/experience/ark',
      docs: 'https://www.volcengine.com/docs/82379/1182403'
    }
  },
  {
    id: 'baichuan',
    name: 'BAICHUAN AI',
    // 列表 8 条只有长度/工具位，没有协议信息 ⇒ 同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.baichuan-ai.com' },
      // 实测（2026-10-21，带 Key）：`/v1/responses` 对 Baichuan4-Air 返回 **200**（真生成）；
      // `/v1/messages` 与 `/anthropic/v1/messages` 都是 404 ⇒ 没有 Anthropic 兼容，不声明。
      { protocol: 'responses', baseUrl: 'https://api.baichuan-ai.com/v1' }
    ],
    models: [
      { id: 'Baichuan4-Turbo', group: 'Baichuan' },
      { id: 'Baichuan4-Air', group: 'Baichuan' }
    ],
    websites: {
      official: 'https://www.baichuan-ai.com/',
      apiKey: 'https://platform.baichuan-ai.com/console/apikey',
      docs: 'https://platform.baichuan-ai.com/docs',
      models: 'https://platform.baichuan-ai.com/prices'
    }
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    // 列表对 7 个语言模型逐条声明 `supported_protocols`（chat / messages / responses）。
    protocolDeclaration: 'declared',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.stepfun.com' },
      // 实测（2026-10-21，带 Key）：`/v1/responses` 与 `/v1/messages` 对 step-3.7-flash 都是 200；
      // `/anthropic/v1/messages` 同样 200（两条 Anthropic 入口都通）。
      { protocol: 'responses', baseUrl: 'https://api.stepfun.com/v1' },
      { protocol: 'messages', baseUrl: 'https://api.stepfun.com' }
    ],
    // 官方列表 33 条；旧的 step-1-8k / step-1-flash 已不在列表。
    models: [
      { id: 'step-5-preview', name: 'Step 5 Preview', group: 'Step' },
      { id: 'step-3.7-flash', name: 'Step 3.7 Flash', group: 'Step' }
    ],
    websites: {
      official: 'https://platform.stepfun.com/',
      apiKey: 'https://platform.stepfun.com/interface-key',
      docs: 'https://platform.stepfun.com/docs/api-reference/chat/chat-completion-create',
      models: 'https://platform.stepfun.com/docs/guides/models/overview'
    }
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    // 实测（2026-10-21，带 Key）：`/v1/models` 37 条只有 id/object/owned_by/created
    // ⇒ 没有价格/上下文/协议，同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api-inference.modelscope.cn/v1' },
      { protocol: 'responses', baseUrl: 'https://api-inference.modelscope.cn/v1' },
      { protocol: 'messages', baseUrl: 'https://api-inference.modelscope.cn' }
    ],
    // 官方列表 37 条；旧的 DeepSeek-R1 / DeepSeek-V3 已不在列表。
    models: [
      { id: 'deepseek-ai/DeepSeek-V4.1-Flash', group: 'deepseek-ai' },
      { id: 'deepseek-ai/DeepSeek-V4-Pro', group: 'deepseek-ai' },
      { id: 'Qwen/Qwen3.8-Flash-Next', group: 'Qwen' }
    ],
    websites: {
      official: 'https://modelscope.cn',
      apiKey: 'https://modelscope.cn/my/myaccesstoken',
      docs: 'https://modelscope.cn/docs/model-service/API-Inference/intro',
      models: 'https://modelscope.cn/models'
    }
  },
  {
    id: 'tokenhub',
    name: 'TokenHub',
    // 官方文档（product/1823）：兼容 **OpenAI 与 Anthropic 两种协议**，`GET /v1/models`
    // 返回 id/name/created/status，**没有价格/上下文/协议** ⇒ 同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      // 广州地域默认接入地址（新加坡用 tokenhub-intl.tencentmaas.com，备用 .cn 域名）。
      { protocol: 'chat-completions', baseUrl: 'https://tokenhub.tencentmaas.com' },
      // 实测（2026-10-21，假 Key）：`/v1/responses` 返回 401 业务错误，对照 404 page not found。
      { protocol: 'responses', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
      // `/v1/messages` 返回的是 **Anthropic 形状**的 401（`{"type":"error","error":{...}}`），
      // `/anthropic/v1/messages` 才是 404 ⇒ Anthropic 入口就挂在 `/v1/messages`。
      { protocol: 'messages', baseUrl: 'https://tokenhub.tencentmaas.com' }
    ],
    // 实测（2026-10-21，带 Key）119 条：online 115 / discontinued 2 / pre-offline 2。
    models: [
      { id: 'hy4-preview', name: 'Hy4 Preview', group: 'Hunyuan' },
      { id: 'hy3', name: 'Hy3', group: 'Hunyuan' },
      { id: 'deepseek-v4-pro-0813', name: 'DeepSeek-V4-Pro 0813', group: 'DeepSeek' },
      { id: 'glm-5.3', name: 'GLM-5.3', group: 'GLM' }
    ],
    websites: {
      official: 'https://cloud.tencent.com/product/tokenhub',
      apiKey: 'https://console.cloud.tencent.com/tokenhub/apikey',
      docs: 'https://cloud.tencent.com/document/product/1823/130077'
    }
  },
  {
    id: 'longcat',
    name: 'LongCat',
    // 列表 2 条只有上下文/输出上限，没有协议 ⇒ 同步后提示去「检测模型」。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.longcat.chat/openai' },
      // 实测（2026-10-21，带 Key）：`/openai/v1/responses` 对 LongCat-2.0 返回 200，此前未声明。
      { protocol: 'responses', baseUrl: 'https://api.longcat.chat/openai/v1' },
      { protocol: 'messages', baseUrl: 'https://api.longcat.chat/anthropic' }
    ],
    // 官方列表只有 LongCat-2.5-Preview / LongCat-2.0；旧的 Flash 系列已不在列表。
    models: [
      { id: 'LongCat-2.5-Preview', group: 'LongCat' },
      { id: 'LongCat-2.0', group: 'LongCat' }
    ],
    websites: {
      official: 'https://longcat.chat',
      apiKey: 'https://longcat.chat/platform/api_keys',
      docs: 'https://longcat.chat/docs'
    }
  },
  {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.xiaomimimo.com' },
      // 实测（2026-10-21，带 Key）：`/v1/responses` 对 mimo-v2.6-flash / -pro 返回 200
      // （Anthropic 的 messages 在 `/anthropic/v1/messages`，同样可用）。
      { protocol: 'responses', baseUrl: 'https://api.xiaomimimo.com/v1' },
      { protocol: 'messages', baseUrl: 'https://api.xiaomimimo.com/anthropic' }
    ],
    // 模型 id 以官方 `/v1/models` 为准（2026-10）：旧的 mimo-vl-7b / mimo-7b 已不在列表里；
    // asr / tts / tts-voiceclone / tts-voicedesign 是非聊天模型，不作为内置项。
    models: [
      { id: 'mimo-v2.6-flash', group: 'MiMo' },
      { id: 'mimo-v2.6-pro', group: 'MiMo' },
      { id: 'mimo-v2.6-pro-ultraspeed', group: 'MiMo' }
    ],
    websites: {
      official: 'https://platform.xiaomimimo.com',
      // 邀请有礼链接（产品 owner 指定）：从这里开通并领取额度、获取密钥。
      apiKey: 'https://platform.xiaomimimo.com?ref=YVDC37',
      docs: 'https://mimo.mi.com/docs'
    }
  }
] as const satisfies readonly ProviderPresetInput[]

import type { ProviderPresetInput } from './presetTypes'

/**
 * 预设数据：国际站（international）：国际模型厂 + 国际云 / 推理托管站点。
 *
 * **分类就是所在文件**：一家供应商写在这里，它的左栏分类就是 `international`，
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
export const internationalPresets = [
  {
    id: 'zai',
    name: 'Z.ai',
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.z.ai/api/paas/v4' },
      { protocol: 'messages', baseUrl: 'https://api.z.ai/api/anthropic' }
    ],
    models: [
      { id: 'glm-4.5', name: 'GLM-4.5', group: 'GLM' },
      { id: 'glm-4.5-air', name: 'GLM-4.5-Air', group: 'GLM' },
      // 免费模型（Z.ai 定价页 `Free`）：官方 /models 接口不返回，内置以便直接选用。
      { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash (free)', group: 'Free' },
      { id: 'glm-4.5-flash', name: 'GLM-4.5-Flash (free)', group: 'Free' }
    ],
    websites: {
      official: 'https://z.ai',
      // 邀请/订阅链接（产品 owner 指定）：订阅页可同时完成开通与获取密钥。
      apiKey: 'https://z.ai/subscribe?ic=4UPMI1LUMO',
      docs: 'https://docs.z.ai/',
      models: 'https://docs.z.ai/models'
    }
  },
  {
    id: 'minimax-global',
    name: 'MiniMax Global',
    // 实测（2026-10-21，带 Key，走代理）：`/v1/models` 9 条只有 id/object/created/owned_by，
    // 与国内站同一套 ⇒ `protocolDeclaration: 'none'`。
    protocolDeclaration: 'none',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.minimax.io/v1' },
      // 实测：`/v1/responses` 返回 402 余额不足（路由存在），对照 404 page not found ⇒ 补。
      { protocol: 'responses', baseUrl: 'https://api.minimax.io/v1' },
      { protocol: 'messages', baseUrl: 'https://api.minimax.io/anthropic' }
    ],
    // 列表 9 条：M3.1-Flash / M3 / M2.7 / M2.7-highspeed / M2.5 / M2.5-highspeed / M2.1 /
    // M2.1-highspeed / M2。
    models: [
      { id: 'MiniMax-M3.1-Flash', group: 'MiniMax' },
      { id: 'MiniMax-M2.5', group: 'MiniMax' }
    ],
    websites: {
      official: 'https://platform.minimax.io/',
      apiKey: 'https://platform.minimax.io/user-center/basic-information/interface-key',
      docs: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
      models: 'https://platform.minimax.io/document/Models'
    }
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    // 官方直连：协议由 API 本身决定，列表不给协议是正常的，**不需要**逐模型探测。
    protocolDeclaration: 'native',
    endpoints: [
      { protocol: 'messages', baseUrl: 'https://api.anthropic.com' }
    ],
    requiresProxy: true,
    // PLAT-69：Anthropic 官方默认走 `messages`（`/v1/messages`），不再绕 OpenAI 兼容层。
    models: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', group: 'Claude 4.7', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', group: 'Claude 4.6', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', group: 'Claude 4.6', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', group: 'Claude 4.5', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', group: 'Claude 4.5', capabilities: { agentRuntimes: { claudeCode: true } } },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', group: 'Claude 4.5', capabilities: { agentRuntimes: { claudeCode: true } } }
    ],
    websites: {
      official: 'https://anthropic.com/',
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/en/docs',
      models: 'https://docs.anthropic.com/en/docs/about-claude/models'
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    // 官方直连：协议由 API 本身决定，列表不给协议是正常的，**不需要**逐模型探测。
    protocolDeclaration: 'native',
    endpoints: [
      { protocol: 'responses', baseUrl: 'https://api.openai.com/v1' },
      { protocol: 'chat-completions', baseUrl: 'https://api.openai.com' }
    ],
    requiresProxy: true,
    // PLAT-69：OpenAI 官方默认走 `responses`（`/v1/responses`，`endpoints[0]`）；base 已带 `/v1`，
    // 客户端只补 `/responses`。
    models: [
      { id: 'gpt-5.4', name: 'GPT 5.4', group: 'gpt-5.4' },
      { id: 'gpt-5.4-pro', name: 'GPT 5.4 Pro', group: 'gpt-5.4' },
      { id: 'gpt-5.2', name: 'GPT 5.2', group: 'gpt-5.2' },
      { id: 'gpt-5.2-pro', name: 'GPT 5.2 Pro', group: 'gpt-5.2' },
      { id: 'gpt-5.1', name: 'GPT 5.1', group: 'gpt-5.1' },
      { id: 'gpt-5', name: 'GPT 5', group: 'gpt-5' },
      { id: 'gpt-5-pro', name: 'GPT 5 Pro', group: 'gpt-5' },
      { id: 'gpt-5-chat', name: 'GPT 5 Chat', group: 'gpt-5' },
      { id: 'gpt-image-1', name: 'GPT Image 1', group: 'gpt-image' }
    ],
    websites: {
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models'
    }
  },
  {
    id: 'gemini',
    name: 'Gemini',
    // 官方直连：协议由 API 本身决定，列表不给协议是正常的，**不需要**逐模型探测。
    protocolDeclaration: 'native',
    endpoints: [
      { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
    ],
    requiresProxy: true,
    // PLAT-66：默认端点就是**原生** gemini（主机名），聊天/探针拼
    // `/v1beta/models/{model}:generateContent`。
    // （把主机名当 OpenAI 兼容 base 用会拼出 `/v1/chat/completions`，Google 上没有这个路径。）
    models: [
      // Google 已停止向新用户开放 gemini-2.5-flash（404 提示改用 3.5-flash），默认给当前可用型号。
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', group: 'Gemini 3' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', group: 'Gemini 2.5' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', group: 'Gemini 2.5' },
      { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image', group: 'Gemini 2.5' },
      { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', group: 'Gemini 3' },
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', group: 'Gemini 3' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', group: 'Gemini 3' }
    ],
    websites: {
      official: 'https://gemini.google.com/',
      apiKey: 'https://aistudio.google.com/app/apikey',
      docs: 'https://ai.google.dev/gemini-api/docs',
      models: 'https://ai.google.dev/gemini-api/docs/models/gemini'
    }
  },
  {
    id: 'groq',
    name: 'Groq',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.groq.com/openai' },
      { protocol: 'messages', baseUrl: 'https://api.groq.com/openai' }
    ],
    requiresProxy: true,
    models: [
      { id: 'llama3-8b-8192', name: 'LLaMA3 8B', group: 'Llama3' },
      { id: 'llama3-70b-8192', name: 'LLaMA3 70B', group: 'Llama3' },
      { id: 'mistral-saba-24b', name: 'Mistral Saba 24B', group: 'Mistral' },
      { id: 'gemma-9b-it', name: 'Gemma 9B', group: 'Gemma' }
    ],
    websites: {
      official: 'https://groq.com/',
      apiKey: 'https://console.groq.com/keys',
      docs: 'https://console.groq.com/docs/quickstart',
      models: 'https://console.groq.com/docs/models'
    }
  },
  {
    id: 'together',
    name: 'Together',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.together.xyz' },
      { protocol: 'messages', baseUrl: 'https://api.together.xyz' }
    ],
    requiresProxy: true,
    models: [
      { id: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo', name: 'Llama-3.2-11B-Vision', group: 'Llama-3.2' },
      { id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', name: 'Llama-3.2-90B-Vision', group: 'Llama-3.2' },
      { id: 'google/gemma-2-27b-it', group: 'Gemma' }
    ],
    websites: {
      official: 'https://www.together.ai/',
      apiKey: 'https://api.together.ai/settings/projects/~current/api-keys',
      docs: 'https://docs.together.ai/docs/introduction',
      models: 'https://docs.together.ai/docs/serverless-models'
    }
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.fireworks.ai/inference' },
      { protocol: 'responses', baseUrl: 'https://api.fireworks.ai/inference/v1' },
      { protocol: 'messages', baseUrl: 'https://api.fireworks.ai/inference' }
    ],
    requiresProxy: true,
    models: [
      { id: 'accounts/fireworks/models/deepseek-v3p2', name: 'DeepSeek V3.2', group: 'DeepSeek' },
      { id: 'accounts/fireworks/models/deepseek-v4-pro', name: 'DeepSeek V4 Pro', group: 'DeepSeek' }
    ],
    websites: {
      official: 'https://fireworks.ai/',
      apiKey: 'https://fireworks.ai/account/api-keys',
      docs: 'https://docs.fireworks.ai/getting-started/introduction',
      models: 'https://fireworks.ai/dashboard/models'
    }
  },
  {
    id: 'nvidia',
    name: 'nvidia',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://integrate.api.nvidia.com' },
      { protocol: 'responses', baseUrl: 'https://integrate.api.nvidia.com/v1' }
    ],
    requiresProxy: true,
    models: [
      { id: 'meta/llama-3.1-405b-instruct', group: 'Llama' },
      { id: 'deepseek-ai/deepseek-r1', group: 'DeepSeek' }
    ],
    websites: {
      official: 'https://build.nvidia.com/explore/discover',
      apiKey: 'https://build.nvidia.com/meta/llama-3_1-405b-instruct',
      docs: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
      models: 'https://build.nvidia.com/nim'
    }
  },
  {
    id: 'grok',
    name: 'Grok',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.x.ai' },
      { protocol: 'responses', baseUrl: 'https://api.x.ai/v1' },
      { protocol: 'messages', baseUrl: 'https://api.x.ai' }
    ],
    requiresProxy: true,
    models: [
      { id: 'grok-4', group: 'Grok' },
      { id: 'grok-3', group: 'Grok' }
    ],
    websites: {
      official: 'https://x.ai/',
      // xAI 的 key 在 console.x.ai 创建（docs.x.ai quickstart），官网 x.ai 只是营销页。
      apiKey: 'https://console.x.ai/',
      docs: 'https://docs.x.ai/',
      models: 'https://docs.x.ai/docs/models'
    }
  },
  {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.hyperbolic.xyz' }
    ],
    requiresProxy: true,
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', group: 'DeepSeek' },
      { id: 'deepseek-ai/DeepSeek-R1', group: 'DeepSeek' }
    ],
    websites: {
      official: 'https://app.hyperbolic.xyz',
      // Hyperbolic 的 key 在 dashboard → Settings 创建。
      apiKey: 'https://app.hyperbolic.xyz/settings',
      docs: 'https://docs.hyperbolic.xyz',
      models: 'https://app.hyperbolic.xyz/models'
    }
  },
  {
    id: 'mistral',
    name: 'Mistral',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.mistral.ai' }
    ],
    requiresProxy: true,
    models: [
      { id: 'mistral-large-latest', group: 'Mistral' },
      { id: 'ministral-8b-latest', group: 'Mistral' }
    ],
    websites: {
      official: 'https://mistral.ai',
      apiKey: 'https://console.mistral.ai/api-keys/',
      docs: 'https://docs.mistral.ai',
      models: 'https://docs.mistral.ai/getting-started/models/models_overview'
    }
  },
  {
    id: 'cerebras',
    name: 'Cerebras AI',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.cerebras.ai/v1' },
      { protocol: 'messages', baseUrl: 'https://api.cerebras.ai/v1' }
    ],
    requiresProxy: true,
    models: [
      { id: 'llama3.1-8b', group: 'Llama' },
      { id: 'qwen-3-235b-a22b', group: 'Qwen' }
    ],
    websites: {
      official: 'https://cerebras.ai',
      apiKey: 'https://cloud.cerebras.ai',
      docs: 'https://inference-docs.cerebras.ai/'
    }
  },
] as const satisfies readonly ProviderPresetInput[]

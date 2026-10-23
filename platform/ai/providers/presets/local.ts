import type { ProviderPresetInput } from './presetTypes'

/**
 * 预设数据：本地运行（local）：本机 / 内网部署的推理运行时。
 *
 * **分类就是所在文件**：一家供应商写在这里，它的左栏分类就是 `local`，
 * 不再有第二份 id 清单。
 *
 * 纯数据：只声明事实。聊天端点写在 `endpoints`（`[0]` = 默认端点，base 已去尾斜杠；
 * 空串 = 已声明未配置地址），请求 URL 由 `providerEndpoints` 统一拼接，不在配置里重复。
 * 组内顺序即左栏渲染顺序；全局顺序见 `presets/groups.ts`。
 *
 * **没有「获取密钥」入口**（`websites.apiKey` 一律不写）：key 由本机运行时自己提供
 * （或压根不需要），不存在厂商 key 页 ⇒ 设置页不给「点击这里获取密钥」。
 * 这几家是 `providerKeyLinks.test.ts` 里 KEYLESS 白名单的数据来源。
 */
export const localPresets = [
  {
    id: 'ovms',
    name: 'OpenVINO Model Server',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'http://localhost:8000/v3' }
    ],
    websites: {
      official: 'https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/overview.html',
      docs: 'https://docs.openvino.ai/2025/model-server/ovms_what_is_openvino_model_server.html'
    }
  },
  {
    id: 'ollama',
    name: 'Ollama',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'http://localhost:11434' },
      { protocol: 'messages', baseUrl: 'http://localhost:11434' }
    ],
    websites: {
      official: 'https://ollama.com/',
      docs: 'https://github.com/ollama/ollama/tree/main/docs',
      models: 'https://ollama.com/library'
    }
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'http://localhost:1234' },
      { protocol: 'messages', baseUrl: 'http://localhost:1234' }
    ],
    websites: {
      official: 'https://lmstudio.ai/',
      docs: 'https://lmstudio.ai/docs',
      models: 'https://lmstudio.ai/models'
    }
  },
  {
    id: 'gpustack',
    name: 'GPUStack',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: '' }
    ],
    websites: {
      official: 'https://gpustack.ai/',
      docs: 'https://docs.gpustack.ai/latest/',
      models: 'https://docs.gpustack.ai/latest/overview/#supported-models'
    }
  },
] as const satisfies readonly ProviderPresetInput[]

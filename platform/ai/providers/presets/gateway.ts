import type { ProviderPresetInput } from './presetTypes'

/**
 * 预设数据：网关（gateway）：自建或第三方网关（转发到任意上游）。
 *
 * **分类就是所在文件**：一家供应商写在这里，它的左栏分类就是 `gateway`，
 * 不再有第二份 id 清单。
 *
 * 纯数据：只声明事实。聊天端点写在 `endpoints`（`[0]` = 默认端点，base 已去尾斜杠；
 * 空串 = 已声明未配置地址），请求 URL 由 `providerEndpoints` 统一拼接，不在配置里重复。
 * 组内顺序即左栏渲染顺序；全局顺序见 `presets/groups.ts`。
 *
 * **没有「获取密钥」入口**（`websites.apiKey` 不写）：New API 是自建网关，
 * key 由部署者/管理员在本机生成，没有第三方 key 页（同 `local` 类，见
 * `providerKeyLinks.test.ts` 的 KEYLESS 白名单）。
 */
export const gatewayPresets = [
  {
    id: 'new-api',
    name: 'New API',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'http://localhost:3000' },
      { protocol: 'messages', baseUrl: 'http://localhost:3000' }
    ],
    websites: {
      official: 'https://docs.newapi.pro/',
      docs: 'https://docs.newapi.pro'
    }
  },
] as const satisfies readonly ProviderPresetInput[]

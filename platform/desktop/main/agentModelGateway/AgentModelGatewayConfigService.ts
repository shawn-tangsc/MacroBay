import { randomBytes } from 'node:crypto'

import type { ModelDefinition, ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { resolveAgentModelGatewayProviderRoute } from './agentModelGatewayProviderRouting'
import type { AgentModelGatewayProviderConfig } from './agentModelGatewayTypes'

export class AgentModelGatewayConfigService {
  private config: AgentModelGatewayProviderConfig | null = null
  private authToken = ''

  getAuthToken(): string {
    return this.authToken
  }

  getConfig(): AgentModelGatewayProviderConfig | null {
    return this.config
  }

  getConfigVersion(): string {
    return this.config?.configVersion ?? '0'
  }

  rotateAuthToken(now: () => Date = () => new Date()): string {
    this.authToken = randomBytes(24).toString('hex')
    if (this.config) {
      this.config = {
        ...this.config,
        configVersion: nextConfigVersion(this.config.configVersion),
        updatedAt: now().toISOString()
      }
    }
    return this.authToken
  }

  syncProviderConfig(
    provider: ModelProvider,
    model: ModelDefinition,
    now: () => Date = () => new Date()
  ): AgentModelGatewayProviderConfig {
    const route = resolveAgentModelGatewayProviderRoute(provider, model)
    this.config = {
      providerId: route.providerId,
      modelId: route.modelId,
      apiType: route.apiType,
      upstreamBaseUrl: route.baseUrl,
      hasUpstreamApiKey: Boolean(provider.apiKey?.trim()),
      configVersion: nextConfigVersion(this.config?.configVersion),
      updatedAt: now().toISOString()
    }
    if (!this.authToken) {
      this.rotateAuthToken(now)
    }
    return this.config
  }

  clear(): void {
    this.config = null
    this.authToken = ''
  }
}

function nextConfigVersion(current: string | undefined): string {
  const parsed = Number(current ?? '0')
  return String(Number.isFinite(parsed) ? parsed + 1 : 1)
}

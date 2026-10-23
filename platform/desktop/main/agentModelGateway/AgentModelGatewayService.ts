import type { ModelDefinition, ModelProvider } from '../../../ai/providers/modelProviderTypes'
import { AgentModelGatewayConfigService } from './AgentModelGatewayConfigService'
import { AgentModelGatewayHttpServer } from './AgentModelGatewayHttpServer'
import { createAgentModelGatewayProviderAdapter } from './AgentModelGatewayProviderAdapter'
import type {
  AgentModelGatewayOperationResult,
  AgentModelGatewaySnapshot,
  AgentModelGatewayState
} from './agentModelGatewayTypes'

export type AgentModelGatewayServiceDependencies = {
  fetch: typeof fetch
  getUpstreamApiKey: (providerId: string) => string | null | Promise<string | null>
  now?: () => Date
  port?: number
}

const DEFAULT_GATEWAY_PORT = 18_779

export class AgentModelGatewayService {
  private enabled = false
  private state: AgentModelGatewayState = 'disabled'
  private message: string | undefined
  private readonly configService = new AgentModelGatewayConfigService()
  private httpServer: AgentModelGatewayHttpServer | null = null
  private readonly port: number

  constructor(private readonly deps: AgentModelGatewayServiceDependencies) {
    this.port = deps.port ?? DEFAULT_GATEWAY_PORT
  }

  getSnapshot(): AgentModelGatewaySnapshot {
    return this.buildSnapshot()
  }

  getConfigService(): AgentModelGatewayConfigService {
    return this.configService
  }

  isSyncedFor(providerId: string, modelId: string): boolean {
    const config = this.configService.getConfig()
    return config?.providerId === providerId && config.modelId === modelId
  }

  getAuthToken(): string {
    return this.configService.getAuthToken()
  }

  setEnabled(enabled: boolean): AgentModelGatewaySnapshot {
    this.enabled = enabled
    if (!enabled) {
      this.state = 'disabled'
      this.message = 'Agent model gateway is disabled.'
    } else if (this.state === 'disabled') {
      this.state = 'stopped'
      this.message = 'Agent model gateway is stopped.'
    }
    return this.buildSnapshot()
  }

  syncProviderConfig(provider: ModelProvider, model: ModelDefinition): AgentModelGatewaySnapshot {
    this.configService.syncProviderConfig(provider, model, this.deps.now)
    this.message = `Synced gateway provider config for ${provider.id}:${model.id}.`
    return this.buildSnapshot()
  }

  async start(): Promise<AgentModelGatewayOperationResult> {
    if (!this.enabled) {
      return this.failure('Agent model gateway is disabled.')
    }
    if (this.state === 'starting') {
      return this.failure('Agent model gateway is already starting.')
    }
    if (!this.configService.getConfig()) {
      return this.failure('Agent model gateway provider config is missing.')
    }

    this.state = 'starting'
    this.message = 'Agent model gateway is starting.'

    try {
      if (!this.httpServer) {
        this.configService.rotateAuthToken(this.deps.now)
        this.httpServer = new AgentModelGatewayHttpServer({
          port: this.port,
          getAuthToken: () => this.configService.getAuthToken(),
          getProviderConfig: () => this.configService.getConfig(),
          adapter: createAgentModelGatewayProviderAdapter(),
          fetch: this.deps.fetch,
          getUpstreamApiKey: () => {
            const config = this.configService.getConfig()
            return config ? this.deps.getUpstreamApiKey(config.providerId) : null
          },
          now: this.deps.now
        })
      }

      await this.httpServer.start()
      const health = await this.checkHealth()
      if (!health.ok) {
        this.state = 'error'
        this.message = health.message
        return this.failure(health.message)
      }

      this.state = 'running'
      this.message = 'Agent model gateway is running.'
      return { ok: true, snapshot: this.buildSnapshot() }
    } catch (error) {
      this.state = 'error'
      this.message = error instanceof Error ? error.message : 'Agent model gateway failed to start.'
      return this.failure(this.message)
    }
  }

  async stop(): Promise<AgentModelGatewayOperationResult> {
    if (!this.enabled) {
      return { ok: true, snapshot: this.buildSnapshot() }
    }

    try {
      await this.httpServer?.stop()
      this.httpServer = null
      this.state = 'stopped'
      this.message = 'Agent model gateway is stopped.'
      return { ok: true, snapshot: this.buildSnapshot() }
    } catch (error) {
      this.state = 'error'
      this.message = error instanceof Error ? error.message : 'Agent model gateway failed to stop.'
      return this.failure(this.message)
    }
  }

  async checkHealth(): Promise<{ ok: boolean; message: string }> {
    if (!this.httpServer) {
      return { ok: false, message: 'Agent model gateway HTTP server is not running.' }
    }

    try {
      const response = await this.deps.fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: AbortSignal.timeout(3_000)
      })
      if (!response.ok) {
        return { ok: false, message: `Gateway health check failed with status ${response.status}.` }
      }
      const payload = (await response.json()) as { ok?: boolean; status?: string }
      if (payload.ok && payload.status === 'live') {
        return { ok: true, message: 'Gateway health check passed.' }
      }
      return { ok: false, message: 'Gateway health check returned an unexpected payload.' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Gateway health check failed.'
      }
    }
  }

  private buildSnapshot(): AgentModelGatewaySnapshot {
    return {
      enabled: this.enabled,
      state: this.state,
      port: this.port,
      ...(this.httpServer && this.state === 'running' ? { baseUrl: this.httpServer.getBaseUrl() } : {}),
      ...(this.message ? { message: this.message } : {}),
      updatedAt: (this.deps.now ?? (() => new Date()))().toISOString()
    }
  }

  private failure(message: string): AgentModelGatewayOperationResult {
    return {
      ok: false,
      snapshot: this.buildSnapshot(),
      message
    }
  }
}

export function createAgentModelGatewayService(
  deps: AgentModelGatewayServiceDependencies
): AgentModelGatewayService {
  return new AgentModelGatewayService(deps)
}

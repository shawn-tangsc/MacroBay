export type StreamTransportEvent =
  | { type: 'open' }
  | { type: 'message'; data: string | ArrayBuffer }
  | { type: 'heartbeat' }
  | { type: 'error'; error: Error }
  | { type: 'close'; code?: number; reason?: string }

export type StreamTransportConnectOptions = {
  url: string
  headers?: Record<string, string>
  protocols?: string | string[]
  heartbeatIntervalMs?: number
  reconnectPolicy?: {
    maxAttempts: number
    baseDelayMs: number
    maxDelayMs: number
  }
}

export type StreamTransport = {
  connect: (options: StreamTransportConnectOptions) => Promise<void>
  close: (code?: number, reason?: string) => Promise<void>
  send: (data: string | ArrayBuffer) => Promise<void>
  onEvent: (listener: (event: StreamTransportEvent) => void) => () => void
  getState: () => 'idle' | 'connecting' | 'open' | 'closing' | 'closed'
}

export type StreamTransportFactory = () => StreamTransport

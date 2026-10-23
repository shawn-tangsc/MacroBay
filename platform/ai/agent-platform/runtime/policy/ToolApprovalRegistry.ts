export type ToolApprovalDecision =
  | {
      behavior: 'allow'
      updatedInput?: unknown
    }
  | {
      behavior: 'deny'
      message: string
    }

export type PendingToolApproval = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  result: Promise<ToolApprovalDecision>
}

export type ToolApprovalResolutionSource = 'user' | 'session-stop' | 'runtime-dispose'

export type ResolvedToolApproval = Omit<PendingToolApproval, 'result'> & {
  decision: ToolApprovalDecision['behavior']
  updatedInput?: unknown
  message?: string
  resolvedAt: string
  resolutionSource: ToolApprovalResolutionSource
}

type PendingEntry = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  resolve: (decision: ToolApprovalDecision) => void
  result: Promise<ToolApprovalDecision>
}

export type CreatePendingToolApprovalInput = {
  approvalId?: string
  sessionId: string
  toolCallId: string
  toolName: string
}

type ToolApprovalRegistryOptions = {
  now?: () => string
  historyLimit?: number
}

export class ToolApprovalRegistry {
  private readonly pendingById = new Map<string, PendingEntry>()
  private readonly history: ResolvedToolApproval[] = []
  private readonly now: () => string
  private readonly historyLimit: number

  constructor(options: ToolApprovalRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.historyLimit = Math.max(0, Math.floor(options.historyLimit ?? 100))
  }

  createPending(input: CreatePendingToolApprovalInput): PendingToolApproval {
    const approvalId = input.approvalId ?? createApprovalId()
    if (this.pendingById.has(approvalId)) {
      throw new Error(`Tool approval "${approvalId}" already exists.`)
    }
    let resolveResult!: (decision: ToolApprovalDecision) => void
    const result = new Promise<ToolApprovalDecision>((resolve) => {
      resolveResult = resolve
    })

    this.pendingById.set(approvalId, {
      approvalId,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      resolve: resolveResult,
      result
    })

    return {
      approvalId,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      result
    }
  }

  get(approvalId: string): Omit<PendingToolApproval, 'result'> | null {
    const pending = this.pendingById.get(approvalId)
    if (!pending) return null
    return {
      approvalId: pending.approvalId,
      sessionId: pending.sessionId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName
    }
  }

  listPending(): Array<Omit<PendingToolApproval, 'result'>> {
    return [...this.pendingById.values()].map((pending) => ({
      approvalId: pending.approvalId,
      sessionId: pending.sessionId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName
    }))
  }

  listHistory(): ResolvedToolApproval[] {
    return this.history.map((entry) => ({ ...entry }))
  }

  resolve(
    approvalId: string,
    decision: ToolApprovalDecision,
    resolutionSource: ToolApprovalResolutionSource = 'user'
  ): void {
    const pending = this.pendingById.get(approvalId)
    if (!pending) {
      throw new Error(`Tool approval "${approvalId}" was not found.`)
    }
    this.pendingById.delete(approvalId)
    this.recordHistory(pending, decision, resolutionSource)
    pending.resolve(decision)
  }

  denySession(sessionId: string, message: string): void {
    for (const pending of [...this.pendingById.values()]) {
      if (pending.sessionId !== sessionId) continue
      this.pendingById.delete(pending.approvalId)
      const decision: ToolApprovalDecision = { behavior: 'deny', message }
      this.recordHistory(pending, decision, 'session-stop')
      pending.resolve(decision)
    }
  }

  clearAll(message: string): void {
    for (const pending of [...this.pendingById.values()]) {
      this.pendingById.delete(pending.approvalId)
      const decision: ToolApprovalDecision = { behavior: 'deny', message }
      this.recordHistory(pending, decision, 'runtime-dispose')
      pending.resolve(decision)
    }
  }

  private recordHistory(
    pending: Pick<PendingToolApproval, 'approvalId' | 'sessionId' | 'toolCallId' | 'toolName'>,
    decision: ToolApprovalDecision,
    resolutionSource: ToolApprovalResolutionSource
  ): void {
    if (this.historyLimit <= 0) return

    this.history.push({
      approvalId: pending.approvalId,
      sessionId: pending.sessionId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      decision: decision.behavior,
      ...(decision.behavior === 'allow' && Object.prototype.hasOwnProperty.call(decision, 'updatedInput')
        ? { updatedInput: decision.updatedInput }
        : {}),
      ...(decision.behavior === 'deny' ? { message: decision.message } : {}),
      resolvedAt: this.now(),
      resolutionSource
    })

    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit)
    }
  }
}

function createApprovalId(): string {
  return `tool-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

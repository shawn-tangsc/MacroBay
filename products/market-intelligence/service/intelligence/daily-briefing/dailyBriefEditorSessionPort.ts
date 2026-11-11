import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import { normalizeSessionOriginState } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { DailyBriefSessionLinkStore, DailyBriefSessionState } from './dailyBriefSessionLinks'

/**
 * The attempt the session belongs to, resolved before the session opens so the attempt row exists
 * first and the link only points at it. Absent in a build without the attempt store: then no
 * ordinal is recorded, and nothing is invented to fill the gap.
 */
export type DailyBriefAttemptAllocator = (input: Readonly<{ editionDate: string; periodId: string; locale: 'zh-CN' | 'en-US' }>) => Promise<number | undefined> | number | undefined

export type DailyBriefEditorSessionPort = Readonly<{
  ensure: (input: Readonly<{ editionDate: string; periodId: string; locale: 'zh-CN' | 'en-US'; title: string; agentId: string; allowedTools?: readonly string[] }>) => Promise<{ sessionId: string; created: boolean }>
  send: (sessionId: string, request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  /** Stops the runtime session that is still working on a generation that already timed out. */
  cancel: (sessionId: string) => Promise<void>
  state: (sessionId: string, state: DailyBriefSessionState) => Promise<void>
}>

/**
 * 历史副本的身份后缀。**只是字符串，不承载语义**：任何一处按它判断可见性或身份都是错的
 * （用例会在把它的值换掉后仍全绿，用来钉住这一点）。
 */
export const DAILY_BRIEF_HISTORY_REF_MARKER = '#history:'

/** 一次生成属于哪一期：**身份**（不是标题）——同一期多次生成只承认一条会话。 */
export function dailyBriefSessionOriginRef(input: Readonly<{ editionDate: string; periodId: string; locale: 'zh-CN' | 'en-US' }>): string {
  return `daily-brief:${input.editionDate}:${input.periodId}:${input.locale}`
}

export function createDailyBriefEditorSessionPort(deps: Readonly<{
  links: DailyBriefSessionLinkStore
  createSession: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  /** 按 (agentId, originRef) 窄查：同一期只复用一条会话，不再一天几条。 */
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<Pick<AgentSessionEntity, 'id'> | null>
  send: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  /** The platform cancel entry. Absent in builds without a runtime, so cancel is then a no-op. */
  cancelAgentSession?: (sessionId: string) => Promise<void> | void
  /** Owned by the attempt store; the port never derives its own sequence. */
  allocateAttempt?: DailyBriefAttemptAllocator
  now?: () => string
}>): DailyBriefEditorSessionPort {
  const now = deps.now ?? (() => new Date().toISOString())
  return Object.freeze({
    async ensure(input) {
      const originRef = dailyBriefSessionOriginRef(input)
      // 同一期只承认一条会话：先按身份窄查，命中就复用（这正是「一天几条 · 累积 28 条」的修法）。
      const existing = deps.findAgentSessionByAutomationRef
        ? await deps.findAgentSessionByAutomationRef(input.agentId, originRef)
        : null
      if (existing) {
        const linked = await deps.links.findBySession(existing.id)
        if (!linked) {
          const atReuse = now()
          await deps.links.put({ editionDate: input.editionDate, periodId: input.periodId, locale: input.locale, sessionId: existing.id, state: 'running', createdAt: atReuse, updatedAt: atReuse })
        }
        return { sessionId: existing.id, created: false }
      }
      const attemptNo = deps.allocateAttempt
        ? await deps.allocateAttempt({ editionDate: input.editionDate, periodId: input.periodId, locale: input.locale })
        : undefined
      // The ordinal is in the session name so two attempts of the same edition are told apart in
      // the assistant list; without an allocator there is no ordinal to name.
      const name = attemptNo === undefined ? input.title : `${input.title} · ${attemptNo}`
      const session = await deps.createSession({
        agentId: input.agentId,
        name,
        workspace: { type: 'system' },
        // 身份三件套与市场分析那条线同一口径：`origin` 让侧栏分块、`originGroup` 归组、
        // `originRef` 是幂等键（一期一条），标题只负责显示。
        origin: 'automation',
        originGroup: 'daily-briefing',
        originRef,
        ...(input.allowedTools && input.allowedTools.length > 0 ? { allowedTools: [...input.allowedTools] } : {})
      })
      const at = now()
      await deps.links.put({ editionDate: input.editionDate, periodId: input.periodId, locale: input.locale, ...(attemptNo === undefined ? {} : { attemptNo }), sessionId: session.id, state: 'running', createdAt: at, updatedAt: at })
      return { sessionId: session.id, created: true }
    },
    send: (sessionId, request) => deps.send({ ...request, sessionId }),
    async cancel(sessionId) {
      await deps.cancelAgentSession?.(sessionId)
    },
    async state(sessionId, state) {
      const link = await deps.links.findBySession(sessionId)
      if (!link) return
      // Terminal is terminal: a link is created `running`, and whichever outcome lands first wins.
      // The deadline and a turn that finishes on the same tick can both report, and the loser must
      // not rewrite the winner — neither `abandoned` over `accepted` nor `accepted` over
      // `abandoned`.
      if (link.state !== 'running') return
      await deps.links.put({ ...link, state, updatedAt: now() })
    },
  })
}

/**
 * 历史数据的身份修正：日报编辑会话当年建的时候没带 `origin/originGroup/originRef`，于是被算成
 * 读者会话，一天几条地堆在侧栏「对话」里。
 *
 * 口径（产品 2026-11-10 定）：
 * - **只改身份字段**，名字、描述、正文、消息表一行都不动；
 * - 同一期（`editionDate + periodId + locale`）**只承认一条**为正式身份：取**最新**那次生成
 *   （读者现在打开的正是它的内容；旧的那几次是历史副本）；
 * - 其余副本仍标成自动会话并给一条**唯一的**历史身份（`… #history:<sessionId>`），
 *   这样它们离开读者列表、又不会和正式身份撞车（窄查遇到重复会直接报错）。
 * - 幂等：已经在位的行跳过；再跑一次返回 0。
 *
 * 返回命中条数，供启动日志对账；不吞异常（调用方决定失败是否阻断启动）。
 */
export async function claimExistingBriefingSessions(deps: Readonly<{
  links: DailyBriefSessionLinkStore
  agentId: string
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<Pick<AgentSessionEntity, 'id' | 'originState'> | null>
  updateAgentSession?: (sessionId: string, patch: UpdateAgentSessionDto) => Promise<unknown>
  /** 只读：链接表里可能有已经被删掉的会话；查不到就跳过并计数，不能因此中断整趟迁移。 */
  getAgentSession?: (sessionId: string) => Promise<Pick<AgentSessionEntity, 'id'> | null>
}>): Promise<{ updated: number; skipped: number; missing: number }> {
  if (!deps.findAgentSessionByAutomationRef || !deps.updateAgentSession) return { updated: 0, skipped: 0, missing: 0 }
  // 链接表按「期 + locale」一行一次生成；用远未来日期取全部，不新增枚举口子。
  const links = await deps.links.listBefore('9999-12-31')
  type Link = (typeof links)[number]
  const byEdition = new Map<string, Link[]>()
  for (const link of links) {
    const key = dailyBriefSessionOriginRef(link)
    const bucket = byEdition.get(key)
    if (bucket) bucket.push(link)
    else byEdition.set(key, [link])
  }

  let updated = 0
  let skipped = 0
  let missing = 0
  for (const [originRef, bucket] of byEdition) {
    const ordered = [...bucket].sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt)
      return byTime === 0 ? left.sessionId.localeCompare(right.sessionId) : byTime
    })
    const canonical = ordered[ordered.length - 1]
    for (const link of ordered) {
      if (deps.getAgentSession && (await deps.getAgentSession(link.sessionId)) === null) {
        missing += 1
        continue
      }
      // 正式身份只有一条：最新那次生成。它若已被别的会话占着，这条本身就是历史副本。
      const wantsCanonical = link === canonical
      const canonicalOwner = wantsCanonical
        ? await deps.findAgentSessionByAutomationRef(deps.agentId, originRef)
        : null
      const desired = wantsCanonical && (canonicalOwner === null || canonicalOwner?.id === link.sessionId)
        ? originRef
        : `${originRef}${DAILY_BRIEF_HISTORY_REF_MARKER}${link.sessionId}`
      const wantedState: 'current' | 'superseded' = desired === originRef ? 'current' : 'superseded'
      const found = desired === originRef
        ? canonicalOwner
        : await deps.findAgentSessionByAutomationRef(deps.agentId, desired)
      if (found?.id === link.sessionId) {
        // 身份已在位：只有可见性还没标对时才补一把（保证第二次运行 updated = 0）。
        if (normalizeSessionOriginState(found.originState) !== wantedState) {
          await deps.updateAgentSession(link.sessionId, { originState: wantedState })
          updated += 1
          continue
        }
        skipped += 1
        continue
      }
      await deps.updateAgentSession(link.sessionId, {
        origin: 'automation',
        originGroup: 'daily-briefing',
        originRef: desired,
        originState: wantedState
      })
      updated += 1
    }
  }
  return { updated, skipped, missing }
}

/**
 * E9「打开会话」入口的唯一查找实现：**该期该语言最新一次生成**所用的会话 id。
 *
 * - 维度是「期 × 语言」（`daily-brief:<期>:<period>:<locale>`）——同一期中英是两条身份，
 *   拿错一条会把英文期指向中文会话；
 * - 只查**正式身份**（不带历史后缀）：历史副本按定义不是身份，这个入口不该指到它们；
 * - **查不到回 null**（界面据此不显示这个动作），不做「就近取一条」；
 * - **读失败也回 null**，但留一条日志——「确实没有」与「读不到」在界面上表现一样，
 *   在日志里必须分得开（`daily-brief-session-link-unreadable`）。
 */
export async function findLatestBriefingSessionId(deps: Readonly<{
  findAgentSessionByAutomationRef?: (agentId: string, originRef: string) => Promise<{ id: string } | null>
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}>, input: Readonly<{
  agentId: string
  editionDate: string
  periodId: string
  locale: 'zh-CN' | 'en-US'
}>): Promise<string | null> {
  const originRef = dailyBriefSessionOriginRef(input)
  if (!deps.findAgentSessionByAutomationRef) return null
  try {
    const found = await deps.findAgentSessionByAutomationRef(input.agentId, originRef)
    return found?.id ?? null
  } catch (error) {
    deps.log?.('warn', 'daily-brief-session-link-unreadable', {
      editionDate: input.editionDate,
      periodId: input.periodId,
      locale: input.locale,
      originRef,
      reason: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

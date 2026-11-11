import type { AgentChannelType } from '../../ai/agent-platform/schemas/channelSchemas'
import { channelAdapterDescriptor } from '../../ai/agent-platform/channels/channelAdapterDescriptors'
import { channelAdapterKeyForType } from '../../ai/agent-platform/channels/ChannelManagementPredicates'

/**
 * 启动时「这条频道要不要围栏」的判断。
 *
 * 从 `app.ts` 抽出来的：那段判断在启动循环里长到 20 多行，而 `app.ts` 是只减不增的受保护接缝
 * （`check:file-size` 基线 1240）。搬出来的只是**判断与两个动作的选择**，运行时启动仍留在 `app.ts`：
 * 那一步要拿六个 adapter manager，搬进来只会把依赖倒灌进这个模块。
 *
 * 规则（两类，都不许顺手清掉读者的开启意图）：
 * - 已实现、只是还没有验收证据：只围栏运行时，`requested_enabled` 不动 —— 这类频道的启用靠现场自检放行，
 *   证据决定的是平台对外声明，不是这位读者能不能用；
 * - 未知类型或未实现的适配器（微信）：根本没有运行时可跑，按原规则连意图一起清掉。
 *
 * 返回 `true` 表示这条已经被围栏、循环应当跳过它。
 */
export function fenceChannelAtBoot(input: {
  channelId: string
  generation: number
  type: AgentChannelType | null
  /** 平台是否已声明支持（= 有验收证据）。 */
  canEnable: (type: AgentChannelType) => boolean
  /** 围栏但保留开启意图（代际作废、占用行释放、状态回 ready）。 */
  fenceKeepingIntent: (channelId: string, now: string) => unknown
  /** 连开启意图一起清掉（只给没有运行时可跑的适配器）。 */
  disableGeneration: (channelId: string, generation: number, now: string) => unknown
  /** 启动围栏的审计落点：不同适配器各有自己的运行审计表。 */
  auditFenced: (type: AgentChannelType | null, kind: 'evidence-missing' | 'start-failed') => void
  now: string
}): boolean {
  const implemented = input.type === null
    ? false
    : channelAdapterDescriptor(channelAdapterKeyForType(input.type)).implemented

  if (input.type !== null && !input.canEnable(input.type) && implemented) {
    input.fenceKeepingIntent(input.channelId, input.now)
    input.auditFenced(input.type, 'evidence-missing')
    return true
  }
  if (!implemented) {
    input.disableGeneration(input.channelId, input.generation, input.now)
    // Lark 的审计闸门只认现役代际；围栏之后这条转换本来就没有运行审计。
    input.auditFenced(input.type, 'evidence-missing')
    return true
  }
  return false
}

/**
 * 启动这一跳失败之后：同样只围栏、保留意图，交给 `resumeRequested` 再试。
 * 失败多半是瞬时的（网络/代理/对方限流），清掉意图等于替读者取消启用。
 */
export function fenceAfterFailedBootStart(input: {
  channelId: string
  type: AgentChannelType | null
  fenceKeepingIntent: (channelId: string, now: string) => unknown
  auditFenced: (type: AgentChannelType | null, kind: 'evidence-missing' | 'start-failed') => void
  now: string
}): void {
  input.fenceKeepingIntent(input.channelId, input.now)
  input.auditFenced(input.type, 'start-failed')
}

/**
 * 启动时把「上次没跑完的频道」逐条接回来：先判围栏，再起运行时，失败只围栏不清意图。
 *
 * 整块搬出 `app.ts`（受保护接缝，只减不增）：`app.ts` 只留一次调用，运行时同样一次只跑一条。
 */
/**
 * 启动期已经补过放行的频道。按频道幂等：同一频道在一次进程里只 retain 一次，
 * 否则「启动补一次 + 用户再点启用补一次」会让适配器的引用计数多一格，而停用只回收一格。
 */
const bootRetained = new Set<string>()

export async function bootChannelRuntimes(deps: {
  active: ReadonlyArray<{ channelId: string; generation: number; token: string }>
  readType: (channelId: string) => AgentChannelType | null
  canEnable: (type: AgentChannelType) => boolean
  fenceKeepingIntent: (channelId: string, now: string) => unknown
  disableGeneration: (channelId: string, generation: number, now: string) => unknown
  /** 落围栏审计：不同适配器各有自己的运行审计表，`null`/别的类型就是没有落点。 */
  auditFenced: (channelId: string, type: AgentChannelType | null, kind: 'evidence-missing' | 'start-failed') => void
  /**
   * 进程内放行（`retainChannelAcceptance`）。运行时每一道闸门都读 `supportedChannelSql`，
   * 而六家在库里都是 blocked；不补这一步，启动恢复起来的通道每一帧都会被判「没资格」——静默失联。
   */
  retainAcceptance: (type: AgentChannelType) => void
  /** 各适配器返回布尔或带原因的结果对象：这里只关心「起没起来」。 */
  start: (type: AgentChannelType, channelId: string, generation: number, token: string) => Promise<unknown>
  now: () => string
}): Promise<void> {
  for (const { channelId, generation, token } of deps.active) {
    const type = deps.readType(channelId)
    const auditFenced = (fencedType: AgentChannelType | null, kind: 'evidence-missing' | 'start-failed'): void =>
      deps.auditFenced(channelId, fencedType, kind)
    // 已实现但还没有验收证据：与「用户当场点启用」同一条放行，进程内、不写库、不翻 supported。
    // 已 supported 的适配器忽略这一步（放行对它没有意义），未实现的本来就不会走到启动。
    if (
      type !== null
      && channelAdapterDescriptor(channelAdapterKeyForType(type)).implemented
      && !deps.canEnable(type)
      && !bootRetained.has(channelId)
    ) {
      deps.retainAcceptance(type)
      bootRetained.add(channelId)
    }

    if (fenceChannelAtBoot({
      channelId,
      generation,
      type,
      canEnable: deps.canEnable,
      fenceKeepingIntent: deps.fenceKeepingIntent,
      disableGeneration: deps.disableGeneration,
      auditFenced,
      now: deps.now()
    })) continue

    const started = await deps.start(type as AgentChannelType, channelId, generation, token)
    // 布尔与 `{ ok }` 两种形状都见过：`ok:false` 也算没起来。
    const up = typeof started === 'object' && started !== null ? (started as { ok?: unknown }).ok === true : started === true
    if (!up) {
      fenceAfterFailedBootStart({
        channelId,
        type,
        fenceKeepingIntent: deps.fenceKeepingIntent,
        auditFenced,
        now: deps.now()
      })
    }
  }
}

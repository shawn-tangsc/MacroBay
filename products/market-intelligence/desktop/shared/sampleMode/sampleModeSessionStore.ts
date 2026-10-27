import { emptySampleModeState, sampleModeClient, type SampleModeClient, type SampleModeState } from '../ipc/sampleModeClient'

export type SampleModeSessionSnapshot = Readonly<{
  view: SampleModeState
  busy: boolean
}>

export type SampleModeSessionStore = Readonly<{
  getSnapshot: () => SampleModeSessionSnapshot
  subscribe: (onChange: () => void) => () => void
  setActive: (active: boolean) => Promise<boolean>
  /** 已激活时按当前语言重新解析场景：语言的查询条件变了，只重载不重进。 */
  refresh: () => Promise<boolean>
  enter: () => Promise<boolean>
  exit: () => Promise<boolean>
}>

/**
 * 示例模式的渲染层唯一会话快照。
 *
 * 主进程 session 仍是权威；这里只缓存 view + busy，供 crypto 卡片和横幅/水印只读。
 * 所有写操作都经 setActive，不做乐观更新；失败时保留旧 view，便于重试。
 */
export function createSampleModeSessionStore(client: SampleModeClient = sampleModeClient): SampleModeSessionStore {
  let snapshot: SampleModeSessionSnapshot = { view: emptySampleModeState, busy: false }
  let started = false
  let version = 0
  const listeners = new Set<() => void>()

  function publish(view: SampleModeState, busy: boolean): void {
    snapshot = { view, busy }
    for (const listener of [...listeners]) listener()
  }

  function ensureStarted(): void {
    if (started) return
    started = true
    const versionAtStart = version
    void client.getState()
      .then((view) => {
        if (version !== versionAtStart) return
        publish(view, false)
      })
      .catch(() => {
        if (version !== versionAtStart) return
        publish(emptySampleModeState, false)
      })
  }

  async function setActive(active: boolean): Promise<boolean> {
    ensureStarted()
    if (snapshot.busy) return false
    if (snapshot.view.active === active) return true

    version += 1
    const previousView = snapshot.view
    publish(previousView, true)
    try {
      const view = await client.setActive(active)
      if (active && !view.active && view.unavailableReason === undefined) {
        // 传输失败时 client 会收敛成「未激活空状态」；保留上一份 view，示例入口仍可重试。
        publish(previousView, false)
        return false
      }
      if (!active && view.active) {
        publish(view, false)
        return false
      }
      publish(view, false)
      return true
    } catch {
      publish(previousView, false)
      throw new Error('sample-mode-set-active-failed')
    }
  }

  /**
   * 与 `setActive` 分开，是因为 `setActive` 幂等短路：已激活时它直接返回，根本不会发 IPC。
   * 语言切换需要的正是「再解析一次」这个动作。
   */
  async function refresh(): Promise<boolean> {
    ensureStarted()
    if (!snapshot.view.active || snapshot.busy) return false
    publish(snapshot.view, true)
    try {
      const view = await client.setActive(true)
      publish(view, false)
      return view.active
    } catch {
      publish(snapshot.view, false)
      return false
    }
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (onChange: () => void) => {
      ensureStarted()
      listeners.add(onChange)
      return () => { listeners.delete(onChange) }
    },
    setActive,
    refresh,
    enter: () => setActive(true),
    exit: () => setActive(false)
  })
}

export const sampleModeSessionStore = createSampleModeSessionStore()

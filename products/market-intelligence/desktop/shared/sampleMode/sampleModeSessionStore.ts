import { emptySampleModeState, sampleModeClient, type SampleModeClient, type SampleModeState } from '../ipc/sampleModeClient'

export type SampleModeSessionSnapshot = Readonly<{
  view: SampleModeState
  busy: boolean
}>

export type SampleModeSessionStore = Readonly<{
  getSnapshot: () => SampleModeSessionSnapshot
  subscribe: (onChange: () => void) => () => void
  setActive: (active: boolean) => Promise<boolean>
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

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (onChange: () => void) => {
      ensureStarted()
      listeners.add(onChange)
      return () => { listeners.delete(onChange) }
    },
    setActive,
    enter: () => setActive(true),
    exit: () => setActive(false)
  })
}

export const sampleModeSessionStore = createSampleModeSessionStore()

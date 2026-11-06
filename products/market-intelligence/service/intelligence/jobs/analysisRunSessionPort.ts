/**
 * 「一次运行一条会话」的迟到绑定。
 *
 * 会话端口由 bootstrap 注入（与追问会话同一份），运行时自己不去构造；这里只保存与转发，
 * 让运行时文件不因为多一种端口再长一截。
 */
export type RunSessionPort = Readonly<{
  ensure: (input: Readonly<{ runId: string; queuedAt: string }>) => Promise<string | undefined>
  appendSummary: (input: Readonly<{ runId: string; summary: string }>) => Promise<void>
}>

export function createRunSessionBinding() {
  let port: RunSessionPort | undefined
  return {
    setPort(next: RunSessionPort | undefined): void { port = next },
    /** 建会话失败不影响这次分析：它是记录的附加物，不是分析的前提。 */
    ensureRunSession: async (input: Readonly<{ runId: string; queuedAt: string }>): Promise<string | undefined> =>
      port ? port.ensure(input) : undefined,
    appendRunSummary: async (input: Readonly<{ runId: string; summary: string }>): Promise<void> => {
      if (port) await port.appendSummary(input)
    }
  }
}

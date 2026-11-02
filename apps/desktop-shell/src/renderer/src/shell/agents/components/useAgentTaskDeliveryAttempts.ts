import { useEffect, useRef, useState } from 'react'

import type { TaskDeliveryAttemptEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

import { getTaskDeliveryAttemptsViaApi, retryTaskDeliveryViaApi } from '../agentTaskDataApi'

export function shouldApplyDeliveryAttemptResponse(input: {
  latestRequestId: number
  responseRequestId: number
  latestRunLogId: string | null
  responseRunLogId: string
}): boolean {
  return input.latestRequestId === input.responseRequestId && input.latestRunLogId === input.responseRunLogId
}

export function useAgentTaskDeliveryAttempts(input: {
  agentId: string
  runLogId: string | null
}): {
  attempts: TaskDeliveryAttemptEntity[]
  total: number
  /** 这一次读取失败了。它是值不是缺席：列表空着并说「没有投递记录」会把读失败画成事实。 */
  loadFailed: boolean
  reload: () => Promise<void>
  loadMore: () => Promise<void>
  retry: (attemptId: string) => Promise<{ delivered: number; failed: number; skipped: number; unknown: number } | null>
} {
  const [attempts, setAttempts] = useState<TaskDeliveryAttemptEntity[]>([])
  const [total, setTotal] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const requestId = useRef(0)
  const latestRunLogId = useRef<string | null>(input.runLogId)

  async function load(offset: number, replace: boolean): Promise<void> {
    const runLogId = input.runLogId
    if (!runLogId) return
    setLoadFailed(false)
    const currentRequestId = ++requestId.current
    const page = await getTaskDeliveryAttemptsViaApi(window.platform, input.agentId, runLogId, { limit: 20, offset })
    if (!shouldApplyDeliveryAttemptResponse({
      latestRequestId: requestId.current,
      responseRequestId: currentRequestId,
      latestRunLogId: latestRunLogId.current,
      responseRunLogId: runLogId
    })) return
    setAttempts((current) => replace ? page.attempts : [...current, ...page.attempts])
    setTotal(page.total)
  }

  useEffect(() => {
    requestId.current += 1
    latestRunLogId.current = input.runLogId
    if (!input.runLogId) {
      setAttempts([])
      setTotal(0)
      setLoadFailed(false)
      return
    }
    void load(0, true).catch(() => {
      if (latestRunLogId.current !== input.runLogId) return
      // 不清空已读到的尝试：失败的是这一次读取，不是「这条运行没有投递」。
      setLoadFailed(true)
    })
  }, [input.agentId, input.runLogId])

  return {
    attempts,
    total,
    loadFailed,
    reload: () => load(0, true),
    loadMore: () => load(attempts.length, false),
    retry: async (attemptId) => {
      if (!input.runLogId) return null
      const summary = await retryTaskDeliveryViaApi(window.platform, input.agentId, input.runLogId, attemptId)
      await load(0, true)
      return summary
    }
  }
}

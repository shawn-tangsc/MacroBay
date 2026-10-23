import { useEffect, useMemo, useRef, useState } from 'react'

import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskAutomationPolicy } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationPolicy'
import type {
  TaskAutomationPolicyPreset,
  TaskMutationAuditEntity
} from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'

import {
  getTaskAutomationPolicyViaApi,
  listTaskMutationAuditsViaApi,
  listTaskPageViaApi,
  updateTaskAutomationPolicyViaApi
} from '../../agents/agentTaskDataApi'
import {
  buildTaskAutomationSettingsState,
  type TaskAutomationStatusFilter,
  type TaskRunSnapshot
} from './taskAutomationSettingsViewModel'
import { loadTaskRunSnapshots } from './taskAutomationTaskRuns'

export type TaskAutomationPolicyState = {
  preset: TaskAutomationPolicyPreset
  policy: TaskAutomationPolicy
}

const taskPageLimit = 50
const taskAuditLimit = 5

export type TaskAutomationSettingsController = {
  loading: boolean
  error: boolean
  status: TaskAutomationStatusFilter
  setStatus: (status: TaskAutomationStatusFilter) => void
  nameQuery: string
  setNameQuery: (query: string) => void
  clearFilters: () => void
  expandedTaskId: string | null
  toggleTaskExpanded: (taskId: string) => void
  audits: TaskMutationAuditEntity[]
  state: ReturnType<typeof buildTaskAutomationSettingsState>
  policy: TaskAutomationPolicyState | null
  policyLoading: boolean
  policyError: boolean
  reloadPolicy: () => Promise<void>
  hasMore: boolean
  loadMore: () => Promise<void>
  reload: () => Promise<void>
  updatePolicy: (preset: TaskAutomationPolicyPreset) => Promise<void>
}

export function useTaskAutomationSettings(): TaskAutomationSettingsController {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [status, setStatusState] = useState<TaskAutomationStatusFilter>('all')
  const [nameQuery, setNameQuery] = useState('')
  const [tasks, setTasks] = useState<ScheduledTaskEntity[]>([])
  const [taskRuns, setTaskRuns] = useState<Record<string, TaskRunSnapshot>>({})
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0)
  const [audits, setAudits] = useState<TaskMutationAuditEntity[]>([])
  const [policy, setPolicy] = useState<TaskAutomationPolicyState | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [policyError, setPolicyError] = useState(false)
  const tasksRef = useRef<ScheduledTaskEntity[]>([])
  const detailRequestId = useRef(0)
  const pageRequestId = useRef(0)
  const policyLoadRequestId = useRef(0)
  const policyMutationId = useRef(0)

  const state = useMemo(
    () => buildTaskAutomationSettingsState({
      tasks,
      selectedTaskId: expandedTaskId,
      status,
      nameQuery,
      audits,
      taskRuns
    }),
    [audits, expandedTaskId, nameQuery, status, taskRuns, tasks]
  )

  async function reload(): Promise<void> {
    detailRequestId.current += 1
    setDetailRefreshVersion((current) => current + 1)
    setAudits([])
    await Promise.all([
      reloadPolicy(),
      loadPageForStatus(status, { append: false, resetExpansion: false })
    ])
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loading) return
    await loadPageForStatus(status, { cursor: nextCursor, append: true, resetExpansion: false })
  }

  function setStatus(nextStatus: TaskAutomationStatusFilter): void {
    if (nextStatus === status) return
    setStatusState(nextStatus)
    setExpandedTaskId(null)
    setAudits([])
    setNextCursor(null)
    void loadPageForStatus(nextStatus, { append: false, resetExpansion: true })
  }

  function clearFilters(): void {
    setNameQuery('')
    setStatusState('all')
    setExpandedTaskId(null)
    setAudits([])
    setNextCursor(null)
    void loadPageForStatus('all', { append: false, resetExpansion: true })
  }

  function toggleTaskExpanded(taskId: string): void {
    detailRequestId.current += 1
    setAudits([])
    setExpandedTaskId((current) => (current === taskId ? null : taskId))
  }

  async function updatePolicy(preset: TaskAutomationPolicyPreset): Promise<void> {
    const mutationId = ++policyMutationId.current
    try {
      const nextPolicy = await updateTaskAutomationPolicyViaApi(window.platform, preset)
      if (policyMutationId.current === mutationId) {
        setPolicy(nextPolicy)
        setPolicyError(false)
      }
    } catch {
      if (policyMutationId.current === mutationId) setPolicyError(true)
    }
  }

  async function reloadPolicy(): Promise<void> {
    const loadRequestId = ++policyLoadRequestId.current
    const mutationId = policyMutationId.current
    setPolicyLoading(true)
    setPolicyError(false)
    try {
      const nextPolicy = await getTaskAutomationPolicyViaApi(window.platform)
      if (policyLoadRequestId.current === loadRequestId && policyMutationId.current === mutationId) {
        setPolicy(nextPolicy)
      }
    } catch {
      if (policyLoadRequestId.current === loadRequestId && policyMutationId.current === mutationId) {
        setPolicyError(true)
      }
    } finally {
      if (policyLoadRequestId.current === loadRequestId) setPolicyLoading(false)
    }
  }

  async function loadPageForStatus(
    nextStatus: TaskAutomationStatusFilter,
    input: { cursor?: string; append: boolean; resetExpansion: boolean }
  ): Promise<void> {
    const requestId = ++pageRequestId.current
    setLoading(true)
    setError(false)
    try {
      const query = {
        ...(nextStatus === 'all' ? {} : { status: nextStatus }),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: taskPageLimit
      }
      const taskPage = await listTaskPageViaApi(window.platform, query)
      if (pageRequestId.current !== requestId) return
      const nextTasks = input.append ? [...tasksRef.current, ...taskPage.tasks] : taskPage.tasks
      tasksRef.current = nextTasks
      setTasks(nextTasks)
      setNextCursor(taskPage.nextCursor ?? null)
      if (input.resetExpansion) setExpandedTaskId(null)
      const snapshots = await loadTaskRunSnapshots(window.platform, nextTasks)
      if (pageRequestId.current !== requestId) return
      setTaskRuns(snapshots)
    } catch {
      if (pageRequestId.current === requestId) setError(true)
    } finally {
      if (pageRequestId.current === requestId) setLoading(false)
    }
  }

  useEffect(() => {
    void reloadPolicy()
    void loadPageForStatus('all', { append: false, resetExpansion: true })
  }, [])

  useEffect(() => {
    const taskId = expandedTaskId
    const requestId = ++detailRequestId.current
    setAudits([])
    if (!taskId) return

    void listTaskMutationAuditsViaApi(window.platform, { taskId, limit: taskAuditLimit, offset: 0 })
      .then((auditPage) => {
        if (detailRequestId.current === requestId) setAudits(auditPage.audits)
      })
      .catch(() => {
        if (detailRequestId.current === requestId) setError(true)
      })
  }, [detailRefreshVersion, expandedTaskId])

  return {
    loading,
    error,
    status,
    setStatus,
    nameQuery,
    setNameQuery,
    clearFilters,
    expandedTaskId: state.expandedTaskId,
    toggleTaskExpanded,
    audits,
    state,
    policy,
    policyLoading,
    policyError,
    reloadPolicy,
    hasMore: Boolean(nextCursor),
    loadMore,
    reload,
    updatePolicy
  }
}

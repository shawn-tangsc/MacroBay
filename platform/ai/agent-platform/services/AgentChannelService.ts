import type { AgentChannelEntity, AgentChannelListQuery, CreateAgentChannelDto, UpdateAgentChannelDto } from '../schemas/channelSchemas'
import type { AgentPlatformQueryAdapters, AgentPlatformStateStore } from './agentServiceTypes'
import { TaskAutomationCommandService } from '../runtime/tasks/TaskAutomationCommandService'

export class AgentChannelService {
  constructor(
    private readonly store: AgentPlatformStateStore,
    private readonly taskCommands: TaskAutomationCommandService,
    private readonly queries: AgentPlatformQueryAdapters = {}
  ) {}

  async create(data: CreateAgentChannelDto | AgentChannelEntity): Promise<AgentChannelEntity> {
    void data
    throw new Error('channel-legacy-write-rejected')
  }

  async get(id: string): Promise<AgentChannelEntity | null> {
    return (await this.store.getState()).channels.find((channel) => channel.id === id) ?? null
  }

  async getRequired(id: string): Promise<AgentChannelEntity> {
    const channel = await this.get(id)
    if (!channel) throw new Error(`Channel "${id}" was not found.`)
    return channel
  }

  async findBySessionId(sessionId: string): Promise<AgentChannelEntity | null> {
    const channel = this.queries.channels?.findBySessionId(sessionId)
    if (channel) return channel
    return (await this.store.getState()).channels.find((channel) => channel.sessionId === sessionId) ?? null
  }

  async list(query: AgentChannelListQuery = {}): Promise<AgentChannelEntity[]> {
    const channels = this.queries.channels?.list(query)
    if (channels) return channels
    return (await this.store.getState()).channels.filter((channel) => {
      if (query.agentId && channel.agentId !== query.agentId) return false
      if (query.type && channel.type !== query.type) return false
      return true
    })
  }

  async update(id: string, patch: UpdateAgentChannelDto): Promise<AgentChannelEntity | null> {
    void id
    void patch
    throw new Error('channel-legacy-write-rejected')
  }

  async delete(id: string): Promise<boolean> {
    const snapshot = await this.store.getState()
    const channel = snapshot.channels.find((item) => item.id === id)
    if (!channel) return false
    const expectedRevisionByTaskId = new Map(
      snapshot.tasks
        .filter((task) => task.channelIds?.includes(id) || snapshot.channelTaskSubscriptions.some((subscription) => subscription.channelId === id && subscription.taskId === task.id))
        .map((task) => [task.id, task.revision ?? 1])
    )
    const mutation = (state: Awaited<ReturnType<AgentPlatformStateStore['getState']>>) => {
      const cleanup = this.taskCommands.prepareChannelDeleteCleanup(state, {
        channelId: id,
        actor: { kind: 'user', source: 'renderer-agent-drawer' },
        expectedRevisionByTaskId
      })
      return { ...cleanup, result: true }
    }

    if (this.store.transactChannelDeletionMutation) {
      await this.store.transactChannelDeletionMutation({ channelId: id, mutate: mutation })
    } else {
      await this.store.update((state) => mutation(state).state)
      this.queries.channels?.delete?.(id)
    }
    return true
  }

  async addActiveChatId(channelId: string, chatId: string): Promise<void> {
    void channelId
    void chatId
    throw new Error('channel-legacy-write-rejected')
  }

  async subscribeToTask(channelId: string, taskId: string): Promise<void> {
    const state = await this.store.getState()
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return
    const channelIds = Array.from(new Set([...(task.channelIds ?? []), channelId]))
    await this.updateTaskSubscriptions(taskId, channelIds)
  }

  async unsubscribeFromTask(channelId: string, taskId: string): Promise<void> {
    const state = await this.store.getState()
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return
    const channelIds = (task.channelIds ?? []).filter((id) => id !== channelId)
    await this.updateTaskSubscriptions(taskId, channelIds)
  }

  async replaceTaskSubscriptions(taskId: string, channelIds: readonly string[]): Promise<void> {
    await this.updateTaskSubscriptions(taskId, [...channelIds])
  }

  async getSubscribedChannels(taskId: string): Promise<AgentChannelEntity[]> {
    const channels = this.queries.channels?.listByTaskId(taskId)
    if (channels) return channels
    const state = await this.store.getState()
    const subscribedIds = new Set(
      state.channelTaskSubscriptions
        .filter((subscription) => subscription.taskId === taskId)
        .map((subscription) => subscription.channelId)
    )
    return state.channels.filter((channel) => subscribedIds.has(channel.id))
  }

  async getSubscribedTasks(channelId: string): Promise<string[]> {
    const taskIds = this.queries.channels?.listTaskIdsByChannelId(channelId)
    if (taskIds) return taskIds
    const state = await this.store.getState()
    return state.channelTaskSubscriptions
      .filter((subscription) => subscription.channelId === channelId)
      .map((subscription) => subscription.taskId)
  }

  private async updateTaskSubscriptions(taskId: string, channelIds: readonly string[]): Promise<void> {
    const state = await this.store.getState()
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return
    await this.taskCommands.execute({
      type: 'update',
      actor: { kind: 'user', source: 'renderer-agent-drawer' },
      agentId: task.agentId,
      taskId: task.id,
      expectedRevision: task.revision ?? 1,
      patch: { channelIds: Array.from(new Set(channelIds)) }
    })
  }
}

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  settings: vi.fn(),
  schedules: vi.fn()
}))

vi.mock('./useTaskAutomationSettings', () => ({
  useTaskAutomationSettings: () => hooks.settings()
}))
vi.mock('./useResourceJobSchedules', () => ({
  useResourceJobSchedules: () => hooks.schedules()
}))

import { TaskAutomationSettingsPage } from './TaskAutomationSettingsPage'
import { TASK_AUTOMATION_CONTROL_CLASSES } from './taskAutomationControlWidths'

function countOccurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

describe('TaskAutomationSettingsPage', () => {
  it('renders the four blocks with their own empty states on an empty profile', () => {
    hooks.settings.mockReturnValue(settings({ tasks: [], emptyState: 'never-created' }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain('投递健康')
    // With zero tasks the counters are zero by construction, so this block does not explain it:
    // 「还没有定时任务」 below already said the one true thing.
    expect(markup).not.toContain('任务开始运行后，这里会显示成功、失败与跳过计数。')
    expect(markup).toContain('我的定时任务')
    // 空态只有 `StateView` 一个出口：没有任务 = `never-created`，动作是「创建」并真的导航到对话页
    // （导航接缝 050dba6/325cb71 落地后才成立；在那之前这里只能是 `not-yet` 且不给动作）。
    expect(markup).toContain('从来没有创建过，先创建一个')
    expect(markup).toContain('每天早上 9 点总结行情')
    expect(markup).toContain('平台与产品资源任务')
    // 资源任务由产品注册，读者在这一屏改不了；原因是「一个都没启用」，不是「等着就会来」。
    expect(markup).toContain('一个都还没有启用，先启用一个')
    expect(markup).toContain('执行策略')
    expect(markup).toContain('当前没有自动任务，策略会在任务开始运行后生效。')
    expect(markup).not.toContain('没有匹配的任务。')
  })

  it('renders the table whenever there are rows, even if the empty-state verdict disagrees', () => {
    const task = { id: 'task-1', name: '行情任务', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }
    // Deliberately inconsistent: a wrong verdict must degrade to a wrong sentence, never to an
    // invisible table. This is the structure rule: rendering follows rows, not the verdict.
    hooks.settings.mockReturnValue(settings({ tasks: [task], emptyState: 'filter-empty' }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain('行情任务')
    expect(markup).toContain('task-automation-table')
  })

  it('shows load more when more rows exist, even if the empty-state verdict says otherwise', () => {
    const task = { id: 'task-1', name: '行情任务', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }
    hooks.settings.mockReturnValue(settings({ tasks: [task], emptyState: 'never-created', hasMore: true }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    // The control follows `hasMore`; a wrong verdict must not be able to hide the way to more rows.
    expect(markup).toContain('加载更多')
  })

  it('keeps a task whose latest run could not be read and says so instead of never', () => {
    const task = { id: 'task-1', name: '读取失败的任务', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }
    hooks.settings.mockReturnValue(settings({
      tasks: [task],
      taskRuns: { 'task-1': { unreadable: true } }
    }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    // The row survives the failed read, and its cell says the read failed rather than "never ran".
    expect(markup).toContain('读取失败的任务')
    expect(markup).toMatch(/读取失败的任务[\s\S]{0,800}暂时读不到/)
  })

  it('shows the unreadable state in the expanded detail instead of a row of zeros', () => {
    const task = { id: 'task-1', name: '读取失败的任务', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }
    hooks.settings.mockReturnValue(settings({
      tasks: [task],
      taskRuns: { 'task-1': { unreadable: true } },
      expandedTaskId: 'task-1'
    }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    // The detail block must not print five zeros, which would read as "the task delivered nothing".
    expect(markup).toMatch(/本任务投递健康[\s\S]{0,500}暂时读不到/)
  })

  it('explains why a delivery was skipped instead of leaving only the tag', () => {
    const task = { id: 'task-1', name: '每日行情总结', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }
    hooks.settings.mockReturnValue(settings({
      tasks: [task],
      taskRuns: {
        'task-1': {
          status: 'skipped',
          at: '2026-07-17T08:00:00.000Z',
          health: { delivered: 0, failed: 0, pending: 0, skipped: 3, unknown: 0 },
          skipReasons: ['delivery-no-target-bound', 'delivery-target-disabled'],
          unexplainedSkips: 1
        }
      }
    }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    // Each reason leads to a different action, so the page must name them, not echo a code.
    expect(markup).toContain('这条任务还没绑定通道')
    expect(markup).toContain('绑定的通道已停用')
    expect(markup).not.toContain('delivery-no-target-bound')
    // A skipped row with no recorded reason is a defect and must be visible as one.
    expect(markup).toContain('没有记录原因')
  })

  it('explains an empty delivery health only when there are tasks to deliver', () => {
    const task = { id: 'task-1', name: '行情任务', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }
    hooks.settings.mockReturnValue(settings({ tasks: [task] }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    // Tasks exist, nothing has been delivered yet: the fact is the reader's now.
    // 状态与句子分开：`StateView` 给「还没有发生过」这个判断（不带动作），
    // 场景说明紧贴在它下面，说清等的是「任务开始运行」。
    expect(markup).toContain('这里还没有内容')
    expect(markup).toContain('还没有发生过；等有数据进来后这里就会出现')
    expect(markup).toContain('任务开始运行后，这里会显示成功、失败与跳过计数。')
  })

  it('keeps the delivery health block visible with zeros instead of collapsing it when there is no task', () => {
    hooks.settings.mockReturnValue(settings({ tasks: [], emptyState: 'never-created' }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain('已投递')
    expect(markup).toContain('失败')
    expect(markup).toContain('待投递')
    expect(markup).toContain('已跳过')
    expect(markup).toContain('未知')
    expect(markup).toContain('最近更新')
  })

  it('distinguishes the never-created empty state from the filter-empty state', () => {
    hooks.settings.mockReturnValue(settings({ tasks: [], emptyState: 'never-created' }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))
    const neverCreated = renderPage()
    expect(neverCreated).toContain('data-state="empty"')
    expect(neverCreated).toContain('data-size="md"')
    expect(neverCreated).toContain('从来没有创建过，先创建一个')
    // 动作现在是真能用的：`create` 导航到对话页（`navigateTo`）。下面那句只解释「怎么会有第一条」，
    // 紧贴 StateView、纯文本、不承担“这里没有”的判断——判断只有 StateView 一处。
    expect(neverCreated).toContain('每天早上 9 点总结行情')
    expect(neverCreated).not.toContain('当前筛选下没有任务。')

    hooks.settings.mockReturnValue(settings({
      tasks: [{ id: 'task-1', name: '每日行情总结', status: 'active', trigger: { kind: 'cron', expr: '0 9 * * *' } }],
      // Source has rows; the filter leaves none visible.
      rows: [],
      emptyState: 'filter-empty',
      nameQuery: 'zzz'
    }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))
    const filterEmpty = renderPage()
    expect(filterEmpty).toContain('有数据，但被当前筛选挡住了')
    expect(filterEmpty).toContain('清除筛选')
    // 注意：`还没有发生过` 在「投递健康」块里也有自己的空态，所以不能拿它当整页否定断言——
    // 这里只认「任务表这一格给的是 filtered-out 并且带清除筛选」。
    expect(countOccurrences(filterEmpty, '有数据，但被当前筛选挡住了')).toBe(1)
  })

  it('never renders a blank policy dropdown while the policy is loading', () => {
    hooks.settings.mockReturnValue(settings({ tasks: [], emptyState: 'never-created', policyLoading: true, policy: null }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain('正在加载策略…')
    expect(markup).toContain('ant-select-disabled')
  })

  it('shows the policy failure with a retry instead of an empty dropdown', () => {
    hooks.settings.mockReturnValue(settings({ tasks: [], emptyState: 'never-created', policyError: true, policy: null }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain('策略加载失败')
    expect(markup).toContain('重试')
    expect(markup).toContain('ant-select-disabled')
  })

  it('renders the real preset numbers of the loaded policy', () => {
    hooks.settings.mockReturnValue(settings({}))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain('并发上限')
    expect(markup).toContain('30 个任务并行')
    expect(markup).toContain('最短调度间隔')
    expect(markup).toContain('每 5 分钟')
    expect(markup).toContain('单次运行超时')
    expect(markup).toContain('120 分钟')
    expect(markup).toContain('影响自动化的带宽门槛：并发上限、最短调度间隔、单次运行超时。')
  })

  it('lists the registered platform and product jobs with their projected registration state and last run', () => {
    hooks.settings.mockReturnValue(settings({}))
    hooks.schedules.mockReturnValue(schedules({
      items: [
        job({
          id: 'market-intelligence.source.crypto-news',
          title: 'Crypto news collection',
          owner: 'product',
          productId: 'market-intelligence',
          trigger: { kind: 'interval', intervalMs: 900_000, anchor: 'lastComplete' },
          nextRunAt: '2026-07-17T09:15:00.000Z',
          lastRunAt: '2026-07-17T09:00:05.000Z',
          lastOutcome: 'failed',
          lastRunStatus: 'failed',
          lastDurationMs: 5_000
        }),
        job({
          id: 'platform.retention',
          title: 'Platform retention',
          trigger: { kind: 'cron', expression: '0 3 * * *', timezone: 'Asia/Shanghai' },
          nextRunAt: '2026-07-18T03:00:00.000Z'
        })
      ],
      productNames: { 'market-intelligence': 'Market Intelligence' }
    }))

    const markup = renderPage()

    expect(markup).toContain('Crypto news collection')
    expect(markup).toContain('Market Intelligence')
    expect(markup).toContain('Platform retention')
    expect(markup).toContain('已注册')
    expect(markup).toContain('失败')
    expect(markup).toContain('从未运行')
    expect(markup).toContain('共 2 项 · 筛选后 2 项')
    expect(markup).toContain('「未注册」表示该产品当前没有把它的调度注册进平台')
    expect(markup).not.toContain('手动触发')
  })

  it('renders unregistered rows in the grey state with the explanation', () => {
    hooks.settings.mockReturnValue(settings({}))
    hooks.schedules.mockReturnValue(schedules({
      items: [job({
        id: 'product.auto-collect',
        title: 'Auto collect',
        owner: 'product',
        productId: 'market-intelligence',
        trigger: { kind: 'interval', intervalMs: 60_000, anchor: 'lastComplete' },
        registered: false
      })],
      productNames: { 'market-intelligence': 'Market Intelligence' }
    }))

    const markup = renderPage()

    expect(markup).toContain('未注册')
    expect(markup).toContain('task-automation-row-unregistered')
    expect(markup).toContain('通常意味着该能力未启用')
  })

  it('renders the task table columns and the expanded task health and recent changes', () => {
    hooks.settings.mockReturnValue(settings({
      tasks: [task({ id: 'task-1', name: '每日行情总结', trigger: { kind: 'cron', expr: '0 9 * * *' }, nextRun: '2026-07-18T01:00:00.000Z' })],
      expandedTaskId: 'task-1',
      audits: [{ id: 'audit-1', action: 'resume', outcome: 'accepted', createdAt: '2026-07-17T08:00:00.000Z' }]
    }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    for (const column of ['名称', '状态', '调度', '下次运行', '最近结果', '操作']) {
      expect(markup).toContain(column)
    }
    expect(markup).toContain('本任务投递健康')
    expect(markup).toContain('最近变更')
    expect(markup).toContain('已生效')
    expect(markup).toContain('恢复')
    expect(markup).toContain('每日行情总结')
  })

  it('renders the audit empty state inside an expanded task instead of dropping the block', () => {
    hooks.settings.mockReturnValue(settings({
      tasks: [task({ id: 'task-1', name: '每日行情总结', trigger: { kind: 'interval', ms: 3_600_000 } })],
      expandedTaskId: 'task-1',
      audits: []
    }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    expect(renderPage()).toContain('暂无变更记录。')
  })

  it('separates the delivery and resource-run health scopes with their own explanation', () => {
    hooks.settings.mockReturnValue(settings({}))
    hooks.schedules.mockReturnValue(schedules({
      items: [job({ id: 'a', lastOutcome: 'success', lastRunAt: '2026-07-17T09:00:00.000Z' })]
    }))

    const markup = renderPage()

    expect(markup).toContain('我的定时任务投递')
    expect(markup).toContain('资源任务最近一次运行')
    expect(markup).toContain('投递=定时任务把消息投递到通道/通知；运行=产品资源任务最近一次执行。')
    // 既有 5 项投递计数保持原样。
    expect(markup).toContain('已投递')
    expect(markup).toContain('待投递')
    expect(markup).toContain('未知')
  })

  it('marks the shared controls with their fixed-width classes', () => {
    hooks.settings.mockReturnValue(settings({}))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderPage()

    expect(markup).toContain(TASK_AUTOMATION_CONTROL_CLASSES.name)
    expect(markup).toContain(TASK_AUTOMATION_CONTROL_CLASSES.status)
    expect(markup).toContain(TASK_AUTOMATION_CONTROL_CLASSES.policy)
  })

  it('localizes the whole page in English', () => {
    hooks.settings.mockReturnValue(settings({ tasks: [], emptyState: 'never-created' }))
    hooks.schedules.mockReturnValue(schedules({ items: [] }))

    const markup = renderToStaticMarkup(<TaskAutomationSettingsPage language="en-US" />)

    expect(markup).toContain('Delivery health')
    expect(markup).toContain('Scheduled task delivery')
    expect(markup).toContain('Latest product job runs')
    expect(markup).toContain('No registered product jobs.')
    expect(markup).toContain('My scheduled tasks')
    expect(markup).toContain('product jobs')
    expect(markup).toContain('Execution policy')
    expect(markup).not.toContain('我的定时任务')
  })
})

function renderPage(): string {
  return renderToStaticMarkup(<TaskAutomationSettingsPage language="zh-CN" />)
}

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    agentId: 'agent-1',
    name: 'Task',
    prompt: 'Run',
    trigger: { kind: 'interval', ms: 60_000 },
    timeoutMinutes: 5,
    workspace: { type: 'system' },
    enabled: true,
    status: 'active',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides
  }
}

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    title: 'Job',
    owner: 'platform',
    productId: null,
    trigger: { kind: 'manual' },
    registered: true,
    nextRunAt: null,
    lastRunAt: null,
    lastOutcome: 'never',
    lastRunStatus: null,
    lastDurationMs: null,
    lastErrorSummary: null,
    ...overrides
  }
}

function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const tasks = (overrides.tasks ?? []) as Array<Record<string, unknown>>
  const nameQuery = (overrides.nameQuery as string | undefined) ?? ''
  return {
    language: 'zh-CN',
    loading: false,
    tasks,
    error: null,
    status: 'all',
    setStatus: vi.fn(),
    nameQuery,
    setNameQuery: vi.fn(),
    clearFilters: vi.fn(),
    reload: vi.fn(),
    loadMore: vi.fn(),
    hasMore: overrides.hasMore ?? false,
    toggleTaskExpanded: vi.fn(),
    expandedTaskId: overrides.expandedTaskId ?? null,
    audits: overrides.audits ?? [],
    policyLoading: overrides.policyLoading ?? false,
    policyError: overrides.policyError ?? false,
    reloadPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    policy: overrides.policy === undefined
      ? {
          preset: 'balanced',
          policy: {
            maxActiveTasksPerAgent: 30,
            minimumRecurringIntervalMs: 300_000,
            maximumTimeoutMinutes: 120,
            maxChannelsPerTask: 10
          }
        }
      : overrides.policy,
    state: {
      // Source rows and visible rows are independent: `emptyState` is a verdict, not a row filter.
      filteredTasks: (overrides.rows as unknown[] | undefined) ?? tasks,
      rows: ((overrides.rows as Array<Record<string, unknown>> | undefined) ?? tasks).map((item) => {
        const run = (overrides.taskRuns as Record<string, any> | undefined)?.[String(item.id)]
        return {
          task: item,
          lastRun: run && run.unreadable !== true ? run : null,
          runUnreadable: run?.unreadable === true
        }
      }),
      selectedTask: null,
      expandedTaskId: overrides.expandedTaskId ?? null,
      auditCount: (overrides.audits as unknown[] | undefined)?.length ?? 0,
      deliveryHealth: { delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 },
      aggregateHealth: overrides.aggregateHealth ?? { delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 },
      latestRunAt: '2026-07-17T06:32:05.000Z',
      emptyState: overrides.emptyState ?? 'none',
      hasFilters: nameQuery !== ''
    }
  }
}

function schedules(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loading: false,
    error: false,
    items: [],
    productNames: {},
    reload: vi.fn(),
    ...overrides
  }
}

/**
 * 运行审计分页的入参折算（设置页日志面板的「运行异常」）。
 *
 * 单独成文件不是因为「拆好看」：`ChannelManagementService` 贴着 500 行硬线，而这两段是纯函数——
 * 输入是渲染层给的值，输出是进 SQL 之前的那两个数，不碰仓储、不碰副作用，正好可以独立验证。
 */
import type { ChannelRuntimeAuditCursor } from './ChannelManagementContracts'

/** 一页的上限：服务端说了算，界面传 10 万也只读 200 行。 */
export const RUNTIME_AUDIT_MAX_LIMIT = 200
export const RUNTIME_AUDIT_DEFAULT_LIMIT = 50

/**
 * 非法值退回默认，不抛错：翻页失败不该把整个面板变成一句「没读出来」，
 * 而界面本来只是想往下翻一页。
 */
export function clampAuditLimit(value: unknown): number {
  if (value === undefined) return RUNTIME_AUDIT_DEFAULT_LIMIT
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return RUNTIME_AUDIT_DEFAULT_LIMIT
  return Math.min(value, RUNTIME_AUDIT_MAX_LIMIT)
}

/** 游标只有两个字段；形状不对就当第一页，不把坏游标混进 SQL。 */
export function readAuditCursor(value: unknown): ChannelRuntimeAuditCursor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const cursor = value as Record<string, unknown>
  if (typeof cursor.createdAt !== 'string' || typeof cursor.id !== 'string') return null
  if (!Number.isFinite(Date.parse(cursor.createdAt)) || cursor.id.length === 0) return null
  return { createdAt: cursor.createdAt, id: cursor.id }
}

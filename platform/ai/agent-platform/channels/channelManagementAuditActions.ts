/**
 * 管理审计的动作闭集（谁改了什么）。日志面板把动作码翻成人话，**查不到的写「没有更多说明」**，
 * 但常用动作一个都不许落到兜底——上一版只配了 `create`，于是界面上出现四条「操作：没有更多说明」。
 *
 * 新增动作要同时改这里与文案表；`channelManagementAuditActions` 是唯一闭集，测试钉住两者一一对应。
 */
export const channelManagementAuditActions = [
  'create',
  'update',
  'provision',
  'rotate',
  'disable',
  'request-enable',
  'restart',
  'target-set',
  'policy-create',
  'policy-delete',
  'delete'
] as const

export type ChannelManagementAuditAction = (typeof channelManagementAuditActions)[number]

export type ChannelManagementAuditCopyKey =
  | 'actionCreate'
  | 'actionUpdate'
  | 'actionProvision'
  | 'actionRotate'
  | 'actionDisable'
  | 'actionRequestEnable'
  | 'actionRestart'
  | 'actionTargetSet'
  | 'actionPolicyCreate'
  | 'actionPolicyDelete'
  | 'actionDelete'

/** 动作码 → 文案键。与闭集一一对应，少一个测试就红。 */
export const channelManagementAuditCopyKeys: Readonly<Record<ChannelManagementAuditAction, ChannelManagementAuditCopyKey>> = Object.freeze({
  create: 'actionCreate',
  update: 'actionUpdate',
  provision: 'actionProvision',
  rotate: 'actionRotate',
  disable: 'actionDisable',
  'request-enable': 'actionRequestEnable',
  restart: 'actionRestart',
  'target-set': 'actionTargetSet',
  'policy-create': 'actionPolicyCreate',
  'policy-delete': 'actionPolicyDelete',
  delete: 'actionDelete'
})

export function describeChannelManagementAudit(action: string): ChannelManagementAuditCopyKey | undefined {
  return (channelManagementAuditCopyKeys as Readonly<Record<string, ChannelManagementAuditCopyKey>>)[action]
}

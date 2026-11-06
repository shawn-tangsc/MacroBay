import { describe, expect, it } from 'vitest'

import { channelManagementAuditActions, channelManagementAuditCopyKeys, describeChannelManagementAudit } from './channelManagementAuditActions'

describe('channel management audit actions', () => {
  it('maps every action in the closed set, and nothing else', () => {
    expect(Object.keys(channelManagementAuditCopyKeys).sort()).toEqual([...channelManagementAuditActions].sort())
  })

  it('knows the actions the service actually writes', () => {
    for (const action of ['create', 'update', 'disable', 'request-enable', 'restart', 'policy-create', 'policy-delete', 'target-set', 'delete']) {
      expect(describeChannelManagementAudit(action)).toBeDefined()
    }
    expect(describeChannelManagementAudit('some-unknown-action')).toBeUndefined()
  })
})

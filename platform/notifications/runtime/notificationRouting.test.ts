import { describe, expect, it } from 'vitest'

import type { NotificationRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import { normalizeRequestedChannels } from './notificationRouting'

describe('notification routing settings boundary', () => {
  it('applies product permissions and quiet hours to disruptive channels', () => {
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'alert-engine',
      title: 'Position risk',
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center', 'toast', 'desktop']
    }

    const settings = {
      ...createDefaultNotificationRuntimeSettings(),
      quietHours: { enabled: true, startLocalTime: '00:00', endLocalTime: '23:59' },
      productPermissions: {
        'sample-product': {
          enabled: true,
          allowDesktop: false,
          allowToast: true,
          allowPopup: false
        }
      }
    }

    expect(normalizeRequestedChannels(request, settings)).toEqual(['center'])
  })

  it('allows urgent notifications during quiet hours', () => {
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'alert-engine',
      title: 'Liquidation risk',
      severity: 'critical',
      priority: 'urgent',
      requestedChannels: ['center', 'popup']
    }

    const settings = {
      ...createDefaultNotificationRuntimeSettings(),
      quietHours: { enabled: true, startLocalTime: '00:00', endLocalTime: '23:59' }
    }

    expect(normalizeRequestedChannels(request, settings)).toEqual(['center', 'popup'])
  })
})

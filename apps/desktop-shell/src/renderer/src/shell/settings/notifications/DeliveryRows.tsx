import { Button, Switch } from 'antd'

import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import type { NotificationSettingsText } from './notificationSettingsText'

/**
 * 四个本机落点，一行一个控件（规范 §2）。
 *
 * 「发送到通道」那一行不在这里：发到手机的能力还没被批准，也没有数据源。
 * 画出来就是一句现在为假的话——按「渲染写好了、数据源不存在 = 没做」整块摘掉。
 *
 * 这一块的硬规矩：**一件事只有一个控件**。曾经这里是「行开关 + 逐条勾选」两套，
 * 于是取消订阅后行开关还亮着、清单里那个勾也还亮着，读者无法判断哪个算数。
 */
const PERMISSION_TONE: Record<'granted' | 'denied' | 'unknown', StatusPillTone> = {
  granted: 'ok',
  denied: 'bad',
  unknown: 'muted'
}

export function DeliveryRows(props: {
  text: NotificationSettingsText
  toastEnabled: boolean
  onToastChange: (next: boolean) => void
  desktopPermission: 'granted' | 'denied' | 'unknown' | null
  onOpenSystemSettings?: () => void
  onOpenChannelPage?: () => void
}): React.ReactElement {
  const { text, desktopPermission } = props

  return (
    <div className="notification-rows">
      {/* 通知中心：无控件，右侧一个标签。标签不是禁用开关——禁用开关会让人以为以后能开。 */}
      <div className="notification-row" data-row="center">
        <span className="notification-row-copy">
          <strong>{text.centerRow}</strong>
          <span className="notification-row-desc">{text.centerDesc}</span>
        </span>
        <span className="notification-row-control">
          <span className="notification-subs-fixed">{text.centerFixed}</span>
        </span>
      </div>

      {/* 应用内提示：全站一个开关，不是总闸。 */}
      <div className="notification-row" data-row="toast">
        <span className="notification-row-copy">
          <strong>{text.toastRow}</strong>
          <span className="notification-row-desc">{text.toastDesc}</span>
        </span>
        <span className="notification-row-control">
          <Switch size="small" checked={props.toastEnabled} onChange={(next) => props.onToastChange(next)} />
        </span>
      </div>

      {/* 桌面通知：没有开关。开关是清单里的桌面列，这一行只说系统放没放行。 */}
      <div className="notification-row" data-row="desktop" data-permission={desktopPermission ?? 'unknown'}>
        <span className="notification-row-copy">
          <strong>{text.desktopRow}</strong>
          <span className="notification-row-desc">{text.desktopDesc}</span>
          {desktopPermission === 'denied' ? (
            <span className="notification-row-hint" role="note">
              {text.desktopKeepChoice}
            </span>
          ) : null}
        </span>
        <span className="notification-row-control">
          {desktopPermission === null ? null : (
            <StatusPill
              tone={PERMISSION_TONE[desktopPermission]}
              labelKey={
                desktopPermission === 'granted'
                  ? text.desktopPermissionGranted
                  : desktopPermission === 'denied'
                    ? text.desktopPermissionDenied
                    : text.desktopPermissionUnknown
              }
              resolveText={(key) => key}
            />
          )}
          {desktopPermission === 'denied' && props.onOpenSystemSettings !== undefined ? (
            <Button size="small" onClick={props.onOpenSystemSettings}>
              {text.desktopOpenSettings}
            </Button>
          ) : null}
        </span>
      </div>

      {/* 高优先级弹窗：整行禁用 + 常驻原因。原因说「位置先留着」，不说「以后会做」。 */}
      <div className="notification-row notification-row--disabled" data-row="popup" aria-disabled="true">
        <span className="notification-row-copy">
          <strong>{text.popupRow}</strong>
          <span className="notification-row-desc" role="note">
            {text.popupDisabled}
          </span>
        </span>
      </div>

    </div>
  )
}

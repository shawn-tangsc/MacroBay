import { useState } from 'react'
import { Button } from 'antd'

import { Modal } from '@platform/ui/components/modal'

import type { PlatformText } from '../../i18n/platformText'

/**
 * 启动时设置文件读不到的恢复面（用户 2026-11-10 定）。
 *
 * 三条边界写进形状里：
 * - 副本路径**不进 ⓘ**：读者要拿它去复制/备份，所以直接放第二行、等宽、可选中；
 * - 拿不到路径就说「未能保留」，**不许**说「已保留」——那是假承诺；
 * - 「重置设置」不在这条里（不可逆，和「重试」并排会被误点），它单独放在设置页底部危险区。
 */
export function SettingsReadFailureBanner(props: {
  text: PlatformText['settings']
  /** 坏文件副本路径；`null` = 没留成。 */
  copyPath: string | null
  retrying: boolean
  onRetry: () => void
}): React.ReactElement {
  const { text } = props
  return (
    <div className="settings-file-recovery" data-settings-read-failure role="alert">
      <div className="settings-file-recovery__body">
        <span>{text.settingsFileUnreadable}</span>
        {props.copyPath === null ? (
          <small data-settings-copy-missing>{text.settingsFileCopyMissing}</small>
        ) : (
          <code className="settings-file-recovery__path" data-settings-copy-path>
            {text.settingsFileCopyKept(props.copyPath)}
          </code>
        )}
      </div>
      <Button disabled={props.retrying} onClick={props.onRetry} size="small">
        {text.settingsFileRetry}
      </Button>
    </div>
  )
}

/**
 * 设置页底部的危险区：**显式**重建设置文件。
 *
 * 只有读者在这里确认之后才会写盘；启动降级本身绝不自动重置、绝不覆盖坏文件。
 * 确认框里再把路径写一遍，免得读者在按下去之前忘了自己丢掉的是哪一份。
 */
export function SettingsResetDangerZone(props: {
  text: PlatformText['settings']
  copyPath: string | null
  onReset: () => Promise<void> | void
}): React.ReactElement {
  const { text } = props
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)

  async function run(): Promise<void> {
    setPending(true)
    try {
      await props.onReset()
      setConfirming(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="settings-reset-danger" aria-label={text.settingsReset}>
      {/* 危险动作静止红：`danger` 档不靠 hover，也绝不和「重试」并排。 */}
      <Button danger onClick={() => setConfirming(true)} size="small">
        {text.settingsReset}
      </Button>
      <Modal
        footer={
          <>
            <Button key="cancel" onClick={() => setConfirming(false)}>
              {text.settingsResetCancel}
            </Button>
            <Button danger key="reset" loading={pending} onClick={() => void run()} type="primary">
              {text.settingsResetConfirm}
            </Button>
          </>
        }
        onClose={() => setConfirming(false)}
        open={confirming}
        resolveText={(key) => (key === 'settings.settingsResetConfirmTitle' ? text.settingsResetConfirmTitle : '')}
        titleKey="settings.settingsResetConfirmTitle"
        width="compact">
        <p>{text.settingsResetConfirmBody}</p>
        {props.copyPath === null ? (
          <p data-settings-reset-copy-missing>{text.settingsFileCopyMissing}</p>
        ) : (
          <p className="settings-file-recovery__path" data-settings-reset-copy-path>
            {text.settingsFileCopyKept(props.copyPath)}
          </p>
        )}
      </Modal>
    </section>
  )
}

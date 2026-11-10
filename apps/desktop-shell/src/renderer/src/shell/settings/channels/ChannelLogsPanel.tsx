import { Button } from 'antd'
import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { LoadingState } from '@platform/ui/components/loading'
import { SettingInfoPopover } from '../SettingInfoPopover'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellClock, formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import type { PlatformText } from '../../../i18n/platformText'

import {
  buildChannelLogRows,
  type ChannelLogCodeInput,
  type ChannelLogOperationInput,
  type ChannelLogRow,
  type ChannelLogSources
} from './channelLogs'

const COPY_KEY = 'settings.channels.logs.copy'
const COPIED_KEY = 'settings.channels.logs.copied'

/**
 * 频道日志面板：只读三类记录（操作 / 运行异常 / 最近一次发送失败）。
 *
 * 三态各一句，别多写：空态给「还没有记录 + 会记什么」，**不给复制**（没内容可复制）；
 * 读失败说「没读出来 + 已有记录不会丢 + 重试」，**不许写成「没有记录」**——那是两件事；
 * 有记录时底部只留一行边界说明。
 *
 * 遮蔽与宽度归平台 `Modal`（遮罩、焦点、层级都不在这页写）；这里只负责内容。
 */
export function ChannelLogsPanel(props: {
  channelId: string
  platformName: string
  labels: PlatformText['settings']
  /**
   * 三个读口**只返回 `{ rows }`**：形状收敛在页面的调用点（那里有类型），面板只认一种，
   * 不再写「数组或 { rows }」的兼容层——上游漂移就该在类型上红，不该在界面里被兼容掉。
   */
  client: {
    listAudits?: (input: { channelId: string; limit: number; offset: number }) => Promise<{ rows: readonly ChannelLogOperationInput[] }>
    listRuntimeAudits?: (input: { channelId: string; limit: number }) => Promise<{ rows: readonly ChannelLogCodeInput[] }>
    listDeliveryAudits?: (input: { channelId: string; limit: number; offset: number }) => Promise<{ rows: readonly ChannelLogCodeInput[] }>
  }
  onClose: () => void
}): React.ReactElement {
  const { labels } = props
  const timeZone = useShellTimeZone()
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ChannelLogRow[] }>({
    status: 'loading'
  })
  const [copied, setCopied] = useState(false)

  const load = async (): Promise<void> => {
    setState({ status: 'loading' })
    try {
      const [operations, runtime, deliveries] = await Promise.all([
        props.client.listAudits?.({ channelId: props.channelId, limit: 50, offset: 0 }) ?? { rows: [] },
        props.client.listRuntimeAudits?.({ channelId: props.channelId, limit: 50 }) ?? { rows: [] },
        props.client.listDeliveryAudits?.({ channelId: props.channelId, limit: 50, offset: 0 }) ?? { rows: [] }
      ])
      const sources: ChannelLogSources = {
        operations: operations.rows,
        runtime: runtime.rows,
        deliveries: deliveries.rows
      }
      setState({ status: 'ready', rows: buildChannelLogRows(sources, labels) })
    } catch {
      setState({ status: 'error' })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // 时间口径：标题声明一次时区，每行只写时刻（同日 HH:mm、跨日 MM-DD HH:mm），
  // 复制出来的纯文本与屏幕完全一致——标题声明的那句也一并带上。
  const timeLabel = formatShellTimeZoneLabel(timeZone, 'zh-CN')
  const clock = (row: ChannelLogRow): string => formatShellClock(row.at, { timeZone }) ?? row.at
  const line = (row: ChannelLogRow): string => `${clock(row)} [${row.level}] ${row.text}`

  const copyAll = async (): Promise<void> => {
    if (state.status !== 'ready' || state.rows.length === 0) return
    const text = [`${labels.channelLogsTimeZone.replace('{zone}', timeLabel)}`, ...state.rows.map(line)].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 复制失败不编一句「已复制」：按钮恢复原样，读者可以再点一次。
      setCopied(false)
    }
  }

  /**
   * 先判状态（加载 / 读失败），再**按长度**决定画内容还是空态。
   * 不把「有没有内容」交给状态位：那是守卫抓的形态，也是「读到了 0 条却画成加载中」的来源。
   */
  function renderBody(): React.ReactElement {
    if (state.status === 'loading') return <LoadingState label={labels.channelLogsRetry} />
    if (state.status === 'error') {
      return (
        <>
          <p className="channel-log-state" role="note">
            {labels.channelLogsReadFailed}
          </p>
          <p className="channel-log-hint">{labels.channelLogsReadFailedHint}</p>
          <Button onClick={() => void load()} size="small">
            {labels.channelLogsRetry}
          </Button>
        </>
      )
    }
    if (state.rows.length === 0) {
      return (
        <>
          <p className="channel-log-state" role="note">
            {labels.channelLogsEmptyTitle}
          </p>
        </>
      )
    }
    return (
      <>
        {/* 时区只声明一次：每行都带 GMT+n 会吵，也容易在标题里被手写成固定值。 */}
        <p className="channel-log-tz">{labels.channelLogsTimeZone.replace('{zone}', timeLabel)}</p>
        <ul className="channel-log-list">
          {state.rows.map((row) => (
            <li className="channel-log-row" data-log-level={row.level} key={row.id}>
              <span className="channel-log-time">{clock(row)}</span>
              <span className="channel-log-level" data-log-level={row.level}>
                [{row.level}]
              </span>
              <span className="channel-log-text">{row.text}</span>
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <Modal
      open
      width="expanded"
      onClose={props.onClose}
      titleKey="settings.channels.logs"
      titleParams={{ name: props.platformName }}
      resolveText={(key) => (key === 'settings.channels.logs' ? labels.channelLogsTitle : '')}
      footer={null}
    >
      {/*
        * 两句说明（记录范围、以及「空态时会出现在这里的是什么」）收进标题这颗 ⓘ：
        * 面板正文只留状态行与记录本身。是移出 DOM，不是藏起来。
        */}
      <div className="channel-log-header">
        <SettingInfoPopover
          hintKeys={['channelLogsFooter', 'channelLogsEmptyHint']}
          infoLabelKey="channelLogsFooterInfo"
          resolveText={(key: string) => (labels as unknown as Record<string, string>)[key] ?? ''}
        />
      </div>

      {state.status === 'ready' && state.rows.length > 0 ? (
        <div className="channel-log-toolbar">
          <IconButton
            // 复制成功要看得见：读屏名与悬停提示一起换成「已复制」，1.5 秒后回「复制」。
            // 之前这里两个分支写的是同一句，等于没有回执。
            ariaLabelKey={copied ? COPIED_KEY : COPY_KEY}
            icon={Copy}
            onSelect={() => void copyAll()}
            resolveText={(key) =>
              key === COPY_KEY ? labels.channelLogsCopy : key === COPIED_KEY ? labels.channelLogsCopied : ''
            }
            size="md"
            tooltipKey={copied ? COPIED_KEY : COPY_KEY}
          />
        </div>
      ) : null}

      {renderBody()}
    </Modal>
  )
}

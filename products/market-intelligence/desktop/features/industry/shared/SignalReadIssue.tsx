import { CircleAlert } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import type { ModuleSignalReadFailureCode } from '../../../../contracts/moduleSignalRead'

import './SignalReadIssue.css'

/**
 * 「这一块我们出错了」的那个小红感叹号。
 *
 * 三条边界，都是读者视角定的：
 * - 只标**我们的错**（读取失败、返回形状不对、有条目被丢）；「还没有分析」是正常状态，不标——
 *   拿红色吓人和把错说成没有一样坏。
 * - 一处一个，16px，不占版面：它是个标记，不是一行公告。卡片正面不再有一整行排障话。
 * - 悬停与键盘聚焦都要出（`Popover` 两者都给），句子是人话、**不带码**、**不给按钮**：这件事
 *   不用读者动手，下一次刷新会自己再读一次。放一个按钮等于要求他去做一件他做不了的事。
 */
export function SignalReadIssue({ failureCode, resolveText }: Readonly<{
  failureCode: ModuleSignalReadFailureCode
  resolveText: (key: string) => string
}>): React.ReactElement {
  const key = (part: string): string => `pages.intelligence.portal.dashboard.signalRead.${part}`
  return <Popover
    lines={[{ labelKey: key(failureCode) }]}
    resolveText={resolveText}
    trigger={triggerProps => <IconButton {...triggerProps}
      ariaLabelKey={key('ariaLabel')}
      className="mi-signal-read-issue"
      icon={CircleAlert}
      size="sm"
      resolveText={resolveText} />} />
}

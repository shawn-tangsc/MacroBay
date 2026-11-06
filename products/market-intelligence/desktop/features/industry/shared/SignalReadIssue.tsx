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
 * - 悬停与键盘聚焦都要出（`Popover` 两者都给），句子是人话、**不带码**、**不给按钮**。句子只说
 *   「这次没查到、上面的数字不受影响」，不承诺任何“下次会好”：有一种失败（版本对不上）刷新一万次
 *   也不会好，承诺它就是在编。
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
      // 16px 字形只有 `md` 这一档（`GLYPH_PX.sm` 是 14），热区随 `md` 是 24。
      icon={CircleAlert}
      size="md"
      resolveText={resolveText} />} />
}

import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

/**
 * ⓘ 入口的标准写法：**一句说明 + 一颗图标按钮**。
 *
 * 为什么要有它：界面判据是「说明性文字只许进 icon 的浮层」，但每个调用点自己拼一遍
 * `Popover + IconButton + resolveText` 迟早会有人漏掉可访问名，或者把句子直接写在正文里。
 * 这里把三件事收在一处：浮层内容 = 那句话，按钮的可访问名也是那句话（正文不出现、读屏听得到）。
 *
 * 用法：`helpTrigger({ text: '关掉后不再调用模型。', label: '关闭 AI 编辑会怎样' })`，
 * 返回值直接放进行内的说明位（`SettingsRow` 的 label 里、标题旁）。
 */
export function helpTrigger(input: Readonly<{
  /** 浮层里那句说明（已经解析好的句子）。 */
  text: string
  /** 读屏名；不给就用同一句说明。 */
  label?: string
}>): React.ReactElement {
  const label = input.label ?? input.text
  return <Popover
    content={<span>{input.text}</span>}
    trigger={(triggerProps) => <IconButton
      {...triggerProps}
      ariaLabelKey="ui.help.trigger"
      icon={Info}
      resolveText={(key: string) => (key === 'ui.help.trigger' ? label : '')}
      size="sm"
      variant="plain" />}
  />
}

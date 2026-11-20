import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { HELP_TRIGGER_KEY, useHelpTriggerText } from './helpTriggerText'

/**
 * ⓘ 入口的标准写法：**一句说明 + 一颗图标按钮**。
 *
 * 为什么要有它：界面判据是「说明性文字只许进 icon 的浮层」，但每个调用点自己拼一遍
 * `Popover + IconButton + resolveText` 迟早会有人漏掉可访问名，或者把句子直接写在正文里。
 * 这里把三件事收在一处：浮层内容 = 那句话，按钮的可访问名是平台同一句「查看说明」
 * （正文不出现、读屏听得到）。
 *
 * 用法：`helpTrigger({ text: '关掉后不再调用模型。' })`，返回值直接放进行内的说明位
 * （`SettingsRow` 的 label 里、标题旁）。
 *
 * 为什么外面这层不是组件、里面那层才是：调用点会**有条件地**调它
 * （`officialUnavailableDetail === undefined ? null : helpTrigger(...)`），函数里直接调 hook
 * 会违反 hook 顺序。所以外层只构造元素，取语言与文案都发生在内层组件里——
 * 调用点的写法因此一个字都不用改。
 */
export function helpTrigger(input: Readonly<{
  /** 浮层里那句说明（已经解析好的句子）。 */
  text: string
}>): React.ReactElement {
  return <HelpTrigger text={input.text} />
}

function HelpTrigger({ text }: Readonly<{ text: string }>): React.ReactElement {
  // 读屏名归平台：同一个 ⓘ 在每个页面都是同一句「查看说明」，不再由调用点把浮层正文顶上来当名字。
  const resolveText = useHelpTriggerText()
  return <Popover
    content={<span>{text}</span>}
    trigger={(triggerProps) => <IconButton
      {...triggerProps}
      ariaLabelKey={HELP_TRIGGER_KEY}
      icon={Info}
      resolveText={resolveText}
      size="sm"
      variant="plain" />}
  />
}

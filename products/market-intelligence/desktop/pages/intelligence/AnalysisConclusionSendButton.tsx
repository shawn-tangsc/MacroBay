import { LoadingSpinner } from '@platform/ui/components/loading'

import type { AnalysisConclusionSendText } from './analysisConclusionSendText'

import './analysisConclusionSend.css'

/**
 * 抽屉标题行右端那枚「发送到频道」（动作槽归平台抽屉的 `actions`）。
 *
 * 两件事写进结构、不靠记得：
 *
 * 1. **发送中真禁用**（`disabled`，不是只改样式）：连点会各发一条不同的记录，读者手机上就是两条。
 * 2. **宽度不随文案跳**：文案在「发送到频道」与「正在发送」之间切换，两句字数不同，按钮会缩一下、
 *    把标题顶回几像素。这里把两句都排进同一个网格单元、当前不显示的那句 `visibility: hidden`——
 *    宽度天然等于较宽那句，**不用固定像素去凑**，换语言也不会失准。
 */
export function AnalysisConclusionSendButton(props: Readonly<{
  text: AnalysisConclusionSendText
  sending: boolean
  disabled?: boolean
  onSelect: () => void
}>): React.ReactElement {
  const disabled = props.disabled === true || props.sending
  return <button
    aria-busy={props.sending || undefined}
    className="mi-analysis-send__button"
    disabled={disabled}
    onClick={props.onSelect}
    type="button">
    {props.sending ? <LoadingSpinner size="sm" /> : null}
    <span className="mi-analysis-send__labels">
      {/* 三层同一格：可见的那句 + 两句的量宽层。量宽的层对读屏隐藏，也不吃点击。 */}
      <span className="mi-analysis-send__label" data-send-label="current">{props.sending ? props.text.sending : props.text.button}</span>
      <span aria-hidden="true" className="mi-analysis-send__label mi-analysis-send__label--ghost">{props.text.sending}</span>
      <span aria-hidden="true" className="mi-analysis-send__label mi-analysis-send__label--ghost">{props.text.button}</span>
    </span>
  </button>
}

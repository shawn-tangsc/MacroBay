import { currentConfirmInstanceForTest } from './ConfirmProvider'
import { confirmOptions } from './confirmOptions'

/**
 * 破坏性操作的确认对话框（B0 契约 §8）。
 *
 * 用途单一：用户即将做一件不可撤销的事，先让他确认。它不是消息框、不是回执。
 *
 * **渲染入口是 `<ConfirmProvider>` + `useConfirm()`**：静态 `Modal.confirm` 站在 React 树外，
 * 只吃 antd 默认主题——深色界面弹浅色框就是这么来的。确认框必须由 `Modal.useModal()` 的实例渲染，
 * 才能吃到当前树上的 `ConfigProvider`。
 *
 * 组件内**零文案**：四个字符串字段全部必填、没有一处内部兜底。
 * 有兜底的地方就会长出七种「确定」，之后再也没人统一。
 */
export type ConfirmTone = 'default' | 'danger'

export type ConfirmProps = {
  title: string
  /** 说清后果（「删掉之后不能恢复」），不写「确定吗」。 */
  description?: string
  /** 无默认值：缺了编译不过。 */
  confirmLabel: string
  /** 无默认值：组件内不 import i18n，兜底文案无处可取。 */
  cancelLabel: string
  /** 无默认值：迫使每次调用回答一次「这操作可撤销吗」。 */
  tone: ConfirmTone
  /** 抛错时对话框保持打开，错误由调用方展示；组件内不弹 toast。 */
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

/**
 * 遗留入口：**不新增调用点**，新代码用 `useConfirm()`。
 *
 * 不改签名，是因为还有三处调用点在用；正确做法是它们各自迁到 `useConfirm()` 并删掉这个函数，
 * 而不是在这里偷偷换成抛错（那会让三处的确认框当场消失）。渲染用的是 `ConfirmProvider` 登记的
 * 那个实例，所以主题是当前的、深浅色一致。
 *
 * **取不到实例就抛错**：静默退回静态方法，就是这条 bug 原来的样子——看起来能用，颜色错了没人报错。
 */
export function confirmAction(props: ConfirmProps): void {
  const modal = currentConfirmInstanceForTest()
  if (modal === null) {
    throw new Error(
      'confirmAction() needs <ConfirmProvider> above it: the static Modal.confirm renders outside the React tree and ignores the current theme'
    )
  }
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  modal.confirm(confirmOptions(props, trigger))
}

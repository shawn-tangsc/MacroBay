import type { Modal } from 'antd'

import type { ConfirmProps } from './Confirm'

/** `Modal.useModal()` 交出的实例：确认框必须由它渲染，才能吃到当前 React 树里的 `ConfigProvider`。 */
export type ModalInstance = ReturnType<typeof Modal.useModal>[0]

/**
 * antd 的 `ModalFuncProps` 没有声明 `isSilent`，但运行时认它。
 *
 * 显式写出这个形状，而不是 `as any`——`as any` 会在下一次「清理类型」时被安静删掉，
 * 然后 `onOk` 的拒绝又变成未处理拒绝、测试开始偶发红，而没人知道为什么。
 */
export type ConfirmOptionsWithSilent = Parameters<ModalInstance['confirm']>[0] & { isSilent?: () => boolean }

/**
 * 确认框的选项**只有这一份构造**：`useConfirm()` 与遗留的 `confirmAction()` 都走这里。
 *
 * 两套实现各写一份选项，是这类组件最常见的漂移点——今天已经因为「静态方法 vs 树内实例」
 * 漂出过深浅色不一致，没必要再让文案与危险档分叉一次。
 */
export function confirmOptions(props: ConfirmProps): ConfirmOptionsWithSilent {
  return {
    isSilent: () => true,
    title: props.title,
    content: props.description,
    okText: props.confirmLabel,
    cancelText: props.cancelLabel,
    okButtonProps: props.tone === 'danger' ? { danger: true } : undefined,
    // 危险档焦点落在取消上：按住回车连击时，落在确认上就是连续执行破坏性操作。
    autoFocusButton: props.tone === 'danger' ? 'cancel' : 'ok',
    centered: true,
    /*
     * 失败的处理：**接住拒绝，关闭弹窗，错误交给调用方在行内展示**（契约 §8）。
     *
     * 原来的写法是「返回调用方的 promise，antd 在拒绝时保持弹窗打开」，并靠 `isSilent` 吞掉
     * antd 自己再抛的那一次。实测（2026-11-02）：`isSilent` 在 `Modal.useModal()` 的实例上
     * **一次都没被调用到**（在构造器里打点确认过），于是同一次失败会沿 antd 的 promise 链再抛一次，
     * 变成进程级未处理拒绝——它污染日志，并让 `pnpm verify` 的测试阶段以非零退出。
     *
     * 取舍写在明面上：**「弹窗留着让读者原地重试」换不来一条未处理拒绝**。三处调用点本来就会
     * 在行内展示失败原因（`ModelServiceClearModelsControl` 的注释就是这么写的），所以关掉弹窗
     * 不会让错误消失。`isSilent` 仍然传：静态路径认它，将来 hook 路径修好也自动受益。
     */
    onOk: () => Promise.resolve(props.onConfirm()).catch(() => undefined),
    onCancel: () => props.onCancel?.()
  }
}

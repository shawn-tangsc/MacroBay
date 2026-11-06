[English](./confirm.md) | [中文](./confirm.zh-CN.md) | [← 文档](../README.md)

# 确认对话框

不可撤销的动作之前问一次。每个渲染根挂 `ConfirmProvider`，在动作发生的地方调 `useConfirm()`。

```tsx
const confirm = useConfirm()
confirm({
  title: t.deleteTitle,
  description: t.deleteConsequence,
  confirmLabel: t.delete,
  cancelLabel: t.cancel,
  tone: 'danger',
  onConfirm: () => deleteIt()
})
```

## 它渲染在哪，以及为什么这就是全部关键

弹窗由 `ConfirmProvider` 里的 `Modal.useModal()` 创建，`contextHolder` **放在树里**。正因如此它才吃得到外层的
`ConfigProvider`——主题、语言、按钮配置。静态 `Modal.confirm` 站在 React 树外，只吃 antd 默认主题，这就是
深色窗口弹浅色框的成因。

由此两条规矩：

- **每个渲染根都要挂**。主窗与每个分离窗是彼此独立的根，分离窗吃不到主窗那层 Provider——这条债最早就在那儿。
- **没有兜底**。`useConfirm()` 找不到 Provider 直接抛错，遗留的 `confirmAction()` 同样抛错。静默兜底正是浅色框能活下来的原因：它照常工作，只是颜色错了，而且没人报错。

`confirmAction()` 留给还没迁的调用点；它经由最近一层 Provider 登记的实例渲染，所以主题也是对的。新代码用 `useConfirm()`。

## 失败处理：这是取舍，不是遗漏

`onOk` **接住失败并关闭弹窗**，原因由调用方在行内展示（现有调用点本来就这么做）。焦点回到打开弹窗的那颗按钮。

另一条路是「弹窗留着让读者原地重试」。但 `isSilent`——让 antd 不把被拒的处理器再抛一次的那个开关——在 `useModal()`
实例上不生效（实测：那个回调一次都没被调用）。于是拒绝会沿 antd 自己的链再抛一次，变成进程级未处理拒绝，把测试阶段
打成非零退出。**一条泄漏的拒绝比一次原地重试更贵**：前者污染日志、挡住门禁，后者只多一次点击。要改回这条得换一套
弹窗实现，不是一个开关的事。

## 文案与行为

- 组件内零文案。`title`、`confirmLabel`、`cancelLabel` 必填；`tone` 必填，迫使每次调用回答「这操作可撤销吗」。
- `tone: 'danger'` 把初始焦点放在**取消**上——按住回车连击不能连续执行破坏性动作。
- 它不是消息框、也不是回执：它只为「两个结果的二选一」而存在。

## 用到它的组件怎么测

用 `platform/ui/components/confirm/confirmTestSupport` 里的 `renderWithConfirm`，只有一个入口：

```tsx
const view = renderWithConfirm(<MyPage />)
view.clickDialogButton('删除')
await view.unmount()
```

各文件手写 Provider 包裹，正是一次性红掉十六例的原因——同一个前提被复制了九遍，其中一份漏了。

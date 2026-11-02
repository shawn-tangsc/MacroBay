import { unstableSetRender } from 'antd'
import { createRoot, type Root } from 'react-dom/client'

/**
 * 让 antd 的**静态方法**在 React 19 下真的能渲染。
 *
 * 症状是可复算的：`Modal.confirm` / `message.*` / `notification.*` 走 `unstableSetRender()`，
 * 而 React 19 的 `react-dom` 根导出已经没有 `createRoot`/`render`，antd 拿不到渲染器就
 * **静默什么都不做**——按钮点了、`scheduleRender` 也跑了，`document.body` 里一个节点都没有。
 *
 * 官方给「antd 5 + React 19」的正解是 `@ant-design/v5-patch-for-react-19`；这里做的是同一件事的
 * 等价实现（把 `createRoot` 交给 `unstableSetRender`），只是不新增依赖——本仓当前装不了新包，
 * 而这一条是今天所有确认框、提示消息能否显示的前提。
 *
 * 每个渲染入口调用一次（幂等）：多调一次不会重复接管。
 */

type ContainerWithRoot = HTMLElement & { __antdStaticRoot?: Root }

let installed = false

export function installAntdStaticRender(): void {
  if (installed) return
  installed = true

  unstableSetRender((node, container) => {
    const host = container as ContainerWithRoot
    host.__antdStaticRoot ??= createRoot(container)
    host.__antdStaticRoot.render(node)

    return async () => {
      // 等一帧再卸载：antd 的关闭动画还在用它。
      await new Promise((resolve) => setTimeout(resolve, 0))
      host.__antdStaticRoot?.unmount()
      delete host.__antdStaticRoot
    }
  })
}

/** 仅供测试：断言「只接管一次」而不用去摸模块内部状态。 */
export function isAntdStaticRenderInstalled(): boolean {
  return installed
}

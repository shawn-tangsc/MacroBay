import type { ProductManifest } from '../../product-manifest'
import type { ProductIpcMethod } from '../ipc/productIpcRegistry'

/**
 * 启动期「哪些产品真的注册服务」与「注册面应当有哪些 IPC 方法」两个纯函数。
 *
 * 从 `app.ts` 抽出来：那颗文件已到体积线，而这里是**纯计算**——输入清单、输出清单，
 * 不读文件、不注册、不碰 electron。抽出来之后两处判据能单独测。
 */
export function resolveBootstrapProductManifests(
  productManifests: readonly ProductManifest[],
  taskSmokeEnabled: boolean
): readonly ProductManifest[] {
  if (taskSmokeEnabled) return []
  return productManifests
}

export function expectedProductIpcMethods(productManifests: readonly ProductManifest[]): readonly ProductIpcMethod[] {
  return productManifests.flatMap((manifest) =>
    manifest.serviceRoutes.map(({ method }) => ({ productId: manifest.id, method }))
  )
}

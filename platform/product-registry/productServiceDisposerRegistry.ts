export type ProductServiceDisposer = () => void | Promise<void>
export type ProductServiceDisposerRegistrar = (disposer: ProductServiceDisposer) => () => void

export function createProductServiceDisposerRegistry(): {
  register: ProductServiceDisposerRegistrar
  disposeAll(): Promise<void>
} {
  const disposers = new Set<ProductServiceDisposer>()
  let disposed = false

  return {
    register(disposer) {
      if (disposed) throw new Error('Product service disposer registry is already disposed.')
      disposers.add(disposer)
      return () => disposers.delete(disposer)
    },
    async disposeAll(): Promise<void> {
      if (disposed) return
      disposed = true
      const pending = [...disposers]
      disposers.clear()
      await Promise.allSettled(pending.map((dispose) => Promise.resolve().then(dispose)))
    }
  }
}

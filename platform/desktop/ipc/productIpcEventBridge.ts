export type ProductIpcEventSender = (productId: string, event: string, data: unknown) => void

let productIpcEventSender: ProductIpcEventSender | null = null

export function registerProductIpcEventSender(sender: ProductIpcEventSender): void {
  productIpcEventSender = sender
}

export function emitProductIpcEvent(productId: string, event: string, data: unknown): void {
  productIpcEventSender?.(productId, event, data)
}

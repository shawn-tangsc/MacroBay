export const productAgentToolErrorCodes = [
  'tool-disabled',
  'approval-denied',
  'missing-handler',
  'invalid-input-schema',
  'invalid-output-schema',
  'missing-temporal-boundary',
  'invalid-temporal-boundary',
  'temporal-boundary-in-future',
  'timeout',
  'cancelled',
  'output-too-large',
  'handler-error',
  'product-unavailable',
  'permission-denied'
] as const

export type ProductAgentToolErrorCode = (typeof productAgentToolErrorCodes)[number]

export class ProductAgentToolError extends Error {
  readonly code: ProductAgentToolErrorCode

  constructor(code: ProductAgentToolErrorCode, message: string) {
    super(message)
    this.name = 'ProductAgentToolError'
    this.code = code
  }
}

export function isProductAgentToolError(error: unknown): error is ProductAgentToolError {
  return error instanceof ProductAgentToolError
}

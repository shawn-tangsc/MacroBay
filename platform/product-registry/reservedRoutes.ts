export const RESERVED_SHELL_ROUTE_PATHS = [
  '/agents',
  '/chat',
  '/data',
  '/docs',
  '/home',
  '/settings'
] as const

export function isReservedShellRoutePath(routePath: string): boolean {
  return (RESERVED_SHELL_ROUTE_PATHS as readonly string[]).includes(routePath)
}

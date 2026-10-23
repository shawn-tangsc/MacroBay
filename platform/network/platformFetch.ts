import { net } from 'electron'

export function getPlatformFetch(): typeof fetch {
  return net.fetch.bind(net) as typeof fetch
}

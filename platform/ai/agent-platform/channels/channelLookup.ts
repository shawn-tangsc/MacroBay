/**
 * 「按 id 取一条频道，取不到就抛」——**全仓唯一一份**。
 *
 * 之前它是管理服务的私有方法，只读查询与变更路径共用同一个实现；拆模块时最容易犯的错就是
 * 复制第二份，然后一处抛 `channel-not-found`、另一处抛别的，调用方按错误的码去提示用户。
 */
import type { ChannelManagementRepository } from './ChannelManagementRepository'
import { assertIdentifier } from './ChannelManagementContracts'

export function requireExistingChannel(repository: ChannelManagementRepository, id: unknown): string {
  const normalized = assertIdentifier(id)
  if (!repository.query.get(normalized)) throw new Error('channel-not-found')
  return normalized
}

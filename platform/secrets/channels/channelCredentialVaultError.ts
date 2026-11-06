/**
 * 凭据 Vault 的统一失败信号。
 *
 * 单独一个文件：迁移身份（指纹 / permit / 预留 ref）现在住在 `channelCredentialMigration`，
 * 它也要抛同一个错误；错误类留在 vault 里会让两者互相 import。
 */
export class ChannelCredentialVaultError extends Error {
  constructor() {
    super('Channel credential vault is unavailable.')
    this.name = 'ChannelCredentialVaultError'
  }
}

export function unavailable(): ChannelCredentialVaultError {
  return new ChannelCredentialVaultError()
}

const providerIconModules = import.meta.glob('../assets/icons/providers/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const modelIconModules = import.meta.glob('../assets/icons/models/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

function resolveIconUrl(modules: Record<string, string>, key: string | undefined): string | undefined {
  if (!key) return undefined
  return modules[`../assets/icons/providers/${key}.svg`] ?? modules[`../assets/icons/models/${key}.svg`]
}

export function getProviderIconUrl(key: string | undefined): string | undefined {
  return resolveIconUrl(providerIconModules, key)
}

export function getModelIconUrl(key: string | undefined): string | undefined {
  return resolveIconUrl(modelIconModules, key)
}

import type { AbilityResult } from '../native/abilities'

/** Interpret installation evidence without inferring success from a successful RPC. */
export function getInstalledStatus(result: AbilityResult): boolean | null {
  if (result.isError) return null
  const text = typeof result.content === 'string'
    ? result.content
    : typeof result.text === 'string' ? result.text : ''
  if (text.includes('未安装')) return false
  if (text.includes('已安装')) return true
  return null
}

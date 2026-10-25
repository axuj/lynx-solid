export interface SafeAreaInsets {
  top: number
  bottom: number
}

type SparklingGlobalProps = Record<string, unknown>

const EMPTY_INSETS: SafeAreaInsets = { top: 0, bottom: 0 }

function toInset(value: unknown): number {
  const inset = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof inset === 'number' && Number.isFinite(inset) && inset > 0
    ? inset
    : 0
}

export function getSafeAreaInsetsFromGlobalProps(
  globalProps?: SparklingGlobalProps,
): SafeAreaInsets {
  const os = String(globalProps?.os ?? '').toLowerCase()
  const hasExplorerInsets = globalProps?.safeAreaTop !== undefined
    || globalProps?.safeAreaBottom !== undefined

  if (os === 'android' || (os !== 'ios' && !hasExplorerInsets))
    return EMPTY_INSETS

  return {
    top: toInset(globalProps?.topHeight ?? globalProps?.safeAreaTop),
    bottom: toInset(globalProps?.bottomHeight ?? globalProps?.safeAreaBottom),
  }
}

export function getSparklingSafeAreaInsets(): SafeAreaInsets {
  try {
    const g = globalThis.__elkGlobalProps
    return getSafeAreaInsetsFromGlobalProps(g)
  }
  catch {
    return EMPTY_INSETS
  }
}

export function stripHtml(html: string): string {
  if (!html)
    return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, '\'')
    .replace(/&#39;/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isAbsoluteUrl(url: string): boolean {
  return /^(?:https?:)?\/\//.test(url)
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

export function toHost(url: string): string {
  if (!url)
    return ''
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const parts = host.split('.').slice(-3)
  if (parts[0] === 'www')
    parts.shift()
  return parts.join('.')
}

export function validatePage(page: number, maxPage: number): number {
  if (!Number.isFinite(page))
    return 1
  return Math.min(Math.max(1, Math.round(page)), maxPage)
}

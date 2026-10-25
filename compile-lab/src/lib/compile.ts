export interface CompileResult {
  ok: true
  bundleUrl: string
  builtAt: number
}

export interface ExampleResult {
  code: string
  css: string
  project?: boolean
}

export interface SampleInfo {
  id: string
  name: string
  project?: boolean
  /** UI grouping: lab playground set, discovered dev entries, projects. */
  group?: string
}

export async function compileCode(code: string, css?: string, project?: string): Promise<CompileResult> {
  const body = project ? JSON.stringify({ project }) : JSON.stringify({ code, css })
  const res = await fetch('/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data
}

export async function fetchExample(id?: string): Promise<ExampleResult> {
  const res = await fetch(`/api/example${id ? `?id=${id}` : ''}`)
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return { code: data.code, css: data.css ?? '', project: data.project ?? false }
}

export async function fetchSamples(): Promise<SampleInfo[]> {
  const res = await fetch('/api/example')
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data.samples
}

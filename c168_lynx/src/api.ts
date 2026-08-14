function apiBase() {
  const fromProps = String(lynx.__globalProps.apiBase || '').trim()
  if (fromProps) return fromProps.replace(/\/$/, '')
  return ''
}

export function buildApiUrl(pathAndQuery: string) {
  const path = pathAndQuery.replace(/^\//, '')
  const base = apiBase()
  if (base) return `${base}/${path}`
  return `/${path}`
}

export function encodeForm(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

async function parseJsonResponse(res: Response) {
  const raw = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`HTTP ${res.status}`)
  }
  return { res, data, raw }
}

export function withQuery(path: string, params: Record<string, string>) {
  const qs = Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  if (!qs) return path
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`
}

export async function getJson(path: string, init?: { signal?: AbortSignal }) {
  const res = await fetch(buildApiUrl(path), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    signal: init?.signal,
  })
  return parseJsonResponse(res)
}

export async function postForm(path: string, fields: Record<string, string>) {
  const res = await fetch(buildApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeForm(fields),
    credentials: 'include',
    cache: 'no-store',
  })
  return parseJsonResponse(res)
}

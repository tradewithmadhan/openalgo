import type { Instrument } from './InstrumentContext'

function qs(params: Record<string, string | number | undefined>, instrument?: Instrument): string {
  const p = new URLSearchParams()
  if (instrument) p.set('instrument', instrument)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  return p.toString()
}

export function madhanUrl(path: string, params?: Record<string, string | number | undefined>, instrument?: Instrument): string {
  const q = qs(params ?? {}, instrument)
  return `/madhan${path}${q ? '?' + q : ''}`
}

export async function madhanFetch(path: string, params?: Record<string, string | number | undefined>, instrument?: Instrument): Promise<Response> {
  return fetch(madhanUrl(path, params, instrument))
}

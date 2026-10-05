import type { AuditEntry } from './types'

// 越权/违规尝试留痕：独立持久化，刷新不丢；只追加、不提供清除入口，保证可倒查。
const AUDIT_KEY = 'drainage-pump:screen-audit:v1'

function readAudit(): AuditEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(AUDIT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as AuditEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let cache: AuditEntry[] | null = null

function all(): AuditEntry[] {
  if (cache === null) {
    cache = readAudit()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(all()))
  }
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export type DeniedInput = {
  operator: string
  station: string
  action: string
  target: string
  reason: string
}

// 记一条被挡下的尝试，新的排最前。
export function recordDenied(entry: DeniedInput): AuditEntry {
  const rows = all()
  const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const saved: AuditEntry = { id, time: nowText(), ...entry }
  rows.unshift(saved)
  persist()
  return saved
}

export function listAudit(): AuditEntry[] {
  return all()
}

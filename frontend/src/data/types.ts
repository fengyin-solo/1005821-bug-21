/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 格栅清污状态：已完工为终态，整条记录随后锁定，任何站都不能再改。
export type ScreenStatus = '待清污' | '清污中' | '已完工' | '需复清'

export const SCREEN_FIELDS = [
  '污物量',
  '清污方式',
] as const
export type ScreenEditableField = (typeof SCREEN_FIELDS)[number]

// 越权/违规尝试的留痕：谁、什么时候、想改哪条、越在哪，都能倒查。
export type AuditEntry = {
  id: number
  time: string
  operator: string
  station: string
  action: string
  target: string
  reason: string
}

// 所有提交/改动都带操作人上下文，归属校验、留痕都靠它。
export type Actor = {
  operator: string
  station: string
}


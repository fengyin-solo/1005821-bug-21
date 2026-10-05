import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import { recordDenied } from '@/data/audit-store'
import type { Actor, ActionResult, EntryRow, ScreenEditableField, ScreenStatus } from '@/data/types'

// 格栅清污：在通用数据层之外，为这个模块单独卡死泵站归属、完工锁定与编号唯一。
const MODULE_KEY = 'screen'
const DREDGE_KEY = 'dredge'

export const GRID_TYPES = ['粗格栅', '细格栅', '粉碎格栅']
export const CLEAN_METHODS = ['人工清捞', '机械清污', '高压冲洗']

// 待清污清单包含的未完工状态；已完工不进清单，避免完工后还重复挂着。
const PENDING_STATUSES: ScreenStatus[] = ['待清污', '清污中', '需复清']

// 允许的状态流转；已完工不在任何键上，终态后整条锁死。
const TRANSITIONS: Record<string, Partial<Record<ScreenStatus, ScreenStatus>>> = {
  提交清污: { 待清污: '清污中', 需复清: '清污中' },
  确认完工: { 待清污: '已完工', 清污中: '已完工', 需复清: '已完工' },
  要求复清: { 清污中: '需复清' },
}

export type ScreenDraft = {
  清污编号: string
  格栅类型: string
  污物量: string
  清污方式: string
  清污人: string
  清污班组: string
  清污日期: string
}

export function padCode(id: number): string {
  return `DRED-F${String(id).padStart(4, '0')}`
}

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function describe(row: EntryRow): string {
  return `清污记录 ${String(row['清污编号'])}（${String(row['所属泵站'])}·${String(row['格栅类型'])}）`
}

function findScreen(id: number): EntryRow | undefined {
  return listRows(MODULE_KEY).find((row) => Number(row.id) === id)
}

// 被挡下的尝试统一落痕：谁、什么时候、想改哪条、越在哪。
function deny(actor: Actor, action: string, row: EntryRow | undefined, reason: string): ActionResult {
  recordDenied({
    operator: actor.operator,
    station: actor.station,
    action,
    target: row ? describe(row) : action,
    reason,
  })
  return { ok: false, message: reason }
}

// 归属校验：记录只归登记的泵站，别的泵站一律退回并点明越在哪。
function assertOwner(row: EntryRow, actor: Actor, actionLabel: string): ActionResult | null {
  const owner = String(row['所属泵站'])
  if (owner !== actor.station) {
    return deny(
      actor,
      actionLabel,
      row,
      `跨站越权被退回：${describe(row)}归${owner}，当前为${actor.station}（${actor.operator}），无权${actionLabel}`,
    )
  }
  return null
}

// 完工锁定：终态后连归属站也不能再改。
function assertUnlocked(row: EntryRow, actor: Actor, actionLabel: string): ActionResult | null {
  if (String(row.status) === '已完工') {
    return deny(
      actor,
      actionLabel,
      row,
      `已完工记录整条锁定：${describe(row)}已完工，归属站${String(row['所属泵站'])}也不能再改`,
    )
  }
  return null
}

export function listScreen(filters: Record<string, string> = {}): EntryRow[] {
  return filterRows(listRows(MODULE_KEY), filters)
}

// 该泵站的待清污清单：只放本站、且未完工的；已完工立即从清单移除，不重复显示。
export function stationPendingQueue(station: string): EntryRow[] {
  return listRows(MODULE_KEY).filter(
    (row) =>
      String(row['所属泵站']) === station &&
      PENDING_STATUSES.includes(String(row.status) as ScreenStatus),
  )
}

export type ScreenStat = { label: string; value: number }

// 当前状态下可继续走的动作；已完工没有任何可执行动作（终态锁定）。
export function availableActionsHelper(status: string): string[] {
  return Object.entries(TRANSITIONS).reduce<string[]>((acc, [action, map]) => {
    if ((map as Partial<Record<ScreenStatus, ScreenStatus>>)[status as ScreenStatus]) {
      acc.push(action)
    }
    return acc
  }, [])
}

export function stationStats(station: string): ScreenStat[] {
  const own = listRows(MODULE_KEY).filter((row) => String(row['所属泵站']) === station)
  const count = (status: ScreenStatus) => own.filter((row) => String(row.status) === status).length
  return [
    { label: '待清污格栅', value: count('待清污') },
    { label: '清污中格栅', value: count('清污中') },
    { label: '需复清格栅', value: count('需复清') },
    { label: '已完工（锁定）', value: count('已完工') },
  ]
}

function hasSameCode(station: string, gridType: string, code: string, exceptId?: number): boolean {
  return listRows(MODULE_KEY).some(
    (row) =>
      Number(row.id) !== exceptId &&
      String(row['所属泵站']) === station &&
      String(row['格栅类型']) === gridType &&
      String(row['清污编号']) === code,
  )
}

// 登记：归属强制写成当前泵站；同一泵站+同一格栅类型下编号不得重号。
export function createScreen(draft: ScreenDraft, actor: Actor): ActionResult {
  const code = draft.清污编号.trim()
  const gridType = draft.格栅类型.trim()
  const amount = draft.污物量.trim()
  const method = draft.清污方式.trim()
  if (!code || !gridType || !amount || !method) {
    return { ok: false, message: '清污编号、格栅类型、污物量、清污方式为必填项' }
  }
  if (hasSameCode(actor.station, gridType, code)) {
    const reason = `编号重号被退回：${actor.station}的${gridType}已存在清污编号「${code}」，同一泵站同一格栅类型下不得重号`
    return deny(actor, `登记清污记录 ${code}（${actor.station}·${gridType}）`, undefined, reason)
  }
  const rows = listRows(MODULE_KEY)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: '待清污',
    pending: true,
    abnormal: false,
    清污编号: code,
    所属泵站: actor.station,
    格栅类型: gridType,
    污物量: amount,
    清污方式: method,
    清污人: draft.清污人.trim() || actor.operator,
    清污班组: draft.清污班组.trim() || `${actor.station}清污班`,
    清污日期: draft.清污日期.trim() || today(),
    清污状态: '待清污',
  }
  saveRows(MODULE_KEY, [...rows, row])
  return { ok: true, message: `已登记${describe(row)}，归属${actor.station}，进入本站待清污清单` }
}

// 改污物量/清污方式：仅归属站清污人可改，已完工整条锁定。
export function updateScreenFields(
  id: number,
  patch: Partial<Record<ScreenEditableField, string>>,
  actor: Actor,
): ActionResult {
  const row = findScreen(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的清污记录` }
  }
  const fields = Object.keys(patch) as ScreenEditableField[]
  const labels = fields.map((field) => `修改${field}`).join('、') || '修改清污记录'
  const ownerError = assertOwner(row, actor, labels)
  if (ownerError) {
    return ownerError
  }
  const lockedError = assertUnlocked(row, actor, labels)
  if (lockedError) {
    return lockedError
  }
  const nextPatch: Record<string, string> = {}
  for (const field of fields) {
    const value = (patch[field] ?? '').trim()
    if (!value) {
      return { ok: false, message: `${field}不能为空` }
    }
    nextPatch[field] = value
  }
  const rows = listRows(MODULE_KEY)
  const next = rows.map((item) => (Number(item.id) === id ? { ...item, ...nextPatch } : item))
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `${actor.station}已更新${describe(row)}的${fields.join('、')}` }
}

// 清淤侧幂等联动：同一条清污完工，只生成一条待复核活，重复提交不重复建。
function ensureDredgeFollowUp(screen: EntryRow): void {
  const sourceId = Number(screen.id)
  const dredge = listRows(DREDGE_KEY)
  const exists =
    dredge.some((row) => Number(row['sourceScreenId']) === sourceId) ||
    dredge.some((row) => String(row['清淤编号']) === padCode(sourceId))
  if (exists) {
    return
  }
  const station = String(screen['所属泵站'])
  const gridType = String(screen['格栅类型'])
  const id = dredge.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const followUp: EntryRow = {
    id,
    status: '待复核',
    pending: true,
    abnormal: false,
    清淤编号: padCode(sourceId),
    清淤管段: `${station}${gridType}栅后渠`,
    淤积厚度: '待复核',
    清淤方式: String(screen['清污方式']),
    清淤班组: String(screen['清污班组'] ?? `${station}清污班`),
    清淤日期: today(),
    清淤量: String(screen['污物量']),
    清淤状态: '待复核',
    来源: '格栅清污完工联动',
    来源清污编号: String(screen['清污编号']),
    来源泵站: station,
    sourceScreenId: sourceId,
  }
  saveRows(DREDGE_KEY, [...dredge, followUp])
}

// 状态流转：跨站退回、完工锁定、非法流转留痕；完工幂等生成清淤待复核。
export function runScreenAction(id: number, action: string, actor: Actor): ActionResult {
  const row = findScreen(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的清污记录` }
  }
  const ownerError = assertOwner(row, actor, action)
  if (ownerError) {
    return ownerError
  }
  const lockedError = assertUnlocked(row, actor, action)
  if (lockedError) {
    return lockedError
  }
  const current = String(row.status) as ScreenStatus
  const target = TRANSITIONS[action]?.[current]
  if (!target) {
    return deny(
      actor,
      action,
      row,
      `操作被退回：${describe(row)}当前为「${current}」，不能执行「${action}」`,
    )
  }
  const rows = listRows(MODULE_KEY)
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== '已完工',
    abnormal: false,
    清污状态: target,
  }
  saveRows(
    MODULE_KEY,
    rows.map((item) => (Number(item.id) === id ? updated : item)),
  )
  if (target === '已完工') {
    ensureDredgeFollowUp(updated)
  }
  const linked = target === '已完工' ? '，清淤侧已生成一条待复核任务（重复完工只算一条）' : ''
  return { ok: true, message: `${describe(row)}已${action}，当前状态「${target}」${linked}` }
}

import { MODULE_BY_KEY } from '@/data/modules'
import {
  BUCKET_KEYS,
  listRows,
  readBucket,
  saveRows,
  writeBucket,
} from '@/data/local-store'
import { STATION_CLEANERS } from '@/stores/session'
import type {
  ActionResult,
  Actor,
  AuditEntry,
  DredgeFollowUp,
  EntryRow,
  ScreenCreateInput,
  ScreenFieldPatch,
  ScreenWorkItem,
} from '@/data/types'

// 格栅清污模块的业务收口：归属、锁、重号、留痕、跨模块联动只在这一个文件里判断，
// 页面组件与通用 local-service 都不允许绕开它直接写 screen 数据。

const SCREEN_KEY = 'screen'
const LOCKED_STATUS = '已完工'

function screenMeta() {
  const meta = MODULE_BY_KEY.get(SCREEN_KEY)
  if (!meta) {
    throw new Error('格栅清污模块未登记')
  }
  return meta
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function isPending(status: string): boolean {
  // 只有「已完工」是终态；「需复清」仍是当班要处理的活。
  return status !== LOCKED_STATUS
}

// ---------------------------------------------------------------------------
// 审计留痕桶：被挡下的尝试（越权、锁、重号）逐条落桶，谁、何时、想改哪条都能倒查。
// ---------------------------------------------------------------------------

function listAudit(): AuditEntry[] {
  return readBucket<AuditEntry[]>(BUCKET_KEYS.screenAudit, [])
}

function recordAudit(
  actor: Actor,
  target: string,
  action: string,
  reason: string,
): void {
  const entries = listAudit()
  const nextId = entries.reduce((max, item) => Math.max(max, item.id), 0) + 1
  entries.push({
    id: nextId,
    time: nowText(),
    operator: actor.operator,
    station: actor.station,
    target,
    action,
    reason,
  })
  writeBucket(BUCKET_KEYS.screenAudit, entries)
}

export function listScreenAudit(stationFilter = ''): AuditEntry[] {
  const entries = listAudit().slice().reverse()
  if (stationFilter.trim() === '') {
    return entries
  }
  return entries.filter((item) => item.station === stationFilter.trim())
}

// ---------------------------------------------------------------------------
// 泵站待清污清单桶：格栅清污的结论按归属泵站落到这里，业务键幂等，同一次清污
// 重复提交只算一条。首次打开按既有记录生成一次快照，历史结论此后不再被回改。
// ---------------------------------------------------------------------------

function workItemKey(row: EntryRow): string {
  return `${String(row.所属泵站)}::${String(row.格栅类型)}::${String(row.清污编号)}`
}

function toWorkItem(row: EntryRow, historical: boolean): ScreenWorkItem {
  return {
    key: workItemKey(row),
    清污编号: String(row.清污编号),
    所属泵站: String(row.所属泵站),
    格栅类型: String(row.格栅类型),
    结论: String(row.status),
    污物量: String(row.污物量 ?? ''),
    清污方式: String(row.清污方式 ?? ''),
    清污人: String(row.清污人 ?? ''),
    更新时间: nowText(),
    历史结论: historical,
  }
}

function readWorklist(): Record<string, ScreenWorkItem> {
  return readBucket<Record<string, ScreenWorkItem>>(
    BUCKET_KEYS.screenWorklist,
    {},
  )
}

function migrateWorklistOnce(): void {
  const migrated = readBucket<boolean>(BUCKET_KEYS.screenWorklistMigrated, false)
  if (migrated) {
    return
  }
  // 既有清污记录保持当时的结论：只按当前数据生成一次快照并打迁移标记，
  // 之后清单只能由真实的登记/流转动作推动，不再随读取被重算。
  const snapshot: Record<string, ScreenWorkItem> = {}
  for (const row of listRows(SCREEN_KEY)) {
    const item = toWorkItem(row, true)
    snapshot[item.key] = item
  }
  writeBucket(BUCKET_KEYS.screenWorklist, snapshot)
  writeBucket(BUCKET_KEYS.screenWorklistMigrated, true)
}

function upsertWorkItem(row: EntryRow): void {
  const bucket = readWorklist()
  const key = workItemKey(row)
  // 业务键已存在就是同一次清污，只刷新结论，绝不插第二条。
  bucket[key] = {
    ...(bucket[key] ?? { 历史结论: false }),
    ...toWorkItem(row, Boolean(bucket[key]?.历史结论)),
  }
  writeBucket(BUCKET_KEYS.screenWorklist, bucket)
}

export function stationWorklist(station: string): ScreenWorkItem[] {
  migrateWorklistOnce()
  return Object.values(readWorklist())
    .filter((item) => item.所属泵站 === station)
    .sort((a, b) => a.清污编号.localeCompare(b.清污编号, 'zh-CN'))
}

// ---------------------------------------------------------------------------
// 清淤侧待复核联动：格栅清污确认完工时，按清污记录幂等生成一条「待复核」活，
// 交给清淤那边（同编号 sourceEntryId 永远只对应一条）。
// ---------------------------------------------------------------------------

function readFollowups(): DredgeFollowUp[] {
  return readBucket<DredgeFollowUp[]>(BUCKET_KEYS.dredgeFollowups, [])
}

function writeFollowups(items: DredgeFollowUp[]): void {
  writeBucket(BUCKET_KEYS.dredgeFollowups, items)
}

export function listDredgeFollowups(stationFilter = ''): DredgeFollowUp[] {
  const items = readFollowups()
  const filtered =
    stationFilter.trim() === ''
      ? items
      : items.filter((item) => item.所属泵站 === stationFilter.trim())
  return filtered.slice().sort((a, b) => b.id - a.id)
}

function createFollowUp(row: EntryRow): void {
  const items = readFollowups()
  const existing = items.find((item) => item.sourceEntryId === Number(row.id))
  if (existing) {
    // 同一次清污重复完工提交不重复派活。
    return
  }
  const nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1
  items.push({
    id: nextId,
    sourceEntryId: Number(row.id),
    复核编号: `FUSC-${String(nextId).padStart(4, '0')}`,
    清污编号: String(row.清污编号),
    所属泵站: String(row.所属泵站),
    格栅类型: String(row.格栅类型),
    清污班组: String(row.清污人 ?? '') || `${String(row.所属泵站)}清污班`,
    污物量: String(row.污物量 ?? ''),
    完工时间: nowText(),
    状态: '待复核',
    办结时间: '',
  })
  writeFollowups(items)
}

export function resolveDredgeFollowUp(id: number, actor: Actor): ActionResult {
  const items = readFollowups()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条待复核清淤活' }
  }
  const target = items[index]
  if (target.所属泵站 !== actor.station) {
    recordAudit(
      actor,
      `清淤待复核 ${target.复核编号}（源清污 ${target.清污编号}，归属${target.所属泵站}）`,
      '复核办结',
      `跨站作业被挡：操作人归属${actor.station}，该活归${target.所属泵站}，外站不得办结`,
    )
    return {
      ok: false,
      message: `跨站作业被挡：复核活 ${target.复核编号} 归 ${target.所属泵站}，${actor.station} 无权办结`,
    }
  }
  if (target.状态 === '已复核') {
    return { ok: false, message: '该复核活已办结，不用重复操作' }
  }
  items[index] = { ...target, 状态: '已复核', 办结时间: nowText() }
  writeFollowups(items)
  return { ok: true, message: `复核活 ${target.复核编号} 已办结` }
}

// ---------------------------------------------------------------------------
// 归属与锁：所有写操作的统一闸口。
// ---------------------------------------------------------------------------

function requireStationCleaner(
  row: EntryRow,
  actor: Actor,
  action: string,
): ActionResult | null {
  if (row.所属泵站 !== actor.station) {
    const message =
      `跨站改动被挡：清污记录 ${String(row.清污编号)} 归 ${String(row.所属泵站)}，` +
      `操作人 ${actor.operator} 属 ${actor.station}，越在「非归属泵站改本站记录」，${action}一律不允许`
    recordAudit(
      actor,
      `清污记录 ${String(row.清污编号)}（归属${String(row.所属泵站)}）`,
      action,
      `跨站改动：操作人属${actor.station}，记录归${String(row.所属泵站)}`,
    )
    return { ok: false, message }
  }
  if (!(STATION_CLEANERS[actor.station] ?? []).includes(actor.operator)) {
    recordAudit(
      actor,
      `清污记录 ${String(row.清污编号)}（归属${String(row.所属泵站)}）`,
      action,
      `操作人${actor.operator}不在${actor.station}清污人名册`,
    )
    return {
      ok: false,
      message: `操作被挡：${actor.operator} 不是 ${actor.station} 在册清污人，不能动本站清污记录`,
    }
  }
  return null
}

function findRow(id: number): { rows: EntryRow[]; index: number; row: EntryRow } | null {
  const rows = listRows(SCREEN_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return null
  }
  return { rows, index, row: rows[index] }
}

function persistRow(
  rows: EntryRow[],
  index: number,
  patch: Record<string, string | number | boolean>,
): EntryRow {
  const updated: EntryRow = { ...rows[index], ...patch }
  const next = [...rows]
  next[index] = updated
  saveRows(SCREEN_KEY, next)
  return updated
}

// ---------------------------------------------------------------------------
// 对外动作：状态流转 / 改污物量与清污方式 / 登记
// ---------------------------------------------------------------------------

export function runScreenAction(
  id: number,
  action: string,
  actor: Actor,
): ActionResult {
  const meta = screenMeta()
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const { rows, index, row } = found

  // 1) 归属先卡：外站的人对本站记录做任何动作都挡回，并写明越在哪、留痕。
  const denied = requireStationCleaner(row, actor, action)
  if (denied) {
    return denied
  }

  // 2) 已完工整条锁住，连本站也不能再改；重复完工提交幂等静默，不重复显示。
  if (String(row.status) === LOCKED_STATUS) {
    if (target === LOCKED_STATUS) {
      return { ok: false, message: `清污记录 ${String(row.清污编号)} 已完工并锁定，结论只算一条` }
    }
    const message =
      `清污记录 ${String(row.清污编号)} 已完工，整条记录已锁定，` +
      `本站清污人也不能再执行「${action}」`
    recordAudit(
      actor,
      `清污记录 ${String(row.清污编号)}（归属${String(row.所属泵站)}）`,
      action,
      '已完工记录整条锁定，任何改动一律挡回',
    )
    return { ok: false, message }
  }

  // 3) 已经是目标状态就幂等返回（例如「需复清」后再次要求复清），不重复落结论。
  if (String(row.status) === target) {
    return { ok: false, message: `清污记录已经是「${target}」，不用重复操作` }
  }

  const updated = persistRow(rows, index, {
    status: target,
    pending: isPending(target),
    abnormal: action.startsWith('要求'),
  })

  // 4) 结论落到归属泵站的待清污清单（业务键幂等）。
  upsertWorkItem(updated)

  // 5) 完工后给该班组的清淤侧派一条待复核活（同一清污只派一条）。
  if (target === LOCKED_STATUS) {
    createFollowUp(updated)
  }

  return { ok: true, message: `清污记录 ${String(updated.清污编号)} 已${action}，当前状态「${target}」` }
}

export function updateScreenFields(
  id: number,
  patch: ScreenFieldPatch,
  actor: Actor,
): ActionResult {
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的清污记录` }
  }
  const { rows, index, row } = found

  // 污物量与清污方式只有归属泵站的在册清污人能改。
  const denied = requireStationCleaner(row, actor, '修改污物量/清污方式')
  if (denied) {
    return denied
  }

  // 已完工记录整条锁住，连本站也不能再改。
  if (String(row.status) === LOCKED_STATUS) {
    recordAudit(
      actor,
      `清污记录 ${String(row.清污编号)}（归属${String(row.所属泵站)}）`,
      '修改污物量/清污方式',
      '已完工记录整条锁定，字段修改被挡回',
    )
    return {
      ok: false,
      message: `清污记录 ${String(row.清污编号)} 已完工锁定，污物量与清污方式不能再改`,
    }
  }

  const 污物量 = (patch.污物量 ?? '').trim()
  const 清污方式 = (patch.清污方式 ?? '').trim()
  if (!污物量 || !清污方式) {
    return { ok: false, message: '污物量与清污方式都要填写，不能改空' }
  }

  const updated = persistRow(rows, index, { 污物量, 清污方式 })
  upsertWorkItem(updated)
  return {
    ok: true,
    message: `清污记录 ${String(updated.清污编号)} 的污物量、清污方式已更新`,
  }
}

export function createScreenEntry(
  input: ScreenCreateInput,
  actor: Actor,
): ActionResult & { id?: number } {
  // 登记只能登记到操作人自己所在的泵站；替别的泵站提交一律挡回。
  if (input.所属泵站 !== actor.station) {
    const message =
      `跨站登记被挡：${actor.operator} 属 ${actor.station}，` +
      `不能替 ${input.所属泵站} 登记清污记录，越在「非归属泵站替他站登记」`
    recordAudit(
      actor,
      `新清污记录（拟登记到${input.所属泵站}，编号${input.清污编号}）`,
      '登记清污记录',
      `跨站登记：操作人属${actor.station}，拟登记到${input.所属泵站}`,
    )
    return { ok: false, message }
  }
  if (!(STATION_CLEANERS[actor.station] ?? []).includes(actor.operator)) {
    recordAudit(
      actor,
      `新清污记录（${input.所属泵站}，编号${input.清污编号}）`,
      '登记清污记录',
      `操作人${actor.operator}不在${actor.station}清污人名册`,
    )
    return { ok: false, message: `${actor.operator} 不是 ${actor.station} 在册清污人，不能登记` }
  }

  const 清污编号 = input.清污编号.trim()
  const 格栅类型 = input.格栅类型.trim()
  const 污物量 = input.污物量.trim()
  const 清污方式 = input.清污方式.trim()
  if (!清污编号 || !格栅类型 || !污物量 || !清污方式) {
    return { ok: false, message: '清污编号、格栅类型、污物量、清污方式都要填写' }
  }

  const rows = listRows(SCREEN_KEY)
  // 同一个格栅类型在同一泵站下的清污编号不能重号。
  const duplicated = rows.some(
    (item) =>
      String(item.所属泵站) === input.所属泵站 &&
      String(item.格栅类型) === 格栅类型 &&
      String(item.清污编号) === 清污编号,
  )
  if (duplicated) {
    const message =
      `登记被挡：${input.所属泵站} 的「${格栅类型}」下清污编号 ${清污编号} 已存在，同站同格栅类型不能重号`
    recordAudit(
      actor,
      `新清污记录（${input.所属泵站}，${格栅类型}，编号${清污编号}）`,
      '登记清污记录',
      `重号：${input.所属泵站}的${格栅类型}下${清污编号}已存在`,
    )
    return { ok: false, message }
  }

  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待清污',
    pending: true,
    abnormal: false,
    清污编号,
    所属泵站: input.所属泵站,
    格栅类型,
    污物量,
    清污方式,
    清污人: actor.operator,
    清污日期: input.清污日期 || new Date().toISOString().slice(0, 10),
  }
  saveRows(SCREEN_KEY, [...rows, row])
  upsertWorkItem(row)
  return { ok: true, message: `清污记录 ${清污编号} 已登记到 ${input.所属泵站}`, id: nextId }
}

// ---------------------------------------------------------------------------
// 查询：列表（默认只看本站）、详情、导出。列表与详情同读 status 这一个事实源，
// 不再存在「列表已完工、详情还待清污」两处对不上的情况。
// ---------------------------------------------------------------------------

export function listScreenEntries(
  actor: Actor,
  filters: Record<string, string> = {},
  scope: 'station' | 'all' = 'station',
): { items: EntryRow[]; total: number } {
  let rows = listRows(SCREEN_KEY)
  if (scope === 'station') {
    rows = rows.filter((row) => String(row.所属泵站) === actor.station)
  }
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched =
    pairs.length === 0
      ? rows
      : rows.filter((row) =>
          pairs.every(([field, value]) =>
            String(row[field] ?? '').includes(value.trim()),
          ),
        )
  return { items: matched, total: matched.length }
}

export function getScreenEntry(id: number): EntryRow | null {
  return listRows(SCREEN_KEY).find((row) => Number(row.id) === id) ?? null
}

export function screenStats(actor: Actor) {
  const rows = listRows(SCREEN_KEY).filter(
    (row) => String(row.所属泵站) === actor.station,
  )
  const monthPrefix = new Date().toISOString().slice(0, 7)
  return {
    待清污: rows.filter((row) => String(row.status) === '待清污').length,
    清污中: rows.filter((row) => String(row.status) === '清污中').length,
    需复清: rows.filter((row) => String(row.status) === '需复清').length,
    本月完工: rows.filter(
      (row) =>
        String(row.status) === LOCKED_STATUS &&
        String(row.清污日期 ?? '').startsWith(monthPrefix),
    ).length,
  }
}

export function exportScreenCsv(actor: Actor, scope: 'station' | 'all' = 'station'): {
  filename: string
  content: string
} {
  const meta = screenMeta()
  const { items } = listScreenEntries(actor, {}, scope)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of items) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  const suffix = scope === 'station' ? `-${actor.station}` : ''
  return {
    filename: `格栅清污清单${suffix}.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

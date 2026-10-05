// 格栅清污归属/锁/重号/留痕/联动的规则校验：用 localStorage shim 跑真实数据层。
// 运行：npx vite-node scripts/verify-screen-rules.ts
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
  clear() { this.map.clear() }
}
;(globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() }

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`) }
  else { failed += 1; console.error(`  ✗ ${name} ${detail}`) }
}

const hexi = { operator: '王水清', station: '河西立交泵站' }
const donghu = { operator: '张卫东', station: '东湖雨水泵站' }
const beiyuan = { operator: '孙立军', station: '北苑合流泵站' }

const {
  createScreenEntry,
  listScreenEntries,
  runScreenAction,
  updateScreenFields,
  getScreenEntry,
  listScreenAudit,
  stationWorklist,
  listDredgeFollowups,
  resolveDredgeFollowUp,
} = await import('@/api/screen-service')
const { resetRows } = await import('@/data/local-store')

resetRows('screen')
resetRows('dredge')
window.localStorage.clear()

console.log('1) 初始迁移：既有记录生成历史结论快照')
stationWorklist(hexi.station) // 触发迁移
{
  const items = stationWorklist(hexi.station)
  check('河西两站记录都进清单', items.length === 2, `实际 ${items.length}`)
  check('历史结论标记为 true', items.every((i) => i.历史结论))
}

console.log('2) 外站改动本站记录被挡、写明越界点、留痕')
{
  const target = listScreenEntries(hexi).items.find((r) => r.清污编号 === 'SCRE-20260926-02')!
  const res = runScreenAction(Number(target.id), '确认完工', donghu)
  check('跨站完工被挡回', !res.ok)
  check('提示写明归属与越界点', res.message.includes('跨站改动被挡') && res.message.includes('非归属泵站'))
  const audit = listScreenAudit()[0]
  check('留痕含谁/何时/哪条/原因', !!audit && audit.operator === '张卫东' && audit.station === '东湖雨水泵站'
    && audit.target.includes('SCRE-20260926-02') && audit.reason.includes('跨站改动'))
  // 数据未被动
  check('记录状态仍是清污中', getScreenEntry(Number(target.id))!.status === '清污中')
}

console.log('3) 污物量/清污方式：本站可改、外站被挡、完工后锁住')
{
  const target = listScreenEntries(hexi).items.find((r) => r.清污编号 === 'SCRE-20260925-01')!
  const cross = updateScreenFields(Number(target.id), { 污物量: '0.1m³' }, donghu)
  check('外站改污物量被挡', !cross.ok && cross.message.includes('跨站改动被挡'))
  const own = updateScreenFields(Number(target.id), { 污物量: '1.5m³', 清污方式: '机械清污' }, hexi)
  check('本站改污物量成功', own.ok && getScreenEntry(Number(target.id))!['污物量'] === '1.5m³')
}

console.log('4) 同站同格栅类型编号重号被挡；不同站或不同格栅可同号')
{
  const dup = createScreenEntry({
    清污编号: 'SCRE-20260925-01', 所属泵站: '河西立交泵站', 格栅类型: '粗格栅',
    污物量: '1m³', 清污方式: '人工清捞', 清污人: '王水清', 清污日期: '2026-10-05',
  }, hexi)
  check('同站同格栅重号被挡', !dup.ok && dup.message.includes('不能重号'))
  const otherType = createScreenEntry({
    清污编号: 'SCRE-20260925-01', 所属泵站: '河西立交泵站', 格栅类型: '细格栅',
    污物量: '1m³', 清污方式: '人工清捞', 清污人: '王水清', 清污日期: '2026-10-05',
  }, hexi)
  check('同站不同格栅同号允许', otherType.ok)
  const otherStation = createScreenEntry({
    清污编号: 'SCRE-20260927-01', 所属泵站: '北苑合流泵站', 格栅类型: '粗格栅',
    污物量: '1m³', 清污方式: '人工清捞', 清污人: '孙立军', 清污日期: '2026-10-05',
  }, beiyuan)
  check('不同站同格栅同号允许', otherStation.ok)
}

console.log('5) 跨站登记被挡')
{
  const res = createScreenEntry({
    清污编号: 'SCRE-X-01', 所属泵站: '东湖雨水泵站', 格栅类型: '粗格栅',
    污物量: '1m³', 清污方式: '人工清捞', 清污人: '王水清', 清污日期: '2026-10-05',
  }, hexi)
  check('替他站登记被挡并点明越界', !res.ok && res.message.includes('跨站登记被挡') && res.message.includes('非归属泵站替他站登记'))
}

console.log('6) 完工：状态/pending 一致、联动清淤待复核、重复完工幂等、记录锁定')
{
  const target = listScreenEntries(hexi).items.find((r) => r.清污编号 === 'SCRE-20260925-01')!
  const first = runScreenAction(Number(target.id), '确认完工', hexi)
  check('本站完工成功', first.ok)
  const after = getScreenEntry(Number(target.id))!
  check('完工后 pending=false', after.pending === false && after.status === '已完工')
  check('列表与详情同读 status，结论一致', listScreenEntries(hexi).items.find((r) => r.id === target.id)!.status === after.status)
  const followups = listDredgeFollowups('河西立交泵站')
  check('清淤侧出现一条待复核活', followups.length === 1 && followups[0].状态 === '待复核' && followups[0].清污编号 === 'SCRE-20260925-01')
  const again = runScreenAction(Number(target.id), '确认完工', hexi)
  check('重复完工不重复派活/不重复显示', !again.ok && listDredgeFollowups('河西立交泵站').length === 1)
  const editLocked = updateScreenFields(Number(target.id), { 污物量: '0.01m³', 清污方式: '人工清捞' }, hexi)
  check('完工后本站也不能改', !editLocked.ok && editLocked.message.includes('已完工锁定'))
  const actionLocked = runScreenAction(Number(target.id), '要求复清', hexi)
  check('完工后其他动作也锁死并留痕', !actionLocked.ok && actionLocked.message.includes('已完工'))
  // 外站办结复核活被挡
  const fu = listDredgeFollowups('河西立交泵站')[0]
  const crossResolve = resolveDredgeFollowUp(fu.id, donghu)
  check('外站办结复核活被挡', !crossResolve.ok && crossResolve.message.includes('无权办结'))
  const ownResolve = resolveDredgeFollowUp(fu.id, hexi)
  check('本站办结复核活成功', ownResolve.ok && listDredgeFollowups('河西立交泵站')[0].状态 === '已复核')
}

console.log('7) 待清污清单：结论按归属泵站落地、业务键幂等')
{
  const hexiItems = stationWorklist('河西立交泵站')
  const moved = hexiItems.find((i) => i.清污编号 === 'SCRE-20260925-01')
  check('完工结论落回本站清单', !!moved && moved.结论 === '已完工')
  // 再触发一次重复完工，清单条数不增加
  runScreenAction(
    Number(listScreenEntries(hexi).items.find((r) => r.清污编号 === 'SCRE-20260926-02')!.id),
    '确认完工', hexi,
  )
  runScreenAction(
    Number(listScreenEntries(hexi).items.find((r) => r.清污编号 === 'SCRE-20260926-02')!.id),
    '确认完工', hexi,
  )
  const after = stationWorklist('河西立交泵站')
  check('同一次清污重复提交清单不重复', after.length === hexiItems.length)
  check('清单不串站：东湖人看不到河西清单', stationWorklist('东湖雨水泵站').every((i) => i.所属泵站 === '东湖雨水泵站'))
}

console.log('8) 历史结论不被回改')
{
  // 东湖历史完工记录（迁移前已存在）保持已完工快照，没有被任何重算改动
  const donghuHist = stationWorklist('东湖雨水泵站').find((i) => i.清污编号 === 'SCRE-20260927-01')
  check('东湖既有完工记录结论保留', !!donghuHist && donghuHist.结论 === '已完工' && donghuHist.历史结论)
}

console.log('9) 审计可倒查全部被挡尝试')
{
  const audits = listScreenAudit()
  const reasons = audits.map((a) => a.reason).join('|')
  check('留痕覆盖跨站/锁/重号/跨站登记',
    audits.length >= 5
    && reasons.includes('跨站改动')
    && reasons.includes('锁定')
    && reasons.includes('重号')
    && reasons.includes('跨站登记'),
    `共 ${audits.length} 条`)
  check('每条留痕都有时间戳', audits.every((a) => a.time.length > 0))
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exitCode = 1

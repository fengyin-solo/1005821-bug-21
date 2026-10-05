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

/** 当前操作身份：清污人 + 其所属泵站，归属校验就靠它。 */
export type Actor = {
  operator: string
  station: string
}

/** 被挡下的写操作留痕：谁、什么时候、想改哪条、因为什么被挡，都要能倒查。 */
export type AuditEntry = {
  id: number
  time: string
  operator: string
  station: string
  target: string
  action: string
  reason: string
}

/** 泵站待清污清单项：格栅清污结论落到归属泵站的清单，业务键幂等，不重复不串站。 */
export type ScreenWorkItem = {
  key: string
 清污编号: string
  所属泵站: string
  格栅类型: string
  结论: string
  污物量: string
  清污方式: string
  清污人: string
  更新时间: string
  历史结论: boolean
}

/** 格栅清污完工后联动到清淤侧的待复核活：同一清污记录只生成一条。 */
export type DredgeFollowUp = {
  id: number
  sourceEntryId: number
  复核编号: string
  清污编号: string
  所属泵站: string
  格栅类型: string
  清污班组: string
  污物量: string
  完工时间: string
  状态: string
  办结时间: string
}

export type ScreenCreateInput = {
  清污编号: string
  所属泵站: string
  格栅类型: string
  污物量: string
  清污方式: string
  清污人: string
  清污日期: string
}

export type ScreenFieldPatch = {
  污物量?: string
  清污方式?: string
}

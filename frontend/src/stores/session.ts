import { defineStore } from 'pinia'

// 各泵站在册清污人：只有登记泵站的清污人才能动本站的清污记录。
export const STATION_CLEANERS: Record<string, string[]> = {
  河西立交泵站: ['王水清', '李庆生'],
  东湖雨水泵站: ['张卫东', '陈志明'],
  南站雨水泵站: ['赵建国'],
  北苑合流泵站: ['孙立军', '周海峰'],
}

export const STATIONS = Object.keys(STATION_CLEANERS)

type SessionState = {
  operator: string
  station: string
  shiftLabel: string
  scope: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: '王水清',
    station: '河西立交泵站',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 当前清污人是否登记在当前值班泵站名下；归属闸口直接拒绝非在册人员。
    isStationCleaner: (state) =>
      (STATION_CLEANERS[state.station] ?? []).includes(state.operator),
    stationCleaners: () => (station: string) => STATION_CLEANERS[station] ?? [],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(station: string, operator: string) {
      this.station = station
      this.operator = operator
    },
    setStation(station: string) {
      this.station = station
      const cleaners = STATION_CLEANERS[station] ?? []
      // 换人泵站后若当前清污人不在新站名册，自动落到新站第一个清污人。
      if (!cleaners.includes(this.operator) && cleaners.length > 0) {
        this.operator = cleaners[0]
      }
    },
  },
})

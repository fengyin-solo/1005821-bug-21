import { defineStore } from 'pinia'

// 可登录（切换）的泵站：每条格栅清污记录只归登记站，操作人身份决定能否改动。
export const PUMP_STATIONS = ['城东泵站', '城西泵站', '滨江泵站'] as const
export type PumpStation = (typeof PUMP_STATIONS)[number]

// 每个站固定当班清污人，切换站点即换成另一站的人，跨站越权一目了然。
const STATION_OPERATORS: Record<PumpStation, string> = {
  城东泵站: '王强',
  城西泵站: '李敏',
  滨江泵站: '赵磊',
}

export const DEFAULT_STATION: PumpStation = '城东泵站'

export function operatorOf(station: PumpStation): string {
  return STATION_OPERATORS[station]
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: operatorOf(DEFAULT_STATION),
    station: DEFAULT_STATION as PumpStation,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchStation(station: PumpStation) {
      this.station = station
      this.operator = operatorOf(station)
    },
  },
})

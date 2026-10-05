<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">城市排水防涝泵站运行与内涝处置管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向排水泵站台账、泵组运行、排水管网与检查井养护、水位雨量监测、内涝点处置、闸门调度与抢险队出动的一体化城市排水防涝运行管理工作台。</span>
        <span class="head-user">
          <label class="identity-select">
            值班泵站
            <select :value="store.station" @change="onStationChange">
              <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
            </select>
          </label>
          <label class="identity-select">
            清污人
            <select :value="store.operator" @change="onOperatorChange">
              <option v-for="name in cleaners" :key="name" :value="name">{{ name }}</option>
            </select>
          </label>
          <span class="shift-text">{{ store.shiftLabel }}</span>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed} from 'vue'

import { STATIONS, STATION_CLEANERS, useSessionStore } from '@/stores/session'

const store = useSessionStore()

const stations = STATIONS
const cleaners = computed(() => STATION_CLEANERS[store.station] ?? [])

function onStationChange(event: Event) {
  store.setStation((event.target as HTMLSelectElement).value)
}

function onOperatorChange(event: Event) {
  store.setIdentity(store.station, (event.target as HTMLSelectElement).value)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "泵站台账", path: "/pumpstation" }, { label: "泵组运行", path: "/pumprun" }, { label: "排水管网", path: "/drainpipe" }, { label: "检查井维护", path: "/manhole" }, { label: "管网清淤", path: "/dredge" }, { label: "水位监测", path: "/waterlevel" }, { label: "雨量监测", path: "/rainfall" }, { label: "内涝点处置", path: "/waterlog" }, { label: "闸门调度", path: "/floodgate" }, { label: "泵组检修", path: "/pumpmaint" }, { label: "拍门检修", path: "/sluice" }, { label: "格栅清污", path: "/screen" }, { label: "排口巡查", path: "/outfallpatrol" }, { label: "防涝预警发布", path: "/floodwarn" }, { label: "抢险队调度", path: "/rescueteam" }, { label: "排水设备台账", path: "/drainequipment" }, { label: "管道内窥检测", path: "/cctvinspect" }, { label: "排水调度方案", path: "/dispatchplan" }]
</script>

<style scoped>
.head-user { display: flex; align-items: center; gap: 10px; }
.identity-select { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
.identity-select select { padding: 2px 6px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.shift-text { color: var(--muted); }
</style>

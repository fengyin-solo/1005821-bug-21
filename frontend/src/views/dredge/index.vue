<template>
  <section class="page" data-module="dredge">
    <header class="page-head">
      <div>
        <h2>管网清淤管理</h2>
        <p class="page-desc">维护清淤记录，围绕清淤编号、清淤管段、淤积厚度、清淤方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清淤记录</button>
        <button class="btn" type="button" @click="exportRows">导出管网清淤清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <h3 class="section-title">格栅清污完工 · 待本班组复核</h3>
    <p class="section-hint">格栅清污一旦确认完工，这里自动出现一条待复核活；同一次清污只派一条，外站不能办结本站的活。</p>
    <table class="data-table compact">
      <thead>
        <tr>
          <th>复核编号</th><th>来源清污编号</th><th>所属泵站</th><th>格栅类型</th>
          <th>责任班组</th><th>污物量</th><th>完工时间</th><th>状态</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in followups" :key="item.id" :class="{ 'foreign-row': item.所属泵站 !== store.station }">
          <td>{{ item.复核编号 }}</td>
          <td>{{ item.清污编号 }}</td>
          <td>{{ item.所属泵站 }}</td>
          <td>{{ item.格栅类型 }}</td>
          <td>{{ item.清污班组 }}</td>
          <td>{{ item.污物量 }}</td>
          <td>{{ item.完工时间 }}</td>
          <td>
            <span :class="item.状态 === '待复核' ? 'redo-text' : 'done-text'">{{ item.状态 }}</span>
            <span v-if="item.办结时间" class="muted-text">（{{ item.办结时间 }}）</span>
          </td>
          <td class="row-actions">
            <button v-if="item.状态 === '待复核' && item.所属泵站 === store.station" class="link" type="button" @click="resolveFollow(item.id)">
              复核办结
            </button>
            <span v-else-if="item.所属泵站 !== store.station" class="muted-text">外站活，无权办结</span>
            <span v-else class="muted-text">已办结</span>
          </td>
        </tr>
        <tr v-if="!followups.length">
          <td colspan="9" class="empty-state">暂无格栅清污完工后的待复核活</td>
        </tr>
      </tbody>
    </table>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无管网清淤数据，可先登记清淤记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管网清淤记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  listDredgeFollowups,
  resolveDredgeFollowUp,
} from '@/api/screen-service'
import { useSessionStore } from '@/stores/session'
import type { DredgeFollowUp, EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('dredge')
const columns = ["清淤编号", "清淤管段", "淤积厚度", "清淤方式", "清淤班组", "清淤日期", "清淤量", "清淤状态"]
const actions = ["提交清淤", "确认完工", "要求返工"]
const statuses = ["待清淤", "清淤中", "已完工", "需返工"]
const stats = [{"label": "待清淤管段", "value": 0}, {"label": "清淤中管段", "value": 0}, {"label": "本月完工数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const followups = ref<DredgeFollowUp[]>([])
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '清淤记录登记入口尚未接入审批流'
}

function resolveFollow(id: number) {
  errorMessage.value = ''
  const result = resolveDredgeFollowUp(id, { operator: store.operator, station: store.station })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reloadFollowups()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reloadFollowups() {
  followups.value = listDredgeFollowups()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reloadFollowups()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管网清淤列表读取失败'
  }
}

onMounted(reload)

// 切换值班泵站后，待复核活的归属与可操作状态立即刷新。
watch(
  () => store.station,
  () => reloadFollowups(),
)
</script>

<style scoped>
.section-title { font-size: 15px; margin: 18px 0 4px; }
.section-hint { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.data-table.compact th, .data-table.compact td { padding: 6px 8px; font-size: 12px; }
.foreign-row { background: #fafafa; color: var(--muted); }
.muted-text { color: var(--muted); font-size: 12px; }
.redo-text { color: #b42318; font-weight: 600; }
.done-text { color: #067647; font-weight: 600; }
</style>

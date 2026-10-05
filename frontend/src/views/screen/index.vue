<template>
  <section class="page" data-module="screen">
    <header class="page-head">
      <div>
        <h2>格栅清污管理</h2>
        <p class="page-desc">
          每条清污记录只归登记泵站，本站清污人才能改污物量与清污方式；已完工整条锁定。
          当前身份：<strong>{{ store.station }} · {{ store.operator }}</strong>
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清污记录</button>
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

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
        <em v-if="tab.key === 'queue'" class="tab-badge">{{ queueRows.length }}</em>
      </button>
    </div>

    <!-- 本站待清污清单：结论落清单，已完工立即移除，不重复显示 -->
    <div v-if="activeTab === 'queue'">
      <p class="tip-text">本清单只列 {{ store.station }} 未完工（待清污 / 清污中 / 需复清）的记录；已完工自动移出。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in queueRows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-tag" :class="statusClass(row)">{{ row.status }}</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(row)">详情</button>
              <button
                v-for="action in availableActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runRowAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!queueRows.length">
            <td :colspan="columns.length + 2" class="empty-state">{{ store.station }} 暂无待处理的清污记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 全部记录：含已完工与别的站，越站/已完工只能看不能动 -->
    <div v-if="activeTab === 'all'">
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
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ locked: isLocked(row), foreign: !isOwner(row) }">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-tag" :class="statusClass(row)">{{ row.status }}</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(row)">详情</button>
              <template v-if="isLocked(row)">
                <span class="lock-text">已完工锁定</span>
              </template>
              <template v-else-if="!isOwner(row)">
                <span class="lock-text">非本站·只读</span>
              </template>
              <button
                v-for="action in availableActions(row)"
                :key="action"
                class="link danger"
                type="button"
                @click="runRowAction(action, row)"
              >
                {{ action }}（将被退回）
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无格栅清污数据，可先登记清污记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 越权留痕：谁、什么时候、想改哪条、越在哪 -->
    <div v-if="activeTab === 'audit'">
      <p class="tip-text">以下是被归属/锁定规则挡下的全部尝试，只增不清，供倒查。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>所属泵站</th>
            <th>尝试动作</th>
            <th>目标记录</th>
            <th>越在哪 / 退回原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in auditRows" :key="entry.id">
            <td>{{ entry.time }}</td>
            <td>{{ entry.operator }}</td>
            <td>{{ entry.station }}</td>
            <td>{{ entry.action }}</td>
            <td>{{ entry.target }}</td>
            <td class="reason-cell">{{ entry.reason }}</td>
          </tr>
          <tr v-if="!auditRows.length">
            <td colspan="6" class="empty-state">暂无被挡下的尝试记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>本站待清污 {{ queueRows.length }} 条 · 清单内共 {{ rows.length }} 条</span>
      <span v-if="notice" class="notice-text" :class="{ ok: noticeOk }">{{ notice }}</span>
    </footer>

    <!-- 登记弹窗：归属强制为当前站 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记清污记录（归属：{{ store.station }}）</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>清污编号 *</span>
            <input v-model="draft.清污编号" placeholder="如 SCRE-0006" />
          </label>
          <label class="form-item">
            <span>格栅类型 *</span>
            <select v-model="draft.格栅类型">
              <option v-for="item in gridTypes" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>污物量 *</span>
            <input v-model="draft.污物量" placeholder="如 15kg" />
          </label>
          <label class="form-item">
            <span>清污方式 *</span>
            <select v-model="draft.清污方式">
              <option v-for="item in methods" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>清污人</span>
            <input v-model="draft.清污人" :placeholder="store.operator" />
          </label>
          <label class="form-item">
            <span>清污班组</span>
            <input v-model="draft.清污班组" :placeholder="`${store.station}清污班`" />
          </label>
          <label class="form-item">
            <span>清污日期</span>
            <input v-model="draft.清污日期" type="date" />
          </label>
        </div>
        <p class="modal-hint">编号在「{{ store.station }} + 所选格栅类型」下不能与已有记录重号。</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗：列表与详情读同一份数据，状态不会再对不上 -->
    <div v-if="detailRow" class="modal-mask" @click.self="detailRow = null">
      <div class="modal">
        <h3>清污详情 · {{ detailRow['清污编号'] }}</h3>
        <dl class="detail-grid">
          <div><dt>所属泵站（归属）</dt><dd>{{ detailRow['所属泵站'] }}</dd></div>
          <div><dt>格栅类型</dt><dd>{{ detailRow['格栅类型'] }}</dd></div>
          <div><dt>当前状态</dt><dd>
            <span class="status-tag" :class="statusClass(detailRow)">{{ detailRow.status }}</span>
          </dd></div>
          <div><dt>清污日期</dt><dd>{{ detailRow['清污日期'] }}</dd></div>
          <div><dt>清污人 / 班组</dt><dd>{{ detailRow['清污人'] }} · {{ detailRow['清污班组'] }}</dd></div>
        </dl>

        <template v-if="canEditDetail">
          <div class="form-grid edit-grid">
            <label class="form-item">
              <span>污物量（仅本站清污人可改）</span>
              <input v-model="editPatch.污物量" />
            </label>
            <label class="form-item">
              <span>清污方式（仅本站清污人可改）</span>
              <select v-model="editPatch.清污方式">
                <option v-for="item in methods" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
          </div>
          <div class="modal-actions">
            <button class="btn primary" type="button" @click="submitFields">保存污物量 / 清污方式</button>
          </div>
        </template>
        <p v-else class="modal-hint warn">
          {{ detailLockReason }}
        </p>

        <div v-if="!isLocked(detailRow) && isOwner(detailRow)" class="detail-actions">
          <button
            v-for="action in availableActions(detailRow)"
            :key="action"
            class="btn"
            type="button"
            @click="runRowAction(action, detailRow)"
          >
            {{ action }}
          </button>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="detailRow = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { listAudit } from '@/data/audit-store'
import {
  CLEAN_METHODS,
  GRID_TYPES,
  availableActionsHelper,
  createScreen,
  listScreen,
  runScreenAction,
  stationPendingQueue,
  stationStats,
  updateScreenFields,
  type ScreenDraft,
} from '@/api/screen-service'
import type { AuditEntry, EntryRow, ScreenEditableField } from '@/data/types'

const store = useSessionStore()

const columns = ['清污编号', '所属泵站', '格栅类型', '污物量', '清污方式', '清污人', '清污班组', '清污日期']
const filterFields = ['清污编号', '所属泵站', '格栅类型']
const gridTypes = GRID_TYPES
const methods = CLEAN_METHODS

const tabs = [
  { key: 'queue', label: '本站待清污清单' },
  { key: 'all', label: '全部清污记录' },
  { key: 'audit', label: '越权留痕' },
] as const
type TabKey = (typeof tabs)[number]['key']

const activeTab = ref<TabKey>('queue')
const rows = ref<EntryRow[]>([])
const auditRows = ref<AuditEntry[]>([])
const notice = ref('')
const noticeOk = ref(false)
const filters = ref<Record<string, string>>({})

const queueRows = computed(() => stationPendingQueue(store.station))
const stats = computed(() => stationStats(store.station))
const statusSummary = computed(() =>
  ['待清污', '清污中', '需复清', '已完工'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const createOpen = ref(false)
const draft = reactive<ScreenDraft>({
  清污编号: '',
  格栅类型: GRID_TYPES[0],
  污物量: '',
  清污方式: CLEAN_METHODS[0],
  清污人: '',
  清污班组: '',
  清污日期: '',
})

const detailRow = ref<EntryRow | null>(null)
const editPatch = reactive<Record<ScreenEditableField, string>>({ 污物量: '', 清污方式: '' })

function actor() {
  return { operator: store.operator, station: store.station }
}

function isOwner(row: EntryRow): boolean {
  return String(row['所属泵站']) === store.station
}

function isLocked(row: EntryRow): boolean {
  return String(row.status) === '已完工'
}

function availableActions(row: EntryRow): string[] {
  return availableActionsHelper(String(row.status))
}

function statusClass(row: EntryRow): string {
  return {
    待清污: 'st-pending',
    清污中: 'st-doing',
    已完工: 'st-done',
    需复清: 'st-recheck',
  }[String(row.status)] ?? ''
}

const canEditDetail = computed(() => detailRow.value !== null && isOwner(detailRow.value) && !isLocked(detailRow.value))
const detailLockReason = computed(() => {
  if (!detailRow.value) {
    return ''
  }
  if (isLocked(detailRow.value)) {
    return '该记录已完工，整条锁定，归属站也不能再改污物量与清污方式。'
  }
  if (!isOwner(detailRow.value)) {
    return `跨站只读：该记录归${String(detailRow.value['所属泵站'])}，${store.station}不能修改其污物量与清污方式。`
  }
  return ''
})

function flash(message: string, ok: boolean) {
  notice.value = message
  noticeOk.value = ok
}

function switchTab(key: TabKey) {
  activeTab.value = key
  if (key === 'audit') {
    auditRows.value = listAudit()
  }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  rows.value = listScreen(filters.value)
  if (activeTab.value === 'audit') {
    auditRows.value = listAudit()
  }
}

function openCreate() {
  Object.assign(draft, {
    清污编号: '',
    格栅类型: GRID_TYPES[0],
    污物量: '',
    清污方式: CLEAN_METHODS[0],
    清污人: '',
    清污班组: '',
    清污日期: '',
  })
  createOpen.value = true
}

function submitCreate() {
  const result = createScreen({ ...draft }, actor())
  flash(result.message, result.ok)
  if (result.ok) {
    createOpen.value = false
    activeTab.value = 'queue'
  }
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
  editPatch.污物量 = String(row['污物量'] ?? '')
  editPatch.清污方式 = String(row['清污方式'] ?? '')
}

function submitFields() {
  if (!detailRow.value) {
    return
  }
  const result = updateScreenFields(
    Number(detailRow.value.id),
    { 污物量: editPatch.污物量, 清污方式: editPatch.清污方式 },
    actor(),
  )
  flash(result.message, result.ok)
  if (result.ok) {
    reload()
    const fresh = listScreen().find((row) => Number(row.id) === Number(detailRow.value?.id))
    if (fresh) {
      openDetail(fresh)
    }
  } else {
    auditRows.value = listAudit()
  }
}

function runRowAction(action: string, row: EntryRow) {
  const result = runScreenAction(Number(row.id), action, actor())
  flash(result.message, result.ok)
  reload()
  auditRows.value = listAudit()
  if (detailRow.value && Number(detailRow.value.id) === Number(row.id)) {
    const fresh = listScreen().find((item) => Number(item.id) === Number(row.id))
    detailRow.value = fresh ?? null
  }
}

onMounted(reload)
</script>

<style scoped>
.tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tab-badge {
  font-style: normal;
  background: #e2e8f0;
  border-radius: 999px;
  padding: 0 8px;
  margin-left: 6px;
  font-size: 12px;
}
.tab.active .tab-badge { background: rgba(255, 255, 255, 0.25); }
.tip-text { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.notice-text { color: #b42318; }
.notice-text.ok { color: #067647; }
.status-tag { border-radius: 4px; padding: 1px 8px; font-size: 12px; }
.st-pending { background: #fef3c7; color: #92400e; }
.st-doing { background: #dbeafe; color: #1e40af; }
.st-done { background: #dcfce7; color: #166534; }
.st-recheck { background: #fee2e2; color: #991b1b; }
tr.locked { background: #f8fafc; color: var(--muted); }
tr.foreign { background: #fbfbfd; }
.lock-text { color: var(--muted); font-size: 12px; }
.link.danger { color: #b42318; }
.reason-cell { color: #b42318; }
.modal-mask {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff; border-radius: 10px;
  width: 640px; max-width: 92vw; max-height: 88vh; overflow: auto;
  padding: 20px 22px;
}
.modal h3 { margin: 0 0 14px; font-size: 16px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.edit-grid { margin: 12px 0; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.form-item input, .form-item select {
  width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px;
}
.modal-hint { font-size: 12px; color: var(--muted); margin: 10px 0; }
.modal-hint.warn { color: #b42318; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 0; }
.detail-grid dt { font-size: 12px; color: var(--muted); }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; }
.detail-actions { display: flex; gap: 8px; margin-top: 14px; }
</style>

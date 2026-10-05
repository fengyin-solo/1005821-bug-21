<template>
  <section class="page" data-module="screen">
    <header class="page-head">
      <div>
        <h2>格栅清污管理</h2>
        <p class="page-desc">清污记录按归属泵站收口：只有本站在册清污人能改污物量、清污方式与状态；外站提交一律挡回，已完工整条锁定。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清污记录</button>
        <button class="btn" type="button" @click="exportRows">导出{{ scope === 'station' ? '本站' : '全部' }}清单</button>
      </div>
    </header>

    <p class="identity-bar" :class="{ warn: !store.isStationCleaner }">
      当前身份：<strong>{{ store.operator }}</strong>，归属泵站：<strong>{{ store.station }}</strong>
      <label class="scope-toggle">
        <input v-model="scopeAll" type="checkbox" />
        列表同时显示外站记录（只读，动不了）
      </label>
      <span v-if="!store.isStationCleaner" class="error-text">该清污人不在本站名册，任何写操作都会被挡</span>
    </p>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <h3 class="section-title">{{ store.station }} · 待清污清单</h3>
    <p class="section-hint">格栅清污的结论只落到归属泵站本清单；同一次清污重复提交只算一条；带「历史」标记的是既有记录保持的当时结论。</p>
    <table class="data-table compact">
      <thead>
        <tr>
          <th>清污编号</th><th>格栅类型</th><th>结论</th><th>污物量</th>
          <th>清污方式</th><th>清污人</th><th>更新时间</th><th>来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in worklist" :key="item.key">
          <td>{{ item.清污编号 }}</td>
          <td>{{ item.格栅类型 }}</td>
          <td>
            <span class="conclusion" :class="conclusionClass(item.结论)">{{ item.结论 }}</span>
          </td>
          <td>{{ item.污物量 }}</td>
          <td>{{ item.清污方式 }}</td>
          <td>{{ item.清污人 }}</td>
          <td>{{ item.更新时间 }}</td>
          <td>{{ item.历史结论 ? '历史结论' : '本班次流转' }}</td>
        </tr>
        <tr v-if="!worklist.length">
          <td colspan="8" class="empty-state">本站暂无清污清单记录</td>
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'foreign-row': !isOwn(row), 'locked-row': isLocked(row) }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="conclusion" :class="conclusionClass(String(row.status))">{{ row.status }}</span>
            <span v-if="isLocked(row)" class="tag lock">已锁定</span>
            <span v-if="!isOwn(row)" class="tag foreign">外站</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <template v-if="canWrite(row)">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button v-if="!isLocked(row)" class="link" type="button" @click="openEdit(row)">改污物量/方式</button>
            </template>
            <span v-else-if="!isOwn(row)" class="muted-text">外站记录，无权操作</span>
            <span v-else-if="isLocked(row)" class="muted-text">已完工锁定</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">本站暂无格栅清污记录，可先登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ scope === 'station' ? '本站' : '' }}清污记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <h3 class="section-title">越权与拦截留痕</h3>
    <p class="section-hint">被挡下的尝试逐条记录：谁、什么时候、想改哪条、为什么被挡，都能倒查。</p>
    <table class="data-table compact">
      <thead>
        <tr><th>时间</th><th>操作人</th><th>所属泵站</th><th>目标记录</th><th>尝试动作</th><th>拦截原因</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in audits" :key="item.id">
          <td>{{ item.time }}</td>
          <td>{{ item.operator }}</td>
          <td>{{ item.station }}</td>
          <td>{{ item.target }}</td>
          <td>{{ item.action }}</td>
          <td class="error-text">{{ item.reason }}</td>
        </tr>
        <tr v-if="!audits.length">
          <td colspan="6" class="empty-state">暂无拦截记录</td>
        </tr>
      </tbody>
    </table>

    <!-- 登记弹窗 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记清污记录</h3>
        <p class="modal-hint">只能登记到归属泵站「{{ store.station }}」；同站同格栅类型下编号不能重号。</p>
        <label class="form-item"><span>清污编号</span><input v-model="createForm.清污编号" placeholder="如 SCRE-20261005-01" /></label>
        <label class="form-item">
          <span>格栅类型</span>
          <select v-model="createForm.格栅类型">
            <option value="">请选择</option>
            <option v-for="t in gridTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="form-item"><span>污物量</span><input v-model="createForm.污物量" placeholder="如 1.2m³" /></label>
        <label class="form-item">
          <span>清污方式</span>
          <select v-model="createForm.清污方式">
            <option value="">请选择</option>
            <option value="人工清捞">人工清捞</option>
            <option value="机械清污">机械清污</option>
          </select>
        </label>
        <label class="form-item"><span>清污日期</span><input v-model="createForm.清污日期" type="date" /></label>
        <label class="form-item readonly"><span>所属泵站 / 清污人</span><input :value="`${store.station} / ${store.operator}`" readonly /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗：只放污物量与清污方式两项 -->
    <div v-if="editRow" class="modal-mask" @click.self="editRow = null">
      <div class="modal">
        <h3>修改污物量 / 清污方式</h3>
        <p class="modal-hint">{{ editRow.清污编号 }} · {{ editRow.所属泵站 }} · {{ editRow.格栅类型 }}（仅本站在册清污人可改）</p>
        <label class="form-item"><span>污物量</span><input v-model="editForm.污物量" /></label>
        <label class="form-item">
          <span>清污方式</span>
          <select v-model="editForm.清污方式">
            <option value="人工清捞">人工清捞</option>
            <option value="机械清污">机械清污</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editRow = null">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">保存修改</button>
        </div>
      </div>
    </div>

    <!-- 详情弹窗：与列表同读 status 单一事实源，不会再两处对不上 -->
    <div v-if="detailRow" class="modal-mask" @click.self="detailRow = null">
      <div class="modal">
        <h3>清污记录详情</h3>
        <dl class="detail-list">
          <div v-for="column in columns" :key="column">
            <dt>{{ column }}</dt><dd>{{ detailRow[column] ?? '—' }}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>
              <span class="conclusion" :class="conclusionClass(String(detailRow.status))">{{ detailRow.status }}</span>
              <span v-if="isLocked(detailRow)" class="tag lock">整条锁定</span>
            </dd>
          </div>
        </dl>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="detailRow = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  createScreenEntry,
  exportScreenCsv,
  getScreenEntry,
  listScreenAudit,
  listScreenEntries,
  runScreenAction,
  screenStats,
  stationWorklist,
  updateScreenFields,
} from '@/api/screen-service'
import { useSessionStore } from '@/stores/session'
import type {
  Actor,
  AuditEntry,
  EntryRow,
  ScreenCreateInput,
  ScreenWorkItem,
} from '@/data/types'

const store = useSessionStore()
const columns = ['清污编号', '所属泵站', '格栅类型', '污物量', '清污方式', '清污人', '清污日期']
const actions = ['提交清污', '确认完工', '要求复清']
const statuses = ['待清污', '清污中', '需复清', '已完工']
const filterFields = columns.slice(0, 3)
const gridTypes = ['粗格栅', '细格栅', '回转格栅']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const worklist = ref<ScreenWorkItem[]>([])
const audits = ref<AuditEntry[]>([])
const filters = ref<Record<string, string>>({})
const message = ref('')
const messageOk = ref(false)
const scopeAll = ref(false)
const scope = computed<'station' | 'all'>(() => (scopeAll.value ? 'all' : 'station'))

const createOpen = ref(false)
const detailRow = ref<EntryRow | null>(null)
const editRow = ref<EntryRow | null>(null)
const createForm = reactive<ScreenCreateInput>({
  清污编号: '',
  所属泵站: '',
  格栅类型: '',
  污物量: '',
  清污方式: '',
  清污人: '',
  清污日期: '',
})
const editForm = reactive({ 污物量: '', 清污方式: '' })

function actor(): Actor {
  return { operator: store.operator, station: store.station }
}

const statCards = computed(() => {
  const stats = screenStats(actor())
  return [
    { label: '待清污格栅', value: stats.待清污 },
    { label: '清污中格栅', value: stats.清污中 },
    { label: '需复清格栅', value: stats.需复清 },
    { label: '本月完工数', value: stats.本月完工 },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOwn(row: EntryRow): boolean {
  return String(row.所属泵站) === store.station
}

function isLocked(row: EntryRow): boolean {
  return String(row.status) === '已完工'
}

function canWrite(row: EntryRow): boolean {
  return isOwn(row) && store.isStationCleaner
}

function conclusionClass(status: string): string {
  if (status === '已完工') return 'conclusion-done'
  if (status === '需复清') return 'conclusion-redo'
  if (status === '清污中') return 'conclusion-doing'
  return 'conclusion-pending'
}

function flash(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  const { filename, content } = exportScreenCsv(actor(), scope.value)
  // 复用通用下载能力：直接落 Blob。
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openCreate() {
  Object.assign(createForm, {
    清污编号: '',
    所属泵站: store.station,
    格栅类型: '',
    污物量: '',
    清污方式: '',
    清污人: store.operator,
    清污日期: new Date().toISOString().slice(0, 10),
  })
  createOpen.value = true
}

function submitCreate() {
  const result = createScreenEntry({ ...createForm, 所属泵站: store.station }, actor())
  flash(result.message, result.ok)
  if (result.ok) {
    createOpen.value = false
    reload()
  } else {
    reloadAudits()
  }
}

function openEdit(row: EntryRow) {
  editRow.value = row
  editForm.污物量 = String(row.污物量 ?? '')
  editForm.清污方式 = String(row.清污方式 ?? '')
}

function submitEdit() {
  if (!editRow.value) return
  const result = updateScreenFields(
    Number(editRow.value.id),
    { 污物量: editForm.污物量, 清污方式: editForm.清污方式 },
    actor(),
  )
  flash(result.message, result.ok)
  if (result.ok) {
    editRow.value = null
    reload()
  } else {
    reloadAudits()
  }
}

function openDetail(row: EntryRow) {
  // 详情始终按 id 现取，和列表读同一份数据、同一个 status 字段。
  detailRow.value = getScreenEntry(Number(row.id))
}

function runAction(action: string, row: EntryRow) {
  const result = runScreenAction(Number(row.id), action, actor())
  flash(result.message, result.ok)
  reload()
  reloadAudits()
}

function reloadAudits() {
  audits.value = listScreenAudit()
}

function reload() {
  message.value = ''
  const payload = listScreenEntries(actor(), filters.value, scope.value)
  rows.value = payload.items
  total.value = payload.total
  worklist.value = stationWorklist(store.station)
  reloadAudits()
}

onMounted(reload)

// 顶栏切换值班泵站/清污人后，本站视角的清单、统计、留痕立即跟着换。
watch(
  () => [store.station, store.operator],
  () => reload(),
)
</script>

<style scoped>
.identity-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: #eef4ff;
  border: 1px solid #c7d9f7;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  margin: 0 0 12px;
}
.identity-bar.warn { background: #fef3f2; border-color: #f5c2bd; }
.scope-toggle { display: flex; align-items: center; gap: 4px; color: var(--muted); font-weight: normal; }
.section-title { font-size: 15px; margin: 18px 0 4px; }
.section-hint { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.data-table.compact th, .data-table.compact td { padding: 6px 8px; font-size: 12px; }
.foreign-row { background: #fafafa; color: var(--muted); }
.locked-row { background: #f3f4f6; }
.muted-text { color: var(--muted); font-size: 12px; }
.ok-text { color: #067647; }
.tag { display: inline-block; border-radius: 999px; padding: 0 8px; font-size: 11px; margin-left: 6px; }
.tag.lock { background: #e5e7eb; color: #475467; }
.tag.foreign { background: #fff4e5; color: #b54708; }
.conclusion { font-weight: 600; }
.conclusion-pending { color: #b54708; }
.conclusion-doing { color: #175cd3; }
.conclusion-done { color: #067647; }
.conclusion-redo { color: #b42318; }
.modal-mask {
  position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.modal { background: #fff; border-radius: 10px; padding: 20px 24px; width: 440px; max-height: 86vh; overflow: auto; }
.modal h3 { margin: 0 0 8px; font-size: 16px; }
.modal-hint { font-size: 12px; color: var(--muted); margin: 0 0 12px; }
.form-item { display: block; margin-bottom: 10px; font-size: 13px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input, .form-item select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.form-item.readonly input { background: #f3f4f6; color: var(--muted); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.detail-list { margin: 0; }
.detail-list div { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
.detail-list dt { width: 90px; color: var(--muted); flex-shrink: 0; }
.detail-list dd { margin: 0; }
</style>

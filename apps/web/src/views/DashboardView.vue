<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'
import { Activity, AlertTriangle, BellRing, CalendarRange, ChartNoAxesColumnIncreasing, ClipboardList, Clock3, CloudSun, Crosshair, Eye, LogOut, Maximize2, Minimize2, MonitorDot, Navigation, Plane, Play, Radio, RefreshCw, Route, ShieldCheck, Siren, UserRound, Volume2, VolumeX, Warehouse, X, Zap } from 'lucide-vue-next'
import PanelShell from '@/components/PanelShell.vue'
import BarChart from '@/components/BarChart.vue'
import OperationsMap from '@/components/OperationsMap.vue'
import ReplayDialog from '@/components/ReplayDialog.vue'
import ClockText from '@/components/ClockText.vue'
import MetricValue from '@/components/MetricValue.vue'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useAircraftStream } from '@/composables/useAircraftStream'
import { usePolledResource } from '@/composables/usePolledResource'
import { alertEventKey, eventLabel, useRealtimeAlerts } from '@/composables/useRealtimeAlerts'
import { isSoundEnabled, setSoundEnabled } from '@/utils/alertSound'
import type { Aircraft, ConflictPair, FlightAnalytics, FlightRecord, FlightReplay, FlightRoute, NoFlyZone, Overview, Period, RealtimeAlertEvent, TaskRanking, TaskStatus, WorkOrder } from '@/types'
import { formatRecordTime } from '@/utils/format'

const router = useRouter()
const auth = useAuthStore()
const now = useNow({ interval: 60_000 })
const overview = ref<Overview>()
const records = ref<FlightRecord[]>([])
const routes = ref<FlightRoute[]>([])
const ranking = ref<TaskRanking>()
const analytics = ref<FlightAnalytics[]>([])
const aircraft = ref<Aircraft[]>([])
const zones = ref<NoFlyZone[]>([])
const period = ref<Period>('month')
const taskStatus = ref<TaskStatus>('completed')
const analyticMetric = ref<'recordCount' | 'flightLength' | 'durationHours'>('recordCount')
const loading = ref(true)
const error = ref('')
const rankingLoading = ref(false)
const rankingError = ref('')
const selectedId = ref('')
const activeAlert = ref<Aircraft>()
const alertDrawerOpen = ref(false)
const drawerMode = ref<'flying' | 'alerts' | 'tasks' | 'routes'>('alerts')
const soundEnabled = ref(isSoundEnabled())
const activeTab = ref<'ranking' | 'analytics'>('ranking')
const replay = ref<FlightReplay>()
const replayDialogOpen = ref(false)
const replayLoadingId = ref('')
const previewLoadingId = ref('')
const convertingKey = ref('')
const syncedFlash = ref(false)
const isFullscreen = ref(false)
const focusRequest = ref<{ lng: number; lat: number; seq: number } | null>(null)
let focusSeq = 0
let syncedTimer: number | undefined

const { connected, connect, disconnect, recover } = useAircraftStream()
const alerts = useRealtimeAlerts(aircraft)
const { toasts, alertEvents, convertedAlerts, visibleWarningAircraft, pushToast, dismissToast, handleComplianceEvent, dismissAlert, dismissEvent, markConverted } = alerts
const canOperate = computed(() => auth.hasRole('operator') || auth.hasRole('admin'))

/** S3 冲突对：从实时合规事件提取，供地图连线（与告警抽屉同一来源） */
const conflictPairs = computed<ConflictPair[]>(() => alertEvents.value
  .filter((event) => event.type === 'conflict')
  .map((event) => ({ a: event.a, b: event.b, horizontalM: event.horizontalM, verticalM: event.verticalM, severity: event.severity })))

const periods: Array<{ key: Period; label: string }> = [{ key: 'today', label: '今日' }, { key: 'week', label: '本周' }, { key: 'month', label: '本月' }, { key: 'year', label: '本年' }, { key: 'all', label: '累计' }]
const statuses: Array<{ key: TaskStatus; label: string }> = [{ key: 'dispatched', label: '待派发' }, { key: 'dispatching', label: '派发中' }, { key: 'received', label: '已接单' }, { key: 'completed', label: '已结单' }]
const metricLabels = { recordCount: ['飞行架次', '架'], flightLength: ['飞行里程', 'km'], durationHours: ['飞行时长', 'h'] } as const
const panelTabs: Array<{ key: 'ranking' | 'analytics'; label: string }> = [
  { key: 'ranking', label: '任务排行' }, { key: 'analytics', label: '飞行分析' },
]
const panelTitle = computed(() => ({ ranking: '飞行任务排行榜', analytics: '飞行统计分析' })[activeTab.value])
const panelEyebrow = computed(() => ({ ranking: 'TASK PERFORMANCE', analytics: 'FLIGHT ANALYTICS' })[activeTab.value])
const weatherLabel = import.meta.env.VITE_WEATHER_LABEL || '多云 29℃'
const dateText = computed(() => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(now.value))
const lastSyncText = computed(() => overview.value ? new Date(overview.value.generatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--')
const executingAircraft = computed(() => aircraft.value.filter((item) => item.status === 'flying'))
const onlineCount = computed(() => executingAircraft.value.length)
const warningCount = computed(() => visibleWarningAircraft.value.length + alertEvents.value.length)
const todayTasks = computed(() => ranking.value ? Object.values(ranking.value.totals).reduce((a, b) => a + b, 0) : 0)
const chartValues = computed(() => analytics.value.map((row) => Number(row[analyticMetric.value])))
const chartColor = computed(() => analyticMetric.value === 'recordCount' ? 'var(--accent)' : analyticMetric.value === 'flightLength' ? 'var(--warning)' : 'var(--blue)')
const drawerTitle = computed(() => ({ flying: '执行中无人机', alerts: '运行告警', tasks: '今日任务概览', routes: '飞行航线目录' })[drawerMode.value])
const drawerCount = computed(() => drawerMode.value === 'flying' ? executingAircraft.value.length : drawerMode.value === 'alerts' ? warningCount.value : drawerMode.value === 'routes' ? routes.value.length : todayTasks.value)
const drawerAria = computed(() => drawerTitle.value)

function progressClass(percent: number) {
  return percent >= 20 ? 'lvl-mid' : 'lvl-low'
}

async function loadRanking(silent = false) {
  if (!silent) { rankingLoading.value = true; rankingError.value = '' }
  try {
    const response = await api<{ data: TaskRanking }>(`/v1/dashboard/task-ranking?period=${period.value}&status=${taskStatus.value}`)
    ranking.value = response.data
    rankingError.value = ''
  } catch (reason) {
    rankingError.value = reason instanceof Error ? reason.message : '排行榜载入失败'
  } finally {
    rankingLoading.value = false
  }
}

async function loadBase(silent = false) {
  if (!silent) { loading.value = true; error.value = '' }
  try {
    const [o, r, a, ac, z, routeResponse] = await Promise.all([
      api<{ data: Overview }>('/v1/dashboard/overview'),
      api<{ data: { rows: FlightRecord[] } }>('/v1/flight-records?limit=10'),
      api<{ data: { rows: FlightAnalytics[] } }>('/v1/metrics/flights'),
      api<{ data: { rows: Aircraft[] } }>('/v1/aircraft'),
      api<{ data: { rows: NoFlyZone[] } }>('/v1/geo/no-fly-zones'),
      api<{ data: { rows: FlightRoute[] } }>('/v1/flight-routes'),
    ])
    overview.value = o.data; records.value = r.data.rows; analytics.value = a.data.rows; aircraft.value = ac.data.rows; zones.value = z.data.rows; routes.value = routeResponse.data.rows
    error.value = ''
    await loadRanking(true)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '数据载入失败'
  } finally {
    loading.value = false
  }
}

const poll = usePolledResource(loadBase)
const { syncing } = poll

function recoverConnection() {
  if (document.visibilityState === 'hidden') return
  void poll.refresh(true)
  recover()
}

function flashSynced() {
  syncedFlash.value = true
  window.clearTimeout(syncedTimer)
  syncedTimer = window.setTimeout(() => { syncedFlash.value = false }, 1500)
}

function focusAircraft(item: Aircraft) {
  selectedId.value = item.id
  focusRequest.value = { lng: item.longitude, lat: item.latitude, seq: ++focusSeq }
  alertDrawerOpen.value = false
  toasts.value = toasts.value.filter((toast) => toast.aircraftId !== item.id)
  if (item.status === 'warning') activeAlert.value = item
}

/** 空域事件定位：聚焦关联飞机（nofly/low-battery → 违规机；conflict → 其中一架） */
function focusEvent(event: RealtimeAlertEvent) {
  const target = event.type === 'conflict' ? event.a : event.aircraft
  focusAircraft(target)
}

/** Toast 点击定位（飞机告警 / 空域事件共用） */
function focusEventKey(toast: { aircraftId?: string }) {
  const target = aircraft.value.find((item) => item.id === toast.aircraftId)
  if (target) focusAircraft(target)
}

async function startReplay(record: FlightRecord) {
  replayLoadingId.value = record.id
  try {
    const response = await api<{ data: FlightReplay }>(`/v1/flight-records/${record.id}/replay`)
    replay.value = response.data
    selectedId.value = ''
    replayDialogOpen.value = true
  } catch (reason) {
    pushToast({ key: `replay-${record.id}`, title: '轨迹载入失败', detail: reason instanceof Error ? reason.message : '请稍后重试', kind: 'aircraft' })
  } finally {
    replayLoadingId.value = ''
  }
}

async function previewRoute(route: FlightRoute) {
  previewLoadingId.value = route.id
  try {
    const response = await api<{ data: FlightReplay }>(`/v1/flight-routes/${route.id}/preview`)
    replay.value = response.data
    replayDialogOpen.value = true
    alertDrawerOpen.value = false
  } catch (reason) {
    pushToast({ key: `preview-${route.id}`, title: '计划预览失败', detail: reason instanceof Error ? reason.message : '请稍后重试', kind: 'aircraft' })
  } finally {
    previewLoadingId.value = ''
  }
}

function replayRouteHistory(route: FlightRoute) {
  const record = records.value.find((item) => item.id === route.latestRecordId)
  if (record) {
    alertDrawerOpen.value = false
    void startReplay(record)
  }
}

function closeAircraftAlert(id: string) {
  dismissAlert(id)
  if (activeAlert.value?.id === id) activeAlert.value = undefined
}

function openDetailDrawer(mode: 'flying' | 'alerts' | 'tasks' | 'routes') {
  drawerMode.value = mode
  alertDrawerOpen.value = true
}

function closeDrawer() {
  alertDrawerOpen.value = false
}

function toggleSound() {
  const next = !soundEnabled.value
  soundEnabled.value = next
  setSoundEnabled(next)
}

function alertTicketPayload(event: RealtimeAlertEvent) {
  if (event.type === 'nofly') {
    return {
      title: `禁飞区违规处置 · ${event.aircraft.name}`,
      lineName: '应急处置航线',
      aircraftName: event.aircraft.name,
      sourceAlertId: alertEventKey(event),
    }
  }
  if (event.type === 'conflict') {
    return {
      title: `空域冲突处置 · ${event.a.name}/${event.b.name}`,
      lineName: '应急处置航线',
      aircraftName: event.a.name,
      sourceAlertId: alertEventKey(event),
    }
  }
  return {
    title: `低电量返航处置 · ${event.aircraft.name}`,
    lineName: '返航保养航线',
    aircraftName: event.aircraft.name,
    sourceAlertId: alertEventKey(event),
  }
}

async function convertEventToWorkOrder(event: RealtimeAlertEvent) {
  if (!canOperate.value) return
  const key = alertEventKey(event)
  if (convertedAlerts.value.has(key) || convertingKey.value === key) return
  convertingKey.value = key
  try {
    const payload = alertTicketPayload(event)
    const response = await api<{ data: WorkOrder }>('/v1/work-orders', {
      method: 'POST',
      body: JSON.stringify({ ...payload, orgName: '市级指挥中心', source: 'alert' }),
    })
    markConverted(key)
    pushToast({ key: `converted-${key}`, title: '已转工单', detail: `${response.data.id} · ${response.data.title}`, kind: 'success' })
    await router.push({ path: '/workspace', query: { module: 'workorder', ticket: response.data.id } })
  } catch (reason) {
    pushToast({ key: `convert-fail-${key}`, title: '转工单失败', detail: reason instanceof Error ? reason.message : '请稍后重试', kind: 'info' })
  } finally {
    convertingKey.value = ''
  }
}

async function convertAircraftToWorkOrder(item: Aircraft) {
  if (!canOperate.value) return
  const key = `aircraft-${item.id}`
  if (convertedAlerts.value.has(key) || convertingKey.value === key) return
  convertingKey.value = key
  try {
    const response = await api<{ data: WorkOrder }>('/v1/work-orders', {
      method: 'POST',
      body: JSON.stringify({
        title: `运行告警处置 · ${item.name}`,
        lineName: item.task || '应急处置航线',
        orgName: '市级指挥中心',
        aircraftName: item.name,
        source: 'alert',
        sourceAlertId: key,
      }),
    })
    markConverted(key)
    pushToast({ key: `converted-${key}`, title: '已转工单', detail: `${response.data.id} · ${response.data.title}`, kind: 'success' })
    await router.push({ path: '/workspace', query: { module: 'workorder', ticket: response.data.id } })
  } catch (reason) {
    pushToast({ key: `convert-fail-${key}`, title: '转工单失败', detail: reason instanceof Error ? reason.message : '请稍后重试', kind: 'info' })
  } finally {
    convertingKey.value = ''
  }
}

function onDrawerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDrawer()
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

async function setPeriod(value: Period) { period.value = value; await loadRanking() }
async function setTaskStatus(value: TaskStatus) { taskStatus.value = value; await loadRanking() }
async function manualRefresh() {
  await poll.refresh(true)
  if (!error.value) flashSynced()
}
async function toggleFullscreen() { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen() }
/** 大屏快捷键：F 全屏 / R 刷新（输入态不拦截，演示友好） */
function onGlobalKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (event.key === 'f' || event.key === 'F') { event.preventDefault(); void toggleFullscreen() }
  else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); void manualRefresh() }
}
async function logout() { disconnect(); poll.stop(); auth.logout(); await router.push('/login') }

watch(alertDrawerOpen, (open) => {
  if (open) window.addEventListener('keydown', onDrawerKeydown)
  else window.removeEventListener('keydown', onDrawerKeydown)
})

onMounted(async () => {
  const notice = sessionStorage.getItem('route_notice')
  if (notice) {
    sessionStorage.removeItem('route_notice')
    pushToast({ key: `notice-${Date.now()}`, title: '权限提示', detail: notice, kind: 'info' })
  }
  await loadBase(false)
  connect({ onAircraft: (rows) => { aircraft.value = rows }, onCompliance: handleComplianceEvent })
  poll.start()
  window.addEventListener('online', recoverConnection)
  document.addEventListener('visibilitychange', recoverConnection)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  disconnect()
  poll.stop()
  window.clearTimeout(syncedTimer)
  window.removeEventListener('online', recoverConnection)
  document.removeEventListener('visibilitychange', recoverConnection)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('keydown', onDrawerKeydown)
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <main class="dashboard-view">
    <header class="command-header">
      <div class="command-brand"><div class="brand-mark compact"><span>LA</span><i /></div><div><small>LOW-ALTITUDE COMMAND</small><h1>无人机低空指挥调度平台</h1></div></div>
      <div class="header-center"><span class="live-pill"><Radio />运行态势 LIVE</span><ClockText /><span>{{ dateText }}</span><span class="weather"><CloudSun />{{ weatherLabel }}</span></div>
      <div class="header-actions">
        <span class="connection" :class="{ synced: syncedFlash }"><i :class="connected ? 'online' : 'offline'" />{{ syncedFlash ? '已同步' : connected ? '链路正常' : '链路重连' }}</span>
        <button type="button" :class="{ syncing }" title="刷新数据" aria-label="刷新数据" @click="manualRefresh"><RefreshCw /></button>
        <button v-if="canOperate" type="button" title="作业工作台" aria-label="进入作业工作台" @click="router.push('/workspace')"><MonitorDot /></button>
        <button type="button" :title="isFullscreen ? '退出全屏' : '全屏'" :aria-label="isFullscreen ? '退出全屏' : '切换全屏'" :aria-pressed="isFullscreen" @click="toggleFullscreen"><Minimize2 v-if="isFullscreen" /><Maximize2 v-else /></button>
        <div class="user-badge"><UserRound /><span>{{ auth.userName || '指挥中心管理员' }}<small>市级指挥中心</small></span></div>
        <button type="button" title="退出登录" aria-label="退出登录" @click="logout"><LogOut /></button>
      </div>
    </header>

    <div class="dashboard-grid">
      <aside class="dashboard-column left-column">
        <PanelShell title="飞行总览" eyebrow="OPERATION OVERVIEW" :loading="loading" :error="error" :stale="Boolean(error && overview)" @retry="loadBase">
          <div class="metric-grid">
            <article><Warehouse /><span>方舱总数</span><strong><MetricValue :value="overview?.shelterNum ?? 0" /></strong><small>个</small></article>
            <article><UserRound /><span>飞手总数</span><strong><MetricValue :value="overview?.flyerNum ?? 0" /></strong><small>人</small></article>
            <button type="button" class="metric-card-btn" title="查看飞行航线目录" aria-label="查看飞行航线目录" @click="openDetailDrawer('routes')"><Route /><span>飞行航线</span><strong><MetricValue :value="overview?.flyLineNum ?? 0" /></strong><small>条</small></button>
            <article><Plane /><span>累计架次</span><strong><MetricValue :value="overview?.recordCount ?? 0" /></strong><small>架</small></article>
          </div>
          <div class="metric-strips"><span><Navigation />累计里程<strong>{{ (overview?.flightLength ?? 0).toLocaleString() }} km</strong></span><span><Clock3 />累计时长<strong>{{ overview?.durationHours ?? 0 }} h</strong></span></div>
          <div class="metric-mini"><span><Crosshair /><b>成果数量</b><strong><MetricValue :value="overview?.achieveNum ?? 0" /></strong></span><span><ClipboardList /><b>工单数量</b><strong><MetricValue :value="overview?.workOrderNum ?? 0" /></strong></span><span><CalendarRange /><b>飞行计划</b><strong><MetricValue :value="overview?.flyPlaneNum ?? 0" /></strong></span></div>
        </PanelShell>

        <PanelShell title="飞行案例 TOP10" eyebrow="LATEST FLIGHT RECORDS" :loading="loading" :error="error" :stale="Boolean(error && records.length)" @retry="loadBase" :empty="records.length ? '' : '暂无飞行记录'">
          <ol class="record-list">
            <li v-for="(record, index) in records" :key="record.id"><span class="record-index">{{ String(index + 1).padStart(2, '0') }}</span><button type="button" class="record-main" :aria-label="`回放 ${record.name}`" @click="startReplay(record)"><strong>{{ record.name }}</strong><small>{{ record.routeName }} · {{ record.deviceName }}</small></button><time>{{ formatRecordTime(record.executedAt) }}</time><button type="button" class="record-replay" :disabled="replayLoadingId === record.id" :aria-label="`回放 ${record.name}`" @click="startReplay(record)"><span v-if="replayLoadingId === record.id" class="spinner" /><Play v-else /></button></li>
          </ol>
        </PanelShell>
      </aside>

      <section class="map-column">
        <div v-if="activeAlert" class="alert-brief" role="status">
          <BellRing /><strong>{{ activeAlert.name }}</strong><span>{{ activeAlert.task }} · 电量 {{ activeAlert.batteryPercent }}%</span><button type="button" aria-label="关闭告警简报" @click="activeAlert = undefined">关闭</button>
        </div>
        <div class="map-kpis">
          <button type="button" class="map-kpi-btn" title="查看执行中无人机" aria-label="查看执行中无人机" @click="openDetailDrawer('flying')"><Activity /><div><span>执行中</span><strong><MetricValue :value="onlineCount" /></strong></div><small>架</small></button>
          <button type="button" class="map-kpi-btn" :class="{ alert: warningCount }" title="查看运行告警列表" aria-label="查看运行告警列表" @click="openDetailDrawer('alerts')"><AlertTriangle /><div><span>运行告警</span><strong><MetricValue :value="warningCount" /></strong></div><small>条</small><i v-if="warningCount" class="kpi-beacon" /></button>
          <button type="button" class="map-kpi-btn" title="查看今日任务" aria-label="查看今日任务" @click="openDetailDrawer('tasks')"><ShieldCheck /><div><span>今日任务</span><strong><MetricValue :value="todayTasks" /></strong></div><small>项</small></button>
        </div>
        <OperationsMap :aircraft="aircraft" :connected="connected" :selected-id="selectedId" :zones="zones" :conflicts="conflictPairs" :focus="focusRequest" @select="focusAircraft" @clear="selectedId = ''; activeAlert = undefined" />
      </section>

      <aside class="dashboard-column right-column">
        <PanelShell class="scene-panel-shell" :title="panelTitle" :eyebrow="panelEyebrow" :loading="loading || (activeTab === 'ranking' && rankingLoading)" :error="activeTab === 'ranking' ? rankingError : ''" :stale="Boolean(activeTab === 'ranking' && rankingError && ranking)" @retry="loadRanking" :empty="activeTab === 'ranking' && !ranking?.rows?.length ? '暂无排行数据' : ''">
          <template #actions><div class="segmented compact panel-tabs" aria-label="右侧面板切换"><button v-for="tab in panelTabs" :key="tab.key" type="button" :class="{ active: activeTab === tab.key }" :aria-pressed="activeTab === tab.key" @click="activeTab = tab.key">{{ tab.label }}</button></div></template>

          <template v-if="activeTab === 'ranking'">
            <div class="status-tabs" aria-label="任务状态"><button v-for="item in statuses" :key="item.key" type="button" :class="{ active: taskStatus === item.key }" :aria-pressed="taskStatus === item.key" @click="setTaskStatus(item.key)"><span>{{ item.label }}</span><strong>{{ ranking?.totals[item.key] ?? 0 }}</strong></button></div>
            <div class="ranking-list"><article v-for="(row, index) in ranking?.rows" :key="row.id" :class="{ 'rank-first': index === 0 }"><span class="rank">{{ index + 1 }}</span><div><header><b>{{ row.name }}</b><em>{{ row.value }}项 · {{ row.percent }}%</em></header><div class="progress"><i :class="progressClass(row.percent)" :style="{ width: `${row.percent}%` }" /></div></div></article></div>
            <div class="panel-tabs-hint">排行榜统计周期：<span class="segmented compact inline-segmented"><button v-for="item in periods" :key="item.key" type="button" :class="{ active: period === item.key }" :aria-pressed="period === item.key" @click="setPeriod(item.key)">{{ item.label }}</button></span></div>
          </template>

          <div v-else class="analytics-workspace">
            <header><ChartNoAxesColumnIncreasing /><span>数据口径 · 2024.01.01 至今</span></header>
            <div class="segmented metric-switch" aria-label="统计指标"><button v-for="key in (Object.keys(metricLabels) as Array<keyof typeof metricLabels>)" :key="key" type="button" :class="{ active: analyticMetric === key }" :aria-pressed="analyticMetric === key" @click="analyticMetric = key">{{ metricLabels[key][0] }}</button></div>
            <BarChart :labels="analytics.map(row => row.name)" :values="chartValues" :unit="metricLabels[analyticMetric][1]" :color="chartColor" />
            <div class="analytics-summary"><span v-for="row in analytics" :key="row.id"><b>{{ row.name }}</b><em>{{ row[analyticMetric] }} {{ metricLabels[analyticMetric][1] }}</em></span></div>
          </div>
        </PanelShell>
      </aside>
    </div>

    <footer class="command-footer"><span><Crosshair />数据域：市级指挥中心</span><span>统计口径：任务 / 飞行记录 / 实时遥测</span><span><Zap />最后同步 {{ lastSyncText }}</span><span class="footer-keys"><kbd>F</kbd> 全屏 <kbd>R</kbd> 刷新</span></footer>
  </main>

  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="alert-toasts" aria-live="polite">
      <article v-for="toast in toasts" :key="toast.key" class="alert-toast" :class="`toast-${toast.kind}`">
        <button type="button" class="toast-body" @click="focusEventKey(toast)"><Siren /><div><b>{{ toast.title }}</b><small>{{ toast.detail }}</small></div></button>
        <button type="button" class="toast-close" :aria-label="`关闭 ${toast.title}`" @click="dismissToast(toast.key)"><X /></button>
      </article>
    </TransitionGroup>
  </Teleport>

  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="alertDrawerOpen" class="drawer-overlay" @click.self="closeDrawer">
      <aside class="alert-drawer" role="dialog" aria-modal="true" :aria-label="drawerAria">
        <header>
          <div class="drawer-title"><Siren /><span>{{ drawerTitle }}</span><b>{{ drawerCount }}</b></div>
          <button type="button" class="drawer-close" aria-label="关闭详情抽屉" @click="closeDrawer"><X /></button>
        </header>
        <div class="drawer-scroll">
          <ul v-if="drawerMode === 'flying'" class="alert-list detail-list">
            <li v-for="item in executingAircraft" :key="item.id">
              <span class="alert-beacon flying-beacon" />
              <div class="alert-info"><b>{{ item.name }}</b><small>{{ item.task }} · 电量 {{ item.batteryPercent }}% · 高度 {{ item.altitudeM }}m · {{ item.speedMps }}m/s</small></div>
              <div class="alert-actions"><button type="button" :aria-label="`定位 ${item.name}`" @click="focusAircraft(item)">定位</button></div>
            </li>
          </ul>
          <div v-else-if="drawerMode === 'tasks'" class="task-detail-list">
            <div class="task-total-grid"><span v-for="item in statuses" :key="item.key"><em>{{ item.label }}</em><strong>{{ ranking?.totals[item.key] ?? 0 }}</strong></span></div>
            <ol><li v-for="row in ranking?.rows" :key="row.id"><span>{{ row.name }}</span><strong>{{ row.total }} 项</strong><em>{{ row.percent }}%</em></li></ol>
          </div>
          <ul v-else-if="drawerMode === 'routes'" class="route-drawer-list">
            <li v-for="route in routes" :key="route.id">
              <div class="route-drawer-info"><b>{{ route.name }}</b><small>{{ route.orgName }} · {{ route.aircraftName }} · {{ route.distanceKm }}km / {{ route.durationMinutes }}min / {{ route.altitudeM }}m</small></div>
              <span :class="['route-state', route.status]">{{ route.status === 'active' ? '运行中' : '计划' }}</span>
              <div class="route-actions"><button type="button" :disabled="previewLoadingId === route.id" :aria-label="`预览 ${route.name}`" @click="previewRoute(route)"><Eye />{{ previewLoadingId === route.id ? '载入中' : '预览' }}</button><button v-if="route.latestRecordId" type="button" :aria-label="`回放 ${route.name}`" @click="replayRouteHistory(route)"><Play />回放</button></div>
            </li>
          </ul>
          <template v-else>
          <ul v-if="visibleWarningAircraft.length" class="alert-list">
            <li v-for="item in visibleWarningAircraft" :key="item.id">
              <span class="alert-beacon" />
              <div class="alert-info"><b>{{ item.name }}</b><small>{{ item.task }} · 电量 {{ item.batteryPercent }}% · 高度 {{ item.altitudeM }}m</small></div>
              <div class="alert-actions">
                <button type="button" :aria-label="`定位 ${item.name}`" @click="focusAircraft(item)">定位</button>
                <button v-if="canOperate" type="button" :disabled="convertedAlerts.has(`aircraft-${item.id}`) || convertingKey === `aircraft-${item.id}`" :aria-label="convertedAlerts.has(`aircraft-${item.id}`) ? `${item.name} 已转工单` : `将 ${item.name} 转工单`" @click="convertAircraftToWorkOrder(item)">{{ convertedAlerts.has(`aircraft-${item.id}`) ? '已转单' : convertingKey === `aircraft-${item.id}` ? '转单中' : '转工单' }}</button>
                <button type="button" :aria-label="`忽略 ${item.name} 告警`" @click="closeAircraftAlert(item.id)">忽略</button>
              </div>
            </li>
          </ul>
          <ul v-if="alertEvents.length" class="alert-list event-list" aria-label="空域合规事件">
            <li v-for="(event, index) in alertEvents" :key="alertEventKey(event)">
              <span class="alert-beacon" :class="`beacon-${event.type}`" />
              <div class="alert-info"><b>{{ eventLabel(event).title }}</b><small>{{ eventLabel(event).detail }}</small></div>
              <div class="alert-actions">
                <button type="button" :aria-label="`定位 ${eventLabel(event).title}`" @click="focusEvent(event)">定位</button>
                <button v-if="canOperate" type="button" :disabled="convertedAlerts.has(alertEventKey(event)) || convertingKey === alertEventKey(event)" :aria-label="convertedAlerts.has(alertEventKey(event)) ? `${eventLabel(event).title} 已转工单` : `将 ${eventLabel(event).title} 转工单`" @click="convertEventToWorkOrder(event)">{{ convertedAlerts.has(alertEventKey(event)) ? '已转单' : convertingKey === alertEventKey(event) ? '转单中' : '转工单' }}</button>
                <button type="button" :aria-label="`忽略 ${eventLabel(event).title}`" @click="dismissEvent(index)">忽略</button>
              </div>
            </li>
          </ul>
          <div v-if="!visibleWarningAircraft.length && !alertEvents.length" class="alert-empty">当前无运行告警</div>
          </template>
        </div>
        <footer>
          <button type="button" class="sound-toggle" :aria-pressed="soundEnabled" :aria-label="soundEnabled ? '关闭告警音' : '开启告警音'" @click="toggleSound"><Volume2 v-if="soundEnabled" /><VolumeX v-else /><span>{{ soundEnabled ? '告警音已开启' : '告警音已静音' }}</span></button>
          <span>告警来源：实时遥测 · 禁飞区 / 冲突 / 低电量</span>
        </footer>
      </aside>
      </div>
    </Transition>
  </Teleport>

  <ReplayDialog v-if="replayDialogOpen && replay" :replay="replay" @close="replayDialogOpen = false" />
</template>

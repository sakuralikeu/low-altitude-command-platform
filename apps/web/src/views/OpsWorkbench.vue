<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CheckCircle2, ClipboardList, LogOut, MonitorDot, PanelLeftClose, PanelLeftOpen, Radar, Route as RouteIcon, Save, ShieldCheck, Sparkles, UserRound, Wrench, X } from 'lucide-vue-next'
import PanelShell from '@/components/PanelShell.vue'
import DispatchPanel from '@/components/DispatchPanel.vue'
import WorkOrderPanel from '@/components/WorkOrderPanel.vue'
import HealthPanel from '@/components/HealthPanel.vue'
import AiEventsPanel from '@/components/AiEventsPanel.vue'
import ReplayDialog from '@/components/ReplayDialog.vue'
import OperationsMap from '@/components/OperationsMap.vue'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useAircraftStream } from '@/composables/useAircraftStream'
import { useRealtimeAlerts } from '@/composables/useRealtimeAlerts'
import type { Aircraft, ConflictPair, DispatchTaskType, FlightReplay, FlightRoute, NoFlyZone, Shelter } from '@/types'

type WorkbenchKey = 'dispatch' | 'workorder' | 'health' | 'ai'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const activeKey = ref<WorkbenchKey>('dispatch')
const highlightTicket = ref('')
const routes = ref<FlightRoute[]>([])
const replay = ref<FlightReplay>()
const replayDialogOpen = ref(false)
const previewLoadingId = ref('')
const aircraft = ref<Aircraft[]>([])
const zones = ref<NoFlyZone[]>([])
const shelters = ref<Shelter[]>([])
const selectedId = ref('')
const navCollapsed = ref(false)
const focusRequest = ref<{ lng: number; lat: number; seq: number } | null>(null)
const targetPoint = ref<{ lng: number; lat: number } | null>(null)
/** 航线规划模式：地图点击加点 → 命名保存 → 新航线进首页目录；派发可选沿航线执行 */
const planning = ref(false)
const planPoints = ref<Array<[number, number]>>([])
const planName = ref('')
const preferredAircraftId = ref('')
const savingPlan = ref(false)
let focusSeq = 0

const dispatchContext = ref<{
  taskType: DispatchTaskType
  lng: number
  lat: number
  priority: 'normal' | 'high'
  label?: string
}>({ taskType: 'inspect', lng: 121.4737, lat: 31.2304, priority: 'normal' })

const { connected, connect } = useAircraftStream()
const { toasts, alertEvents, pushToast, dismissToast } = useRealtimeAlerts(aircraft, { notifyAircraftChanges: false })

/** S3 冲突对：从实时合规事件中提取，供地图连线（与告警抽屉同一来源） */
const conflictPairs = computed<ConflictPair[]>(() => alertEvents.value
  .filter((event) => event.type === 'conflict')
  .map((event) => ({ a: event.a, b: event.b, horizontalM: event.horizontalM, verticalM: event.verticalM, severity: event.severity })))

const navItems: Array<{ key: WorkbenchKey | 'qa'; label: string; desc: string; icon: typeof Radar; disabled?: boolean }> = [
  { key: 'dispatch', label: '智能调度', desc: 'S2/S8 · 任务推荐与应急派单', icon: Radar },
  { key: 'workorder', label: '工单闭环', desc: 'S7 · 巡检工单与状态流转', icon: ClipboardList },
  { key: 'health', label: '设备健康', desc: 'S10 · 保养预测与健康分', icon: Wrench },
  { key: 'ai', label: 'AI 事件处置', desc: 'S6 · 识别事件演示流', icon: ShieldCheck },
  { key: 'qa', label: '数据问答', desc: 'S9 · 暂缓：需指标字典+权限+SQL沙箱', icon: Sparkles, disabled: true },
]

const panelTitle = computed(() => ({ dispatch: '智能调度推荐', workorder: '巡检工单闭环', health: '设备健康与维护预测', ai: 'AI 识别事件处置' })[activeKey.value])
const panelEyebrow = computed(() => ({ dispatch: 'AI DISPATCH S2/S8', workorder: 'WORK ORDER S7', health: 'FLEET HEALTH S10', ai: 'AI RECOGNITION S6' })[activeKey.value])

function applyRouteQuery() {
  const module = String(route.query.module ?? '')
  if (module === 'dispatch' || module === 'workorder' || module === 'health' || module === 'ai') activeKey.value = module
  highlightTicket.value = String(route.query.ticket ?? '')
  preferredAircraftId.value = String(route.query.aircraftId ?? '')
  const lng = Number(route.query.lng)
  const lat = Number(route.query.lat)
  const taskType = String(route.query.taskType ?? '') as DispatchTaskType
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    dispatchContext.value = {
      taskType: taskType === 'patrol' || taskType === 'emergency' ? taskType : 'inspect',
      lng,
      lat,
      priority: route.query.priority === 'high' || taskType === 'emergency' ? 'high' : 'normal',
      label: typeof route.query.label === 'string' ? route.query.label : undefined,
    }
    focusRequest.value = { lng, lat, seq: ++focusSeq }
  }
}

/** 方舱弹窗「去调度」：切到调度面板并预选该飞机（候选存在则高亮，否则提示） */
function onShelterDispatch(item: Aircraft) {
  preferredAircraftId.value = item.id
  activeKey.value = 'dispatch'
  dispatchContext.value = { ...dispatchContext.value, lng: item.longitude, lat: item.latitude, label: `${item.name}（方舱）` }
  targetPoint.value = { lng: item.longitude, lat: item.latitude }
  focusRequest.value = { lng: item.longitude, lat: item.latitude, seq: ++focusSeq }
  pushToast({ key: `shelter-${item.id}`, title: `已选中 ${item.name}`, detail: '候选列表已预选，确认后派发（方舱→无人机→调度）', kind: 'info' })
}

/** 进入/退出航线规划：地图点击加点，至少 2 点可命名保存 */
function togglePlanning() {
  planning.value = !planning.value
  if (!planning.value) { planPoints.value = []; planName.value = '' }
  else selectedId.value = ''
}

function onPlanPoint(lng: number, lat: number) {
  if (planPoints.value.length >= 20) { pushToast({ key: 'plan-max', title: '航点已达上限', detail: '单条航线最多 20 个航点', kind: 'info' }); return }
  planPoints.value = [...planPoints.value, [lng, lat]]
}

async function savePlan() {
  if (planPoints.value.length < 2) { pushToast({ key: 'plan-min', title: '航点不足', detail: '至少需要 2 个航点', kind: 'info' }); return }
  const name = planName.value.trim()
  if (!name) { pushToast({ key: 'plan-name', title: '请填写航线名称', detail: '命名后保存进首页航线目录', kind: 'info' }); return }
  savingPlan.value = true
  try {
    const response = await api<{ data: FlightRoute }>('/v1/flight-routes', { method: 'POST', body: JSON.stringify({ name, waypoints: planPoints.value }) })
    pushToast({ key: `plan-${Date.now()}`, title: '航线已保存', detail: `${response.data.id} · ${response.data.name} · ${response.data.distanceKm}km / ${response.data.durationMinutes}min，已加入航线目录`, kind: 'success' })
    planPoints.value = []
    planName.value = ''
    planning.value = false
    void loadRoutes()
  } catch (reason) {
    pushToast({ key: 'plan-fail', title: '航线保存失败', detail: reason instanceof Error ? reason.message : '请稍后重试', kind: 'info' })
  } finally {
    savingPlan.value = false
  }
}

function onDispatched(message: string) {
  pushToast({ key: `dispatch-${Date.now()}`, title: '智能派发完成', detail: message, kind: 'success' })
}

function onAiDispatch(payload: { label: string; lng: number; lat: number }) {
  dispatchContext.value = { taskType: 'emergency', lng: payload.lng, lat: payload.lat, priority: 'high', label: payload.label }
  targetPoint.value = { lng: payload.lng, lat: payload.lat }
  focusRequest.value = { lng: payload.lng, lat: payload.lat, seq: ++focusSeq }
  activeKey.value = 'dispatch'
  pushToast({ key: `ai-dispatch-${Date.now()}`, title: '已转派至智能调度', detail: `${payload.label} · 已按事件坐标重算推荐`, kind: 'info' })
}

function onWorkOrderCreated(message: string) {
  pushToast({ key: `ticket-${Date.now()}`, title: '工单已生成', detail: message, kind: 'success' })
  activeKey.value = 'workorder'
}

function selectAircraft(item: Aircraft) {
  selectedId.value = item.id
  targetPoint.value = { lng: item.longitude, lat: item.latitude }
  dispatchContext.value = { ...dispatchContext.value, lng: item.longitude, lat: item.latitude, label: item.name }
  focusRequest.value = { lng: item.longitude, lat: item.latitude, seq: ++focusSeq }
  if (activeKey.value !== 'dispatch') activeKey.value = 'dispatch'
}

function pickMapPoint(item: Aircraft) {
  selectAircraft(item)
}

/** 地图空白点选：作为调度目标坐标重算推荐（S2/S8 补强） */
function onMapPick(lng: number, lat: number) {
  targetPoint.value = { lng, lat }
  dispatchContext.value = {
    ...dispatchContext.value,
    lng,
    lat,
    label: `地图选点 ${lng.toFixed(4)}, ${lat.toFixed(4)}`,
  }
  focusRequest.value = { lng, lat, seq: ++focusSeq }
  if (activeKey.value !== 'dispatch') activeKey.value = 'dispatch'
  pushToast({ key: `pick-${Date.now()}`, title: '已按地图选点重算推荐', detail: `${lng.toFixed(4)}, ${lat.toFixed(4)} · 可在下方调整任务类型与优先级`, kind: 'info' })
}

/** 设备下线/恢复后同步地图飞机数据 */
function syncAircraft(item: Aircraft) {
  const index = aircraft.value.findIndex((entry) => entry.id === item.id)
  if (index >= 0) aircraft.value[index] = item
}

async function loadRoutes() {
  try {
    const [routeResponse, zoneResponse, aircraftResponse, shelterResponse] = await Promise.all([
      api<{ data: { rows: FlightRoute[] } }>('/v1/flight-routes'),
      api<{ data: { rows: NoFlyZone[] } }>('/v1/geo/no-fly-zones'),
      api<{ data: { rows: Aircraft[] } }>('/v1/aircraft'),
      api<{ data: { rows: Shelter[] } }>('/v1/shelters'),
    ])
    routes.value = routeResponse.data.rows
    zones.value = zoneResponse.data.rows
    aircraft.value = aircraftResponse.data.rows
    shelters.value = shelterResponse.data.rows
  } catch { /* 工作台底图为增强能力，失败不阻断作业 */ }
}

async function previewWorkOrderRoute(lineName: string, aircraftName?: string) {
  const routeItem = routes.value.find((item) => item.name === lineName)
    ?? routes.value.find((item) => aircraftName && item.aircraftName === aircraftName)
  if (!routeItem) { pushToast({ key: `preview-miss-${lineName}`, title: '暂无航线预览', detail: `${lineName} 尚未配置空间轨迹`, kind: 'info' }); return }
  previewLoadingId.value = routeItem.id
  try {
    const response = await api<{ data: FlightReplay }>(`/v1/flight-routes/${routeItem.id}/preview`)
    replay.value = response.data
    replayDialogOpen.value = true
  } catch (reason) {
    pushToast({ key: `preview-fail-${routeItem.id}`, title: '计划预览失败', detail: reason instanceof Error ? reason.message : '请稍后重试', kind: 'info' })
  } finally {
    previewLoadingId.value = ''
  }
}

async function logout() {
  auth.logout()
  await router.push('/login')
}

watch(() => route.query, applyRouteQuery, { immediate: true })
onMounted(() => {
  void loadRoutes()
  connect({ onAircraft: (rows) => { aircraft.value = rows } })
})
</script>

<template>
  <main class="workbench-view">
    <header class="workbench-header">
      <div class="command-brand"><div class="brand-mark compact"><span>LA</span><i /></div><div><small>LOW-ALTITUDE OPERATIONS</small><h1>无人机低空指挥调度平台 · 作业工作台</h1></div></div>
      <div class="header-actions">
        <button type="button" title="返回指挥大屏" aria-label="返回指挥大屏" @click="router.push('/')"><ArrowLeft />大屏</button>
        <div class="user-badge"><UserRound /><span>{{ auth.userName || '指挥中心管理员' }}<small>市级指挥中心 · 作业员</small></span></div>
        <button type="button" title="退出登录" aria-label="退出登录" @click="logout"><LogOut /></button>
      </div>
    </header>

    <div class="workbench-body" :class="{ 'nav-collapsed': navCollapsed }">
      <nav class="workbench-nav" :class="{ collapsed: navCollapsed }" aria-label="作业功能导航">
        <button type="button" class="workbench-nav-toggle" :aria-label="navCollapsed ? '展开功能导航' : '折叠功能导航'" :aria-pressed="navCollapsed" :title="navCollapsed ? '展开功能导航' : '折叠功能导航'" @click="navCollapsed = !navCollapsed"><PanelLeftClose v-if="!navCollapsed" /><PanelLeftOpen v-else /><span>收起导航</span></button>
        <button v-for="item in navItems" :key="item.key" type="button" class="workbench-nav-item" :class="{ active: activeKey === item.key, disabled: item.disabled }" :disabled="item.disabled" :aria-pressed="activeKey === item.key" :title="item.disabled ? item.desc : item.label" @click="item.disabled ? undefined : activeKey = item.key as WorkbenchKey">
          <component :is="item.icon" /><span><b>{{ item.label }}</b><small>{{ item.desc }}</small></span>
        </button>
        <div class="workbench-nav-hint"><MonitorDot />大屏展示与作业操作已分离。点地图飞机可带入调度坐标；告警转单会预填工单页。</div>
      </nav>

      <section class="workbench-content">
        <div class="workbench-map">
          <header>
            <span>作业态势</span>
            <div class="map-header-tools">
              <template v-if="planning">
                <span class="planning-hint"><RouteIcon />规划中 · {{ planPoints.length }} 点</span>
                <input v-model="planName" class="plan-name-input" type="text" maxlength="40" placeholder="航线名称" aria-label="航线名称" @keydown.enter="savePlan" />
                <button type="button" class="map-tool-btn primary" :disabled="savingPlan" aria-label="保存航线" @click="savePlan"><Save />{{ savingPlan ? '保存中…' : '保存' }}</button>
                <button type="button" class="map-tool-btn" aria-label="取消规划" @click="togglePlanning">取消</button>
              </template>
              <template v-else>
                <button type="button" class="map-tool-btn" :class="{ active: planning }" aria-label="进入航线规划" title="在地图上点击航点规划新航线" @click="togglePlanning"><RouteIcon />规划航线</button>
              </template>
            </div>
          </header>
          <OperationsMap :aircraft="aircraft" :connected="connected" :selected-id="selectedId" :zones="zones" :conflicts="conflictPairs" :target="targetPoint" :shelters="shelters" :planning="planning" :plan-points="planPoints" :focus="focusRequest" @select="pickMapPoint" @pick="onMapPick" @plan-point="onPlanPoint" @shelter-select="onShelterDispatch" @clear="selectedId = ''" />
        </div>

        <PanelShell class="workbench-panel" :title="panelTitle" :eyebrow="panelEyebrow">
          <DispatchPanel v-if="activeKey === 'dispatch'" :task-type="dispatchContext.taskType" :lng="dispatchContext.lng" :lat="dispatchContext.lat" :priority="dispatchContext.priority" :label="dispatchContext.label" :preferred-id="preferredAircraftId" @dispatched="onDispatched" />
          <WorkOrderPanel v-else-if="activeKey === 'workorder'" :highlight-id="highlightTicket" @preview-route="previewWorkOrderRoute" />
          <HealthPanel v-else-if="activeKey === 'health'" @created="onWorkOrderCreated" @aircraft-changed="syncAircraft" />
          <AiEventsPanel v-else @dispatch="onAiDispatch" />
        </PanelShell>
      </section>
    </div>

    <Teleport to="body">
      <TransitionGroup name="toast" tag="div" class="alert-toasts" aria-live="polite">
        <article v-for="toast in toasts" :key="toast.key" class="alert-toast" :class="`toast-${toast.kind}`">
          <div class="toast-inline"><CheckCircle2 /><div><b>{{ toast.title }}</b><small>{{ toast.detail }}</small></div></div>
          <button type="button" class="toast-close" :aria-label="`关闭 ${toast.title}`" @click="dismissToast(toast.key)"><X /></button>
        </article>
      </TransitionGroup>
    </Teleport>
    <ReplayDialog v-if="replayDialogOpen && replay" :replay="replay" @close="replayDialogOpen = false" />
  </main>
</template>

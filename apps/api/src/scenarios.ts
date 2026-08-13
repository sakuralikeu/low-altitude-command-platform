/** 场景模块：智能调度推荐 / 工单闭环 / 设备健康 / 识别事件 / 实时合规检测 */
import { aircraft, dispatchRoutes, dispatchTargets, flightRoutes, organizations, type Aircraft } from './data.js'
import { distanceToPolygon, findZoneViolations, haversineMeters, noFlyZones } from './geo.js'

/* ========== 机型参数（额定续航，演示口径） ========== */
export const aircraftModels: Record<string, { ratedMinutes: number; cruiseMps: number; capability: string[] }> = {
  'M350 RTK': { ratedMinutes: 55, cruiseMps: 12, capability: ['patrol', 'inspect', 'emergency'] },
  'M30T': { ratedMinutes: 41, cruiseMps: 10, capability: ['patrol', 'inspect'] },
  'M3E': { ratedMinutes: 45, cruiseMps: 12, capability: ['inspect', 'emergency'] },
}
export const RETURN_SAFETY_FACTOR = 1.25
export const LOW_BATTERY_THRESHOLD = 40

/* ========== S4 电量续航预测 ========== */
export type EndurancePrediction = {
  remainingMinutes: number
  returnBatteryThreshold: number
  advisedToReturn: boolean
}

export function predictEndurance(item: Aircraft, targetLng?: number, targetLat?: number): EndurancePrediction {
  const model = aircraftModels[item.model] ?? aircraftModels['M350 RTK']!
  const remainingMinutes = Number((item.batteryPercent * (model.ratedMinutes / 100)).toFixed(1))
  let returnBatteryThreshold = 15
  if (targetLng !== undefined && targetLat !== undefined) {
    const distanceM = haversineMeters([item.longitude, item.latitude], [targetLng, targetLat])
    const returnMinutes = (distanceM / model.cruiseMps) / 60
    returnBatteryThreshold = Number((((returnMinutes / model.ratedMinutes) * 100) * RETURN_SAFETY_FACTOR).toFixed(1))
  }
  return { remainingMinutes, returnBatteryThreshold, advisedToReturn: item.batteryPercent <= returnBatteryThreshold }
}

/* ========== S2+S8 智能调度推荐引擎 ========== */
export type TaskType = 'patrol' | 'inspect' | 'emergency'
export type DispatchCandidate = {
  aircraftId: string
  name: string
  model: string
  status: string
  score: number
  reasons: string[]
  etaMinutes: number
  batteryPercent: number
  distanceM: number
}

const WEIGHTS = { patrol: { distance: 0.4, battery: 0.3, idle: 0.2, capability: 0.1 }, inspect: { distance: 0.45, battery: 0.3, idle: 0.15, capability: 0.1 }, emergency: { distance: 0.6, battery: 0.25, idle: 0.1, capability: 0.05 } }

/** 该飞机是否已有未完结工单（待接收/已接收/执行中）——防重复派发 */
function hasActiveWorkOrder(aircraftName: string): boolean {
  return workOrders.some((order) => order.aircraftName === aircraftName && order.status !== 'completed')
}

export function recommendDispatch(taskType: TaskType, lng: number, lat: number, priority: 'normal' | 'high' = 'normal'): DispatchCandidate[] {
  const weight = WEIGHTS[taskType]
  const scored = aircraft
    .filter((item) => {
      const model = aircraftModels[item.model]
      if (!model || !model.capability.includes(taskType)) return false
      if (item.offline) return false
      if (hasActiveWorkOrder(item.name)) return false
      if (item.batteryPercent < 25) return false
      if (item.status === 'standby') return true
      if (item.status === 'warning' && (item.batteryPercent < 30 || item.task === '应急现场勘察')) return false
      return true
    })
    .map((item) => {
      const distanceM = haversineMeters([item.longitude, item.latitude], [lng, lat])
      const batteryScore = item.batteryPercent / 100
      const idleScore = item.status === 'standby' ? 1 : item.status === 'flying' ? 0.35 : 0.5
      const model = aircraftModels[item.model]!
      const capabilityScore = model.capability.includes('emergency') ? 1 : 0.6
      const distanceScore = Math.max(0, 1 - distanceM / 12000)
      const score = Number((distanceScore * weight.distance + batteryScore * weight.battery + idleScore * weight.idle + capabilityScore * weight.capability).toFixed(3))
      const etaMinutes = Math.max(1, Math.round((distanceM / (model.cruiseMps * 60)) * 10) / 10)
      const prediction = predictEndurance(item, lng, lat)
      const reasons: string[] = []
      reasons.push(`距目标 ${(distanceM / 1000).toFixed(1)}km`)
      reasons.push(`电量 ${item.batteryPercent}% · 预计可飞 ${prediction.remainingMinutes}min`)
      if (item.status === 'standby') reasons.push('处于待命状态，可即刻起飞')
      else reasons.push('执行中，预计可中途转场')
      if (taskType === 'emergency') reasons.push('机型具备应急任务能力')
      return { aircraftId: item.id, name: item.name, model: item.model, status: item.status, score, reasons, etaMinutes, batteryPercent: item.batteryPercent, distanceM: Math.round(distanceM) }
    })
    .sort((a, b) => b.score - a.score)
  const limit = taskType === 'emergency' ? 3 : 5
  return scored.slice(0, limit).map((item, index) => ({ ...item, score: Number(((item.score + Math.max(0, 5 - index) * 0.002)).toFixed(3)) }))
}

/**
 * 派发落地：飞机状态与任务目标联动（S2/S8 闭环）。
 * - standby/warning → flying，任务文本更新
 * - 记录任务目标点（或沿航线航点序列），SSE 快照将驱动飞机飞向目标（data.nextAircraftSnapshot）
 */
export function applyDispatch(aircraftId: string, targetLng: number, targetLat: number, taskLabel: string, waypoints?: Array<[number, number]>): Aircraft | null {
  const item = aircraft.find((entry) => entry.id === aircraftId)
  if (!item) return null
  if (item.status === 'standby') item.status = 'flying'
  if (item.status === 'warning') item.status = 'flying'
  item.task = taskLabel
  if (waypoints && waypoints.length >= 2) {
    // 沿航线执行：首航点为当前目标，其余入队依次飞行
    dispatchRoutes.set(aircraftId, waypoints.slice(1))
    dispatchTargets.set(aircraftId, { lng: waypoints[0]![0], lat: waypoints[0]![1] })
  } else {
    dispatchRoutes.delete(aircraftId)
    dispatchTargets.set(aircraftId, { lng: targetLng, lat: targetLat })
  }
  return item
}

/** 下线/恢复无人机：下线 = 停用（不参与调度/告警/移动），恢复 = 回到待命 */
export function setAircraftOffline(aircraftId: string, offline: boolean): Aircraft | null {
  const item = aircraft.find((entry) => entry.id === aircraftId)
  if (!item) return null
  item.offline = offline
  if (offline) {
    item.status = 'standby'
    item.task = '已下线'
    dispatchTargets.delete(aircraftId)
    dispatchRoutes.delete(aircraftId)
  } else if (item.task === '已下线') {
    item.task = '待命'
  }
  return item
}

/* ========== S7 工单闭环 ========== */
export type WorkOrderStatus = 'pending' | 'received' | 'executing' | 'completed'
export type WorkOrderSource = 'plan' | 'alert' | 'dispatch' | 'maintenance'
export type WorkOrder = {
  id: string
  title: string
  lineName: string
  orgName: string
  status: WorkOrderStatus
  createdAt: string
  dueAt: string
  aircraftName?: string
  source?: WorkOrderSource
  sourceAlertId?: string
}
const WORK_ORDER_FLOW: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  pending: ['received'],
  received: ['executing'],
  executing: ['completed'],
  completed: [],
}
const LINE_PLAN: Array<{ lineName: string; orgName: string; period: 'daily' | 'weekly' }> = [
  { lineName: '中心城区航线', orgName: '公安局', period: 'daily' },
  { lineName: '河道巡检航线', orgName: '水务局', period: 'daily' },
  { lineName: '重点道路巡检', orgName: '交通局', period: 'daily' },
  { lineName: '市容巡查航线', orgName: '城管局', period: 'weekly' },
  { lineName: '重点区域瞭望', orgName: '消防支队', period: 'weekly' },
]
let workOrders: WorkOrder[] = [
  { id: 'WO-20260812-001', title: '中心城区治安巡航', lineName: '中心城区航线', orgName: '公安局', status: 'executing', createdAt: '2026-08-12 08:00:00', dueAt: '2026-08-12 18:00:00', aircraftName: '公安-01' },
  { id: 'WO-20260812-002', title: '河道水质例行巡检', lineName: '河道巡检航线', orgName: '水务局', status: 'executing', createdAt: '2026-08-12 07:30:00', dueAt: '2026-08-12 17:30:00', aircraftName: '城巡-07' },
  { id: 'WO-20260812-003', title: '重点道路拥堵巡查', lineName: '重点道路巡检', orgName: '交通局', status: 'received', createdAt: '2026-08-12 09:00:00', dueAt: '2026-08-12 19:00:00' },
  { id: 'WO-20260812-004', title: '夜间市容占道巡查', lineName: '市容巡查航线', orgName: '城管局', status: 'pending', createdAt: '2026-08-12 10:00:00', dueAt: '2026-08-12 22:00:00' },
  { id: 'WO-20260812-005', title: '重点区域火情瞭望', lineName: '重点区域瞭望', orgName: '消防支队', status: 'received', createdAt: '2026-08-12 09:30:00', dueAt: '2026-08-12 20:00:00' },
  { id: 'WO-20260811-006', title: '滨江违法搭建巡查', lineName: '滨江巡查航线', orgName: '城管局', status: 'completed', createdAt: '2026-08-11 08:00:00', dueAt: '2026-08-11 18:00:00', aircraftName: '城巡-09' },
  { id: 'WO-20260811-007', title: '变电站周边巡检', lineName: '变电站环线', orgName: '消防支队', status: 'completed', createdAt: '2026-08-11 10:00:00', dueAt: '2026-08-11 16:00:00', aircraftName: '消防-05' },
  { id: 'WO-20260811-008', title: '防汛河道巡查', lineName: '河道巡检航线', orgName: '水务局', status: 'completed', createdAt: '2026-08-11 07:00:00', dueAt: '2026-08-11 15:00:00', aircraftName: '水务-02' },
  { id: 'WO-20260810-009', title: '主干道早晚高峰巡查', lineName: '重点道路巡检', orgName: '交通局', status: 'completed', createdAt: '2026-08-10 07:30:00', dueAt: '2026-08-10 20:30:00', aircraftName: '交通-12' },
  { id: 'WO-20260810-010', title: '重点小区治安巡飞', lineName: '中心城区航线', orgName: '公安局', status: 'completed', createdAt: '2026-08-10 09:00:00', dueAt: '2026-08-10 21:00:00', aircraftName: '海巡-01' },
  { id: 'WO-20260809-011', title: '施工扬尘监测', lineName: '市容巡查航线', orgName: '城管局', status: 'completed', createdAt: '2026-08-09 08:00:00', dueAt: '2026-08-09 18:00:00', aircraftName: '城巡-09' },
  { id: 'WO-20260809-012', title: '河道排污口核查', lineName: '河道巡检航线', orgName: '水务局', status: 'completed', createdAt: '2026-08-09 07:30:00', dueAt: '2026-08-09 17:30:00', aircraftName: '水务-02' },
]
export function getWorkOrders(status?: WorkOrderStatus) {
  const rows = status ? workOrders.filter((item) => item.status === status) : workOrders
  const totals = Object.fromEntries((['pending', 'received', 'executing', 'completed'] as WorkOrderStatus[]).map((key) => [key, workOrders.filter((item) => item.status === key).length]))
  return { rows, totals }
}
export function transitionWorkOrder(id: string, to: WorkOrderStatus): WorkOrder {
  const order = workOrders.find((item) => item.id === id)
  if (!order) throw new Error('工单不存在')
  if (!WORK_ORDER_FLOW[order.status].includes(to)) throw new Error(`不允许从 ${order.status} 流转到 ${to}`)
  order.status = to
  // 工单 → 飞机状态联动（S7 闭环）：执行中 = 飞机出动；结案 = 飞机释放回待命
  const item = order.aircraftName ? aircraft.find((entry) => entry.name === order.aircraftName) : undefined
  if (item) {
    if (to === 'executing') {
      if (item.status === 'standby' || item.status === 'warning') item.status = 'flying'
      item.task = order.title
    }
    if (to === 'completed') {
      item.status = 'standby'
      item.task = '待命'
      dispatchTargets.delete(item.id)
      dispatchRoutes.delete(item.id)
      // 释放被该飞机占用的规划航线（active → planned），首页航线目录同步
      const usedRoute = flightRoutes.find((route) => route.usedByAircraftId === item.id)
      if (usedRoute) {
        usedRoute.status = 'planned'
        usedRoute.usedByAircraftId = undefined
      }
    }
  }
  return order
}

function nextWorkOrderId(now = new Date()) {
  const dateTag = now.toISOString().slice(0, 10).replaceAll('-', '')
  const sameDay = workOrders.filter((item) => item.id.startsWith(`WO-${dateTag}-`)).length
  return `WO-${dateTag}-${String(sameDay + 1).padStart(3, '0')}`
}

function formatDateTime(value: Date) {
  return value.toISOString().slice(0, 19).replace('T', ' ')
}

/** 从告警 / 派发 / 保养创建待接收工单，形成闭环 */
export function createWorkOrder(input: {
  title: string
  lineName?: string
  orgName?: string
  aircraftName?: string
  source?: WorkOrderSource
  sourceAlertId?: string
}): WorkOrder {
  const now = new Date()
  const due = new Date(now.getTime() + 12 * 3600_000)
  const order: WorkOrder = {
    id: nextWorkOrderId(now),
    title: input.title,
    lineName: input.lineName ?? '临时任务航线',
    orgName: input.orgName ?? '市级指挥中心',
    status: 'pending',
    createdAt: formatDateTime(now),
    dueAt: formatDateTime(due),
    aircraftName: input.aircraftName,
    source: input.source ?? 'plan',
    sourceAlertId: input.sourceAlertId,
  }
  workOrders = [order, ...workOrders]
  return order
}
/** 按航线周期自动生成下一轮巡检工单（S7） */
export function generateWorkOrders(period: 'daily' | 'weekly'): { generated: number; skipped: number; message: string } {
  const now = new Date()
  let generated = 0
  let skipped = 0
  for (const plan of LINE_PLAN) {
    if (plan.period !== period) continue
    const exists = workOrders.some((item) => item.lineName === plan.lineName && item.createdAt.slice(0, 10) === now.toISOString().slice(0, 10))
    if (exists) { skipped += 1; continue }
    createWorkOrder({
      title: `${plan.orgName}${period === 'daily' ? '日常' : '周期'}巡检计划`,
      lineName: plan.lineName,
      orgName: plan.orgName,
      source: 'plan',
    })
    generated += 1
  }
  const message = generated > 0
    ? `已生成 ${generated} 条${period === 'daily' ? '今日' : '周期'}巡检工单${skipped ? `，跳过 ${skipped} 条已存在计划` : ''}`
    : `今日计划已齐全，${skipped} 条航线无需重复生成`
  return { generated, skipped, message }
}

/* ========== S10 设备健康与维护预测 ========== */
const PART_LIMITS = [
  { part: '电池组', key: 'batteryCycles', limit: 300, unit: '循环' },
  { part: '电机', key: 'motorHours', limit: 800, unit: 'h' },
  { part: '螺旋桨', key: 'propellerHours', limit: 400, unit: 'h' },
]
export type AircraftHealth = {
  aircraftId: string
  name: string
  model: string
  flightHours: number
  totalFlights: number
  healthScore: number
  parts: Array<{ part: string; limit: number; used: number; remainingPercent: number; advice: string }>
}
const HEALTH_SEED: Record<string, { flightHours: number; totalFlights: number; batteryCycles: number }> = {
  'UAV-01': { flightHours: 612, totalFlights: 168, batteryCycles: 96 },
  'UAV-02': { flightHours: 588, totalFlights: 151, batteryCycles: 88 },
  'UAV-03': { flightHours: 745, totalFlights: 196, batteryCycles: 142 },
  'UAV-04': { flightHours: 320, totalFlights: 84, batteryCycles: 52 },
  'UAV-05': { flightHours: 496, totalFlights: 128, batteryCycles: 74 },
  'UAV-06': { flightHours: 660, totalFlights: 172, batteryCycles: 104 },
  'UAV-07': { flightHours: 410, totalFlights: 106, batteryCycles: 61 },
  'UAV-08': { flightHours: 703, totalFlights: 183, batteryCycles: 118 },
  'UAV-09': { flightHours: 266, totalFlights: 68, batteryCycles: 40 },
  'UAV-10': { flightHours: 501, totalFlights: 132, batteryCycles: 79 },
}
export function getAircraftHealth(): AircraftHealth[] {
  return aircraft.map((item) => {
    const seed = HEALTH_SEED[item.id] ?? { flightHours: 300, totalFlights: 80, batteryCycles: 60 }
    const parts = PART_LIMITS.map((rule) => {
      const used = rule.key === 'batteryCycles' ? seed.batteryCycles : rule.key === 'motorHours' ? seed.flightHours : seed.flightHours * 1.1
      const remainingPercent = Math.max(0, Math.round(((rule.limit - used) / rule.limit) * 100))
      const remainingHours = Math.max(0, Math.round(rule.limit - used))
      return {
        part: rule.part,
        limit: rule.limit,
        used: Math.round(used),
        remainingPercent,
        advice: remainingPercent < 15 ? `近期需保养${rule.part}（剩余约 ${remainingHours}${rule.unit}）` : `状态正常，剩余约 ${remainingHours}${rule.unit}`,
      }
    })
    const healthScore = Math.max(45, Math.round(100 - (seed.flightHours / 1500) * 40 - (seed.batteryCycles / 300) * 30))
    return { aircraftId: item.id, name: item.name, model: item.model, flightHours: seed.flightHours, totalFlights: seed.totalFlights, healthScore, offline: item.offline ?? false, parts }
  })
}

/* ========== S6 识别事件（演示数据，待接入识别模型） ========== */
export type AiRecognitionEvent = {
  id: string
  kind: 'traffic' | 'smoke' | 'gathering' | 'parking'
  label: string
  confidence: number
  status: 'reviewing' | 'confirmed' | 'archived'
  aircraftName: string
  occurredAt: string
  location: string
  longitude: number
  latitude: number
  description: string
}
export const aiRecognitionEvents: AiRecognitionEvent[] = [
  { id: 'AI-0821', kind: 'traffic', label: '道路交通事故（追尾）', confidence: 0.93, status: 'confirmed', aircraftName: '海巡-01', occurredAt: '2026-08-12 14:52:00', location: '滨江大道与龙华路交叉口', longitude: 121.462, latitude: 31.217, description: '检测到两辆机动车尾部碰撞，车辆停靠在最外侧车道，疑似有散落物。建议交警尽快到场疏解。' },
  { id: 'AI-0820', kind: 'gathering', label: '人员聚集（疑似纠纷）', confidence: 0.78, status: 'reviewing', aircraftName: '公安-01', occurredAt: '2026-08-12 13:40:00', location: '中央公园南门广场', longitude: 121.4737, latitude: 31.2304, description: '识别到约 8–12 人聚集并伴有肢体接触迹象，持续约 3 分钟。置信度中等，建议人工复核后再处置。' },
  { id: 'AI-0819', kind: 'smoke', label: '烟雾/火情疑似（建筑工地）', confidence: 0.88, status: 'confirmed', aircraftName: '消防-05', occurredAt: '2026-08-12 11:05:00', location: '北区工业园 3 号地块', longitude: 121.483, latitude: 31.242, description: '工地塔吊区域出现连续灰色烟柱并向上扩散，疑似露天焚烧或初期火情，建议消防联动核查。' },
  { id: 'AI-0818', kind: 'parking', label: '主干道违规停车', confidence: 0.96, status: 'archived', aircraftName: '交通-12', occurredAt: '2026-08-12 09:22:00', location: '中山路东段公交站旁', longitude: 121.507, latitude: 31.242, description: '识别到两辆机动车占用公交专用道长时间停放，已转派交警处置并归档。' },
  { id: 'AI-0817', kind: 'traffic', label: '车道拥堵异常', confidence: 0.91, status: 'archived', aircraftName: '城巡-07', occurredAt: '2026-08-12 08:10:00', location: '内环高架下匝道口', longitude: 121.488, latitude: 31.228, description: '早高峰时段下匝道车流出现异常排队，持续时间超过 15 分钟，已通知交管中心关注。' },
  { id: 'AI-0816', kind: 'smoke', label: '秸秆焚烧疑似', confidence: 0.72, status: 'reviewing', aircraftName: '城巡-09', occurredAt: '2026-08-11 17:45:00', location: '南区农田边界', longitude: 121.478, latitude: 31.205, description: '农田边界出现低密度白色烟雾，面积较小且扩散缓慢。置信度较低，需人工复核是否为合规焚烧。' },
  { id: 'AI-0815', kind: 'gathering', label: '广场人群聚集', confidence: 0.84, status: 'archived', aircraftName: '公安-01', occurredAt: '2026-08-11 16:30:00', location: '文化广场喷泉区', longitude: 121.486, latitude: 31.238, description: '喷泉周边人群聚集，密度较高但无异常行为迹象，已归档作为人流监测记录。' },
  { id: 'AI-0814', kind: 'parking', label: '消防通道占用', confidence: 0.95, status: 'confirmed', aircraftName: '消防-05', occurredAt: '2026-08-11 10:12:00', location: '江景小区消防通道', longitude: 121.495, latitude: 31.226, description: '小区消防通道被两辆轿车占用，存在安全隐患，已确认并转派物业与消防部门核查。' },
]

const AI_EVENT_FLOW: Record<AiRecognitionEvent['status'], Array<AiRecognitionEvent['status']>> = {
  reviewing: ['confirmed'],
  confirmed: ['archived'],
  archived: [],
}

export function transitionAiEvent(id: string, to: AiRecognitionEvent['status']): AiRecognitionEvent {
  const event = aiRecognitionEvents.find((item) => item.id === id)
  if (!event) throw new Error('事件不存在')
  if (!AI_EVENT_FLOW[event.status].includes(to)) throw new Error(`不允许从 ${event.status} 流转到 ${to}`)
  event.status = to
  return event
}

/* ========== 实时合规检测（SSE 事件源） ========== */
export type RealtimeAlertEvent =
  | { type: 'nofly'; zoneId: string; zoneName: string; aircraft: Aircraft }
  | { type: 'conflict'; a: Aircraft; b: Aircraft; horizontalM: number; verticalM: number; severity: 'watch' | 'critical' }
  | { type: 'low-battery'; aircraft: Aircraft; remainingMinutes: number; threshold: number }

const CONFLICT_WATCH_M = 900
const CONFLICT_CRITICAL_M = 450
const CONFLICT_VERTICAL_M = 80

export type ConflictPair = { a: Aircraft; b: Aircraft; horizontalM: number; verticalM: number; severity: 'watch' | 'critical' }

export function computeConflicts(snapshot: Aircraft[]): ConflictPair[] {
  const pairs: ConflictPair[] = []
  const flying = snapshot.filter((item) => item.status !== 'standby' && !item.offline)
  for (let i = 0; i < flying.length; i++) {
    for (let j = i + 1; j < flying.length; j++) {
      const a = flying[i]!
      const b = flying[j]!
      const horizontalM = Math.round(haversineMeters([a.longitude, a.latitude], [b.longitude, b.latitude]))
      const verticalM = Math.abs(a.altitudeM - b.altitudeM)
      if (horizontalM < CONFLICT_WATCH_M && verticalM < CONFLICT_VERTICAL_M) {
        pairs.push({ a, b, horizontalM, verticalM, severity: horizontalM < CONFLICT_CRITICAL_M ? 'critical' : 'watch' })
      }
    }
  }
  return pairs
}

export function detectRealtimeAlerts(snapshot: Aircraft[], previous: Map<string, string>): RealtimeAlertEvent[] {
  const events: RealtimeAlertEvent[] = []
  const flying = snapshot.filter((item) => item.status !== 'standby' && !item.offline)

  // 禁飞区违规（同一架飞机同一区域只报一次，直至离开）
  for (const item of flying) {
    const violations = findZoneViolations([item.longitude, item.latitude])
    for (const zone of violations) {
      const key = `${item.id}:${zone.id}`
      if (previous.get(key) === 'active') continue
      previous.set(key, 'active')
      events.push({ type: 'nofly', zoneId: zone.id, zoneName: zone.name, aircraft: item })
    }
  }
  // 离开后清除状态（仅处理禁飞区 key，conflict/battery 由各自逻辑维护）
  for (const key of previous.keys()) {
    if (key.startsWith('conflict:') || key.startsWith('battery:')) continue
    const [aircraftId, zoneId] = key.split(':')
    const item = snapshot.find((entry) => entry.id === aircraftId)
    const stillInside = item && findZoneViolations([item.longitude, item.latitude]).some((zone) => zone.id === zoneId)
    if (!stillInside) previous.delete(key)
  }

  // 两两冲突检测（同对只报一次，解除后清除状态可再次触发）
  const activeConflicts = new Set<string>()
  for (const pair of computeConflicts(snapshot)) {
    const key = `conflict:${pair.a.id}:${pair.b.id}`
    activeConflicts.add(key)
    if (previous.get(key) === 'active') continue
    previous.set(key, 'active')
    events.push({ type: 'conflict', a: pair.a, b: pair.b, horizontalM: pair.horizontalM, verticalM: pair.verticalM, severity: pair.severity })
  }
  for (const key of previous.keys()) {
    if (key.startsWith('conflict:') && !activeConflicts.has(key)) previous.delete(key)
  }

  // 低电量预警（每架仅报一次，避免重复轰炸）
  for (const item of flying) {
    const prediction = predictEndurance(item)
    if (item.batteryPercent <= LOW_BATTERY_THRESHOLD) {
      const key = `battery:${item.id}`
      if (previous.get(key) === 'active') continue
      previous.set(key, 'active')
      events.push({ type: 'low-battery', aircraft: item, remainingMinutes: prediction.remainingMinutes, threshold: LOW_BATTERY_THRESHOLD })
    }
  }
  return events
}

export { noFlyZones, distanceToPolygon }
export const organizationsList = organizations

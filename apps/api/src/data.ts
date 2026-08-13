import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Period = 'today' | 'week' | 'month' | 'year' | 'all'
export type TaskStatus = 'dispatched' | 'dispatching' | 'received' | 'completed'

export const overview = {
  shelterNum: 11,
  flyLineNum: 48,
  achieveNum: 156,
  flyerNum: 12,
  workOrderNum: 50,
  recordCount: 168,
  flyPlaneNum: 60,
  flightLength: 1392.47,
  durationHours: 35.1,
  generatedAt: '2026-08-12T09:30:00+08:00',
  dataFreshness: 'FRESH' as const,
}

export const flightRecords = [
  ['1010', '巡检飞行记录-山区线路', '山区巡检航线', '2026-08-12 15:40:00', '1号方舱'],
  ['1009', '巡检飞行记录-河流区域', '河道巡检航线', '2026-08-12 07:50:00', '2号方舱'],
  ['1007', '夜间巡检-高压线路', '高压走廊航线', '2026-08-11 20:10:00', '4号方舱'],
  ['1008', '巡检飞行记录-变电站周边', '变电站环线', '2026-08-11 11:25:00', '3号方舱'],
  ['1006', '日常巡检-中心区域', '中心城区航线', '2026-08-10 16:30:00', '1号方舱'],
  ['1005', '应急巡检-故障点A', '应急指点飞行', '2026-08-10 08:00:00', '2号方舱'],
  ['1004', '巡检飞行记录-北区线路', '北区巡检航线', '2026-08-09 13:45:00', '3号方舱'],
  ['1003', '巡检飞行记录-南区线路', '南区巡检航线', '2026-08-09 09:15:00', '1号方舱'],
  ['1002', '巡检飞行记录-西区线路', '西区巡检航线', '2026-08-08 14:20:00', '2号方舱'],
  ['1001', '巡检飞行记录-东区线路', '东区巡检航线', '2026-08-08 10:30:00', '1号方舱'],
].map(([id, name, routeName, executedAt, deviceName]) => ({ id, name, routeName, executedAt, deviceName }))

export type FlightTrackPoint = { longitude: number; latitude: number; altitudeM: number; speedMps: number; elapsedSeconds: number }
export type FlightReplay = {
  recordId: string
  mode: 'replay' | 'preview'
  aircraftId?: string
  aircraftName: string
  routeName: string
  startedAt: string
  durationSeconds: number
  planned: FlightTrackPoint[]
  actual: FlightTrackPoint[]
  demo: true
}

export type FlightRoute = {
  id: string
  name: string
  orgName: string
  aircraftId: string
  aircraftName: string
  distanceKm: number
  durationMinutes: number
  altitudeM: number
  status: 'active' | 'planned'
  latestRecordId?: string
  /** 规划航线：航点序列（地图画线保存；历史数据无） */
  waypoints?: LngLat[]
  /** 当前被哪架飞机执行（派发沿航线时写入，工单结案释放） */
  usedByAircraftId?: string
  /** 用户在地图画线创建的航线：参与 JSON 文件持久化（重启不丢） */
  userCreated?: boolean
}

export const flightRoutes: FlightRoute[] = [
  { id: 'RT-001', name: '中心城区航线', orgName: '公安局', aircraftId: 'UAV-05', aircraftName: '公安-01', distanceKm: 18.6, durationMinutes: 32, altitudeM: 72, status: 'active', latestRecordId: '1006' },
  { id: 'RT-002', name: '河道巡检航线', orgName: '水务局', aircraftId: 'UAV-02', aircraftName: '城巡-07', distanceKm: 24.2, durationMinutes: 41, altitudeM: 64, status: 'active', latestRecordId: '1009' },
  { id: 'RT-003', name: '重点道路巡检', orgName: '交通局', aircraftId: 'UAV-01', aircraftName: '海巡-01', distanceKm: 16.8, durationMinutes: 29, altitudeM: 78, status: 'active' },
  { id: 'RT-004', name: '市容巡查航线', orgName: '城管局', aircraftId: 'UAV-08', aircraftName: '城巡-09', distanceKm: 13.5, durationMinutes: 25, altitudeM: 68, status: 'active' },
  { id: 'RT-005', name: '重点区域瞭望', orgName: '消防支队', aircraftId: 'UAV-06', aircraftName: '消防-05', distanceKm: 11.9, durationMinutes: 22, altitudeM: 58, status: 'active' },
  { id: 'RT-006', name: '变电站环线', orgName: '应急管理局', aircraftId: 'UAV-03', aircraftName: '应急-03', distanceKm: 9.8, durationMinutes: 19, altitudeM: 82, status: 'planned', latestRecordId: '1008' },
  { id: 'RT-007', name: '高压走廊航线', orgName: '供电公司', aircraftId: 'UAV-10', aircraftName: '应急-08', distanceKm: 27.4, durationMinutes: 46, altitudeM: 92, status: 'planned', latestRecordId: '1007' },
  { id: 'RT-008', name: '山区巡检航线', orgName: '自然资源局', aircraftId: 'UAV-04', aircraftName: '交通-12', distanceKm: 31.2, durationMinutes: 52, altitudeM: 108, status: 'planned', latestRecordId: '1010' },
]

/* ===== 用户规划航线持久化（JSON 文件，Docker 挂载 /data；未挂载时静默降级为内存态） ===== */
const ROUTES_FILE = process.env.ROUTES_FILE || '/data/flight-routes.json'

/** 启动时恢复用户规划航线（持久化文件存在则合并进目录） */
loadUserRoutes()

/** 按名称关键词过滤航线（大屏/作业台搜索共用） */
export function filterFlightRoutes(query: string): FlightRoute[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return flightRoutes
  return flightRoutes.filter((route) => route.name.toLowerCase().includes(keyword) || route.orgName.toLowerCase().includes(keyword))
}

/** 启动时加载用户创建的航线（合并到内存目录，按 id 去重） */
function loadUserRoutes() {
  try {
    const parsed = JSON.parse(readFileSync(ROUTES_FILE, 'utf8')) as FlightRoute[]
    for (const route of parsed) {
      if (route.userCreated && route.waypoints && !flightRoutes.some((item) => item.id === route.id)) {
        flightRoutes.push(route)
      }
    }
  } catch { /* 首次启动或文件不存在：使用默认演示数据 */ }
}

/** 持久化用户创建的航线（创建/状态变化后调用） */
export function persistUserRoutes() {
  try {
    mkdirSync(dirname(ROUTES_FILE), { recursive: true })
    writeFileSync(ROUTES_FILE, JSON.stringify(flightRoutes.filter((route) => route.userCreated), null, 2))
  } catch { /* 只读环境（未挂载 volume）：内存态兜底 */ }
}

/**
 * 创建规划航线（地图画线保存，S2 派发可选沿航线执行）。
 * 航点 ≥2 个，距离/时长按 Haversine 与巡航速度 12m/s 推算；id 顺序自增；写入持久化文件。
 */
export function createFlightRoute(input: { name: string; waypoints: LngLat[]; altitudeM?: number }): FlightRoute | undefined {
  const name = input.name.trim()
  if (!name || input.waypoints.length < 2) return undefined
  const totalM = input.waypoints.slice(1).reduce((sum, to, index) => sum + haversineMeters(input.waypoints[index]!, to), 0)
  const route: FlightRoute = {
    id: `RT-${String(flightRoutes.length + 1).padStart(3, '0')}`,
    name,
    orgName: '市级指挥中心',
    aircraftId: '',
    aircraftName: '',
    distanceKm: Number((totalM / 1000).toFixed(1)),
    durationMinutes: Math.max(1, Math.round((totalM / (12 * 60)) / 60)),
    altitudeM: input.altitudeM ?? 80,
    status: 'planned',
    waypoints: input.waypoints,
    userCreated: true,
  }
  flightRoutes.push(route)
  persistUserRoutes()
  return route
}

type LngLat = [number, number]

/** 各航线几何模板（[lng, lat] 折线航点），使不同航线在回放/预览时呈现不同的形状 */
const ROUTE_WAYPOINTS: Record<string, LngLat[]> = {
  river: [[121.44, 31.2], [121.45, 31.21], [121.458, 31.205], [121.468, 31.216], [121.477, 31.21], [121.487, 31.222], [121.498, 31.215], [121.508, 31.226]],
  corridor: [[121.432, 31.245], [121.455, 31.245], [121.455, 31.228], [121.488, 31.228], [121.488, 31.21], [121.512, 31.21]],
  mountain: [[121.44, 31.235], [121.452, 31.222], [121.462, 31.238], [121.472, 31.225], [121.482, 31.241], [121.492, 31.228], [121.502, 31.243]],
  substation: [[121.455, 31.228], [121.47, 31.228], [121.47, 31.24], [121.455, 31.24], [121.455, 31.228]],
  grid: [[121.462, 31.218], [121.482, 31.218], [121.482, 31.232], [121.472, 31.232], [121.472, 31.246], [121.462, 31.246], [121.462, 31.218]],
  road: [[121.446, 31.216], [121.458, 31.222], [121.47, 31.226], [121.483, 31.23], [121.495, 31.236], [121.507, 31.242]],
  cityscape: [[121.458, 31.205], [121.472, 31.205], [121.472, 31.218], [121.458, 31.218], [121.458, 31.205]],
  loiter: [[121.48, 31.24], [121.486, 31.238], [121.488, 31.232], [121.485, 31.226], [121.478, 31.226], [121.474, 31.232], [121.48, 31.24]],
  emergency: [[121.452, 31.21], [121.46, 31.222], [121.452, 31.234], [121.472, 31.242]],
  north: [[121.47, 31.248], [121.488, 31.24], [121.5, 31.25]],
  south: [[121.462, 31.202], [121.478, 31.205], [121.49, 31.198]],
  west: [[121.435, 31.222], [121.44, 31.235], [121.432, 31.248]],
  east: [[121.495, 31.228], [121.505, 31.236], [121.512, 31.226]],
}

/** 航线名 → 几何模板 */
const ROUTE_SHAPE: Record<string, string> = {
  中心城区航线: 'grid',
  河道巡检航线: 'river',
  重点道路巡检: 'road',
  市容巡查航线: 'cityscape',
  重点区域瞭望: 'loiter',
  变电站环线: 'substation',
  高压走廊航线: 'corridor',
  山区巡检航线: 'mountain',
  应急指点飞行: 'emergency',
  北区巡检航线: 'north',
  南区巡检航线: 'south',
  西区巡检航线: 'west',
  东区巡检航线: 'east',
}

function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (value: number) => value * Math.PI / 180
  const R = 6371000
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function sampleWaypoints(waypoints: LngLat[], pointCount: number, altitudeM: number, durationSeconds: number): FlightTrackPoint[] {
  const segments = waypoints.slice(1).map((to, index) => {
    const from = waypoints[index]!
    return { from, to, length: haversineMeters(from, to) }
  })
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  return Array.from({ length: pointCount }, (_, index) => {
    const target = total > 0 ? (index / (pointCount - 1)) * total : 0
    let acc = 0
    let lng = waypoints[0]![0]
    let lat = waypoints[0]![1]
    for (const segment of segments) {
      if (acc + segment.length >= target || segment === segments[segments.length - 1]) {
        const t = segment.length > 0 ? (target - acc) / segment.length : 1
        const clamped = Math.max(0, Math.min(1, t))
        lng = segment.from[0] + (segment.to[0] - segment.from[0]) * clamped
        lat = segment.from[1] + (segment.to[1] - segment.from[1]) * clamped
        break
      }
      acc += segment.length
      lng = segment.to[0]
      lat = segment.to[1]
    }
    return {
      longitude: Number(lng.toFixed(6)),
      latitude: Number(lat.toFixed(6)),
      altitudeM,
      speedMps: 11.5,
      elapsedSeconds: Math.round((index / (pointCount - 1)) * durationSeconds),
    }
  })
}

function createPlannedTrack(routeName: string, altitudeM: number, durationSeconds: number): FlightTrackPoint[] {
  const shapeKey = ROUTE_SHAPE[routeName] ?? 'grid'
  return sampleWaypoints(ROUTE_WAYPOINTS[shapeKey] ?? ROUTE_WAYPOINTS.grid!, 36, altitudeM, durationSeconds)
}

/** 基于记录编号生成可复现的演示轨迹，后续可由真实 IoT 历史轨迹接口替换。 */
export function getFlightReplay(recordId: string): FlightReplay | undefined {
  const recordIndex = flightRecords.findIndex((item) => item.id === recordId)
  if (recordIndex < 0) return undefined
  const record = flightRecords[recordIndex]!
  const route = flightRoutes.find((item) => item.name === record.routeName)
  const durationSeconds = (route?.durationMinutes ?? 12) * 60
  const planned = createPlannedTrack(record.routeName!, 78, durationSeconds)
  const actual = planned.map((point, index) => ({
    ...point,
    longitude: Number((point.longitude + Math.sin(index * 0.8 + recordIndex) * 0.0012).toFixed(6)),
    latitude: Number((point.latitude + Math.cos(index * 0.65 + recordIndex) * 0.0009).toFixed(6)),
    altitudeM: 72 + Math.round(Math.sin(index / 4) * 9),
    speedMps: Number((10.2 + Math.cos(index / 3) * 2.1).toFixed(1)),
  }))
  return {
    recordId,
    mode: 'replay',
    aircraftName: `${record.deviceName}无人机`,
    routeName: record.routeName!,
    startedAt: record.executedAt!,
    durationSeconds: actual.at(-1)?.elapsedSeconds ?? 0,
    planned,
    actual,
    demo: true,
  }
}

export function getFlightRoutePreview(routeId: string): FlightReplay | undefined {
  const routeIndex = flightRoutes.findIndex((item) => item.id === routeId)
  if (routeIndex < 0) return undefined
  const route = flightRoutes[routeIndex]!
  // 规划航线（地图画线）直接用真实航点采样；历史航线回退到几何模板
  const planned = route.waypoints && route.waypoints.length >= 2
    ? sampleWaypoints(route.waypoints, 36, route.altitudeM, route.durationMinutes * 60)
    : createPlannedTrack(route.name, route.altitudeM, route.durationMinutes * 60)
  return {
    recordId: route.id,
    mode: 'preview',
    aircraftId: route.aircraftId,
    aircraftName: route.aircraftName,
    routeName: route.name,
    startedAt: '待执行计划',
    durationSeconds: route.durationMinutes * 60,
    planned,
    actual: [],
    demo: true,
  }
}

const periodFactor: Record<Period, number> = { today: 0.08, week: 0.28, month: 1, year: 3.7, all: 5.4 }
export const organizations = [
  { id: '101', name: '江心洲', base: 50 },
  { id: '102', name: '水务局', base: 40 },
  { id: '103', name: '交通局', base: 30 },
  { id: '104', name: '公安局', base: 35 },
  { id: '105', name: '消防支队', base: 22 },
  { id: '106', name: '城管局', base: 26 },
]
const statusShare: Record<TaskStatus, number> = { dispatched: 0.2, dispatching: 0.3, received: 0.4, completed: 0.1 }

export function getTaskRanking(period: Period, status: TaskStatus) {
  const factor = periodFactor[period]
  const rows = organizations.map((org) => {
    const total = Math.max(1, Math.round(org.base * factor))
    return { id: org.id, name: org.name, total, value: Math.round(total * statusShare[status]) }
  })
  const totals = Object.fromEntries(
    (Object.keys(statusShare) as TaskStatus[]).map((key) => [key, rows.reduce((sum, row) => sum + Math.round(row.total * statusShare[key]), 0)]),
  ) as Record<TaskStatus, number>
  const selectedTotal = rows.reduce((sum, row) => sum + row.value, 0)
  return {
    period,
    status,
    totals,
    rows: rows.map((row) => ({ ...row, percent: selectedTotal ? Number(((row.value / selectedTotal) * 100).toFixed(1)) : 0 })),
    generatedAt: new Date().toISOString(),
  }
}

export const flightAnalytics = [
  { id: '101', name: '江心洲', recordCount: 68, flightLength: 560.2, durationHours: 14.2 },
  { id: '102', name: '水务局', recordCount: 55, flightLength: 450.8, durationHours: 11.3 },
  { id: '103', name: '交通局', recordCount: 45, flightLength: 381.47, durationHours: 9.6 },
  { id: '104', name: '公安局', recordCount: 41, flightLength: 356.2, durationHours: 8.9 },
  { id: '105', name: '消防支队', recordCount: 28, flightLength: 240.5, durationHours: 6.1 },
  { id: '106', name: '城管局', recordCount: 32, flightLength: 268.9, durationHours: 6.8 },
]

export type AircraftStatus = 'flying' | 'standby' | 'warning'
export type Aircraft = {
  id: string
  name: string
  model: string
  longitude: number
  latitude: number
  altitudeM: number
  speedMps: number
  headingDeg: number
  batteryPercent: number
  status: AircraftStatus
  task: string
  /** 所属方舱（无人机驻泊点，方舱弹窗按此聚合） */
  shelterId?: string
  /** 下线（停用/维护中）：不参与调度、遥测原地悬停、不参与冲突/告警检测 */
  offline?: boolean
}

/* ========== 方舱（S1 资源概况的下钻：方舱 → 无人机 → 调度） ========== */
export type Shelter = {
  id: string
  name: string
  enabled: boolean
  longitude?: number
  latitude?: number
  note?: string
}

/** 6 个启用方舱（分布在演示区域内）+ 5 个规划中；方舱名与飞行记录 deviceName（1号~4号方舱）保持一致 */
export const shelters: Shelter[] = [
  { id: 'SH-01', name: '1号方舱', enabled: true, longitude: 121.432, latitude: 31.238, note: '滨江片区 · 治安/海巡' },
  { id: 'SH-02', name: '2号方舱', enabled: true, longitude: 121.45, latitude: 31.205, note: '河道片区 · 水务巡检' },
  { id: 'SH-03', name: '3号方舱', enabled: true, longitude: 121.49, latitude: 31.248, note: '北区工业园 · 应急' },
  { id: 'SH-04', name: '4号方舱', enabled: true, longitude: 121.462, latitude: 31.225, note: '中心城区 · 消防/市容' },
  { id: 'SH-05', name: '5号方舱', enabled: true, longitude: 121.508, latitude: 31.235, note: '东区 · 应急备勤' },
  { id: 'SH-06', name: '6号方舱', enabled: true, longitude: 121.478, latitude: 31.203, note: '南区 · 住建' },
  { id: 'SH-07', name: '7号方舱', enabled: false, note: '规划中' },
  { id: 'SH-08', name: '8号方舱', enabled: false, note: '规划中' },
  { id: 'SH-09', name: '9号方舱', enabled: false, note: '规划中' },
  { id: 'SH-10', name: '10号方舱', enabled: false, note: '规划中' },
  { id: 'SH-11', name: '11号方舱', enabled: false, note: '规划中' },
]

/** 方舱及其驻泊无人机（按 aircraft.shelterId 聚合，供方舱弹窗/下钻） */
export function getShelters(): Array<Shelter & { aircraft: Aircraft[] }> {
  return shelters.map((shelter) => ({ ...shelter, aircraft: aircraft.filter((item) => item.shelterId === shelter.id) }))
}

/** 10 架演示飞机：覆盖 3 机型、巡逻/巡检/应急/待命状态，轨迹分布在演示边界内；shelterId 与方舱表一致 */
export const aircraft: Aircraft[] = [
  { id: 'UAV-01', name: '海巡-01', model: 'M350 RTK', longitude: 121.481, latitude: 31.235, altitudeM: 86, speedMps: 13.1, headingDeg: 78, batteryPercent: 82, status: 'flying', task: '重点道路巡检', shelterId: 'SH-01' },
  { id: 'UAV-02', name: '城巡-07', model: 'M30T', longitude: 121.452, latitude: 31.217, altitudeM: 62, speedMps: 9.6, headingDeg: 212, batteryPercent: 64, status: 'flying', task: '河道例行巡检', shelterId: 'SH-02' },
  { id: 'UAV-03', name: '应急-03', model: 'M350 RTK', longitude: 121.497, latitude: 31.216, altitudeM: 105, speedMps: 15.4, headingDeg: 328, batteryPercent: 31, status: 'warning', task: '应急现场勘察', shelterId: 'SH-03' },
  { id: 'UAV-04', name: '交通-12', model: 'M3E', longitude: 121.44, latitude: 31.242, altitudeM: 0, speedMps: 0, headingDeg: 0, batteryPercent: 96, status: 'standby', task: '待命', shelterId: 'SH-03' },
  { id: 'UAV-05', name: '公安-01', model: 'M350 RTK', longitude: 121.463, latitude: 31.245, altitudeM: 58, speedMps: 11.2, headingDeg: 142, batteryPercent: 71, status: 'flying', task: '治安巡逻', shelterId: 'SH-01' },
  { id: 'UAV-06', name: '消防-05', model: 'M30T', longitude: 121.447, latitude: 31.213, altitudeM: 48, speedMps: 8.4, headingDeg: 266, batteryPercent: 88, status: 'flying', task: '重点区域瞭望', shelterId: 'SH-04' },
  { id: 'UAV-07', name: '水务-02', model: 'M3E', longitude: 121.471, latitude: 31.204, altitudeM: 0, speedMps: 0, headingDeg: 0, batteryPercent: 92, status: 'standby', task: '待命', shelterId: 'SH-02' },
  { id: 'UAV-08', name: '城巡-09', model: 'M30T', longitude: 121.476, latitude: 31.232, altitudeM: 74, speedMps: 10.8, headingDeg: 45, batteryPercent: 57, status: 'flying', task: '市容巡查', shelterId: 'SH-04' },
  { id: 'UAV-09', name: '住建-03', model: 'M3E', longitude: 121.435, latitude: 31.231, altitudeM: 0, speedMps: 0, headingDeg: 0, batteryPercent: 99, status: 'standby', task: '待命', shelterId: 'SH-06' },
  { id: 'UAV-10', name: '应急-08', model: 'M350 RTK', longitude: 121.505, latitude: 31.238, altitudeM: 92, speedMps: 12.6, headingDeg: 190, batteryPercent: 36, status: 'warning', task: '应急巡飞待命', shelterId: 'SH-05' },
]

/** 演示边界：飞机轨迹始终保持在示意城区范围内 */
export const demoBounds = { minLng: 121.425, maxLng: 121.515, minLat: 31.2, maxLat: 31.255 }

/**
 * 派发任务目标：aircraftId → 目标坐标。
 * 由调度/工单模块写入（applyDispatch / 工单流转 executing），SSE 快照据此让飞机直线飞向任务点，
 * 到达后悬停（保留目标）；工单 completed 时清除。
 */
export const dispatchTargets = new Map<string, { lng: number; lat: number }>()

/** 沿航线飞行：aircraftId → 剩余航点序列（到达当前目标后依次 shift，航线执行完毕悬停） */
export const dispatchRoutes = new Map<string, LngLat[]>()

/** 每帧飞行步长（演示速度，约 300m 量级） */
const DISPATCH_STEP = 0.0035

export function nextAircraftSnapshot(sequence: number): Aircraft[] {
  return aircraft.map((item, index) => {
    if (item.status === 'standby' || item.offline) return item
    const target = dispatchTargets.get(item.id)
    if (target) {
      // 有任务目标：直线飞向目标，航向跟随，到达后悬停（位置写回，SSE 重连后从当前位置继续）
      const dx = target.lng - item.longitude
      const dy = target.lat - item.latitude
      const dist = Math.hypot(dx, dy)
      const next = {
        ...item,
        headingDeg: Math.round((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360),
        batteryPercent: Math.max(18, item.batteryPercent - Math.floor(sequence / 45)),
      }
      if (dist > DISPATCH_STEP) {
        next.longitude = Number((item.longitude + (dx / dist) * DISPATCH_STEP).toFixed(6))
        next.latitude = Number((item.latitude + (dy / dist) * DISPATCH_STEP).toFixed(6))
      } else {
        // 到达当前航点：切换到下一个航点（沿航线飞行）
        const remaining = dispatchRoutes.get(item.id)
        const nextWaypoint = remaining && remaining.length > 0 ? remaining.shift() : undefined
        if (nextWaypoint) {
          dispatchTargets.set(item.id, { lng: nextWaypoint[0], lat: nextWaypoint[1] })
        }
        next.longitude = target.lng
        next.latitude = target.lat
      }
      item.longitude = next.longitude
      item.latitude = next.latitude
      item.headingDeg = next.headingDeg
      return next
    }
    const angle = sequence / 9 + index * 1.8
    const next = {
      ...item,
      longitude: Number((item.longitude + Math.cos(angle) * 0.003).toFixed(6)),
      latitude: Number((item.latitude + Math.sin(angle) * 0.002).toFixed(6)),
      headingDeg: Math.round((item.headingDeg + sequence * 7) % 360),
      batteryPercent: Math.max(18, item.batteryPercent - Math.floor(sequence / 45)),
    }
    // 轨迹越界回弹，保证演示稳定
    if (next.longitude < demoBounds.minLng) next.longitude = demoBounds.minLng + 0.001
    if (next.longitude > demoBounds.maxLng) next.longitude = demoBounds.maxLng - 0.001
    if (next.latitude < demoBounds.minLat) next.latitude = demoBounds.minLat + 0.001
    if (next.latitude > demoBounds.maxLat) next.latitude = demoBounds.maxLat - 0.001
    return next
  })
}

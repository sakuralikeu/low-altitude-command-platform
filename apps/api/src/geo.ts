/** 几何计算与空域合规工具（演示数据，坐标示意） */

export type LngLat = [number, number]

export type NoFlyZone = {
  id: string
  name: string
  kind: 'airport' | 'temporary' | 'restricted'
  points: LngLat[]
  enabled: boolean
  note?: string
}

/**
 * 演示禁飞区（示意坐标，落在飞机活动范围内以便演示触发）：
 * - Z-01 龙华机场净空区（滨江区域，多条航线穿行）
 * - Z-02 重大活动临时管控区（活动时段禁飞）
 * - Z-03 敏感单位净空保护区
 */
export const noFlyZones: NoFlyZone[] = [
  {
    id: 'Z-01',
    name: '龙华机场净空区',
    kind: 'airport',
    points: [[121.452, 31.222], [121.468, 31.226], [121.472, 31.214], [121.456, 31.208], [121.448, 31.214]],
    enabled: true,
    note: '机场跑道两端延长线净空保护，禁止穿越',
  },
  {
    id: 'Z-02',
    name: '重大活动临时管控区',
    kind: 'temporary',
    points: [[121.488, 31.234], [121.506, 31.232], [121.508, 31.222], [121.492, 31.219], [121.486, 31.226]],
    enabled: true,
    note: '活动期间临时禁飞，解禁时间待通知',
  },
  {
    id: 'Z-03',
    name: '敏感单位净空保护区',
    kind: 'restricted',
    points: [[121.428, 31.242], [121.438, 31.246], [121.442, 31.238], [121.432, 31.234]],
    enabled: true,
    note: '敏感区域上空限制飞行',
  },
]

/** Haversine 水平距离（米） */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** 射线法：点是否在多边形内 */
export function pointInPolygon(point: LngLat, polygon: LngLat[]): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + polygon.length - 1) % polygon.length
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    const intersect = (yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 最近边距（米）：点到多边形各边段的距离最小值，用于"临近预警" */
export function distanceToPolygon(point: LngLat, polygon: LngLat[]): number {
  let min = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[(i + polygon.length - 1) % polygon.length]!
    const b = polygon[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq))
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    min = Math.min(min, haversineMeters(point, [px, py]))
  }
  return min
}

/** 查找包含点的所有启用禁飞区 */
export function findZoneViolations(point: LngLat, zones: NoFlyZone[] = noFlyZones): NoFlyZone[] {
  return zones.filter((zone) => zone.enabled && pointInPolygon(point, zone.points))
}

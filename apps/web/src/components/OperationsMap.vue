<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Crosshair, LocateFixed, Minus, Plane, Plus, Satellite, Map as MapIcon, Moon, RotateCw, Target, WifiOff, X } from 'lucide-vue-next'
import type { Aircraft, ConflictPair, NoFlyZone } from '@/types'

type BasemapMode = 'vector' | 'satellite' | 'dark'
type MapState = 'demo' | 'loading' | 'ready' | 'error'

interface AMapMarker {
  setPosition(position: [number, number]): void
  setAngle(angle: number): void
  setMap(map: AMapInstance | null): void
  /** 自定义：marker 内容里的飞机形状元素，用于实时更新航向 */
  shapeEl?: SVGElement
}

interface AMapPolygon {
  setMap(map: AMapInstance | null): void
}

interface AMapPolyline {
  setMap(map: AMapInstance | null): void
  setPath(path: Array<[number, number]>): void
}

interface AMapInstance {
  add(item: AMapMarker | unknown): void
  setLayers(layers: unknown[]): void
  setMapStyle(style: string): void
  setZoomAndCenter(zoom: number, center: [number, number]): void
  zoomIn(): void
  zoomOut(): void
  on(event: string, handler: (e: { lnglat: { lng: number; lat: number } }) => void): void
  destroy(): void
}

interface AMapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapInstance
  Marker: new (options: Record<string, unknown>) => AMapMarker
  Polygon: new (options: Record<string, unknown>) => AMapPolygon
  Polyline: new (options: Record<string, unknown>) => AMapPolyline
  TileLayer: { new (options?: Record<string, unknown>): unknown; Satellite: new (options?: Record<string, unknown>) => unknown; RoadNet: new (options?: Record<string, unknown>) => unknown }
}

/** 机型额定续航（与后端 scenarios.ts 保持一致） */
const MODEL_RATED_MINUTES: Record<string, number> = { 'M350 RTK': 55, 'M30T': 41, 'M3E': 45 }
const ENDURANCE_WARN_PERCENT = 40

const props = defineProps<{ aircraft: Aircraft[]; connected: boolean; selectedId: string; zones: NoFlyZone[]; conflicts?: ConflictPair[]; target?: { lng: number; lat: number } | null; focus?: { lng: number; lat: number; seq: number } | null }>()
const emit = defineEmits<{ select: [aircraft: Aircraft]; pick: [lng: number, lat: number]; clear: [] }>()

const mapRoot = ref<HTMLElement>()
const mode = ref<BasemapMode>('dark')
const mapState = ref<MapState>(import.meta.env.VITE_AMAP_KEY ? 'loading' : 'demo')
const demoZoom = ref(1)
const FOCUS_ZOOM = 15
const selected = computed(() => props.aircraft.find((item) => item.id === props.selectedId))
const bounds = { minLng: 121.425, maxLng: 121.515, minLat: 31.2, maxLat: 31.255 }
const mapStatusText = computed(() => ({ loading: '高德地图载入中', ready: '高德地图 · 实时态势', error: '地图服务不可用', demo: '演示底图 · 待配置高德 Key' })[mapState.value])

/** 电量续航预测（与后端规则一致：剩余分钟 + 返航建议） */
const endurance = computed(() => {
  if (!selected.value) return null
  const rated = MODEL_RATED_MINUTES[selected.value.model] ?? 50
  const remainingMinutes = Number((selected.value.batteryPercent * (rated / 100)).toFixed(1))
  const low = selected.value.batteryPercent <= ENDURANCE_WARN_PERCENT
  return { remainingMinutes, low }
})

const zonePointToPercent = (point: [number, number]) => ({
  x: ((point[0] - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100,
  y: 100 - ((point[1] - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100,
})

/** 演示模式冲突连线段（SVG 坐标，与 marker 同一投影） */
const conflictSegments = computed(() => (props.conflicts ?? []).map((pair) => {
  const a = zonePointToPercent([pair.a.longitude, pair.a.latitude])
  const b = zonePointToPercent([pair.b.longitude, pair.b.latitude])
  return { key: `${pair.a.id}:${pair.b.id}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, critical: pair.severity === 'critical' }
}))

const targetPosition = computed(() => props.target ? {
  left: `${((props.target.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100}%`,
  top: `${100 - ((props.target.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100}%`,
} : null)

function onDemoPick(event: MouseEvent) {
  const point = demoPointFromEvent(event)
  if (point) pickPoint(point.lng, point.lat)
}

let AMap: AMapNamespace | undefined
let map: AMapInstance | undefined
const markers = new Map<string, AMapMarker>()
const polygons = new Map<string, AMapPolygon>()
const conflictLines = new Map<string, AMapPolyline>()
let targetMarker: AMapMarker | undefined

/** 演示模式点击换算经纬度（与 zonePointToPercent 的投影一致） */
function demoPointFromEvent(event: MouseEvent) {
  const rect = mapRoot.value?.getBoundingClientRect()
  if (!rect) return null
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  return {
    lng: Number((bounds.minLng + x * (bounds.maxLng - bounds.minLng)).toFixed(6)),
    lat: Number((bounds.maxLat - y * (bounds.maxLat - bounds.minLat)).toFixed(6)),
  }
}

function pickPoint(lng: number, lat: number) {
  emit('pick', lng, lat)
}

const demoPosition = (item: Aircraft) => ({
  left: `${((item.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100}%`,
  top: `${100 - ((item.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100}%`,
  transform: `translate(-50%, -50%) scale(${demoZoom.value})`,
  '--heading': `${item.headingDeg}deg`,
})

function createPlaneGlyph(className: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add(className)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z')
  svg.append(path)
  return svg
}

function markerClassName(item: Aircraft) {
  return `amap-aircraft-marker ${item.status}${props.selectedId === item.id ? ' selected' : ''}`
}

function createMarkerContent(item: Aircraft) {
  const root = document.createElement('button')
  root.type = 'button'
  root.className = markerClassName(item)
  root.setAttribute('aria-label', `${item.name}，${item.task}，电量 ${item.batteryPercent}%`)
  const shape = createPlaneGlyph('amap-aircraft-shape')
  shape.style.transform = `rotate(${item.headingDeg - 45}deg)`
  const label = document.createElement('span')
  label.className = 'amap-aircraft-label'
  label.textContent = item.name
  root.append(shape, label)
  root.addEventListener('click', (event) => {
    event.stopPropagation()
    selectAircraft(item)
  })
  return { root, shape }
}

function selectAircraft(item: Aircraft) {
  if (props.selectedId === item.id) emit('clear')
  else emit('select', item)
}

function syncMarkers() {
  if (!map || !AMap) return
  const activeIds = new Set(props.aircraft.map((item) => item.id))
  markers.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      marker.setMap(null)
      markers.delete(id)
    }
  })
  props.aircraft.forEach((item) => {
    const position: [number, number] = [item.longitude, item.latitude]
    const marker = markers.get(item.id)
    if (marker) {
      marker.setPosition(position)
      if (marker.shapeEl) marker.shapeEl.style.transform = `rotate(${item.headingDeg - 45}deg)`
      const content = marker.shapeEl?.parentElement
      if (content) content.className = markerClassName(item)
      return
    }
    const content = createMarkerContent(item)
    const nextMarker = new AMap!.Marker({ position, anchor: 'center', content: content.root, zIndex: item.status === 'warning' ? 120 : 100 })
    nextMarker.shapeEl = content.shape
    nextMarker.setMap(map!)
    markers.set(item.id, nextMarker)
  })
}

/** 禁飞区图层（S5）：高德 Polygon 实例随数据增删 */
function syncZones() {
  if (!map || !AMap) return
  const activeIds = new Set(props.zones.map((zone) => zone.id))
  polygons.forEach((polygon, id) => {
    if (!activeIds.has(id)) {
      polygon.setMap(null)
      polygons.delete(id)
    }
  })
  props.zones.forEach((zone) => {
    if (!zone.enabled || polygons.has(zone.id)) return
    const polygon = new AMap!.Polygon({
      path: zone.points,
      strokeColor: '#f2b84b',
      strokeWeight: 2,
      strokeOpacity: 0.85,
      strokeStyle: 'dashed',
      fillColor: '#f2b84b',
      fillOpacity: 0.08,
      zIndex: 90,
    })
    polygon.setMap(map!)
    polygons.set(zone.id, polygon)
  })
}

/** 冲突对连线（S3）：高德 Polyline 虚线，蓝系与告警抽屉一致，随事件增删 */
function syncConflicts() {
  if (!map || !AMap) return
  const activeKeys = new Set((props.conflicts ?? []).map((pair) => `${pair.a.id}:${pair.b.id}`))
  conflictLines.forEach((line, key) => {
    if (!activeKeys.has(key)) {
      line.setMap(null)
      conflictLines.delete(key)
    }
  })
  for (const pair of props.conflicts ?? []) {
    const key = `${pair.a.id}:${pair.b.id}`
    if (conflictLines.has(key)) return
    const line = new AMap!.Polyline({
      path: [[pair.a.longitude, pair.a.latitude], [pair.b.longitude, pair.b.latitude]],
      strokeColor: pair.severity === 'critical' ? '#ff746c' : '#79aef2',
      strokeWeight: 2,
      strokeOpacity: 0.85,
      strokeStyle: 'dashed',
      lineJoin: 'round',
      zIndex: 85,
    })
    line.setMap(map!)
    conflictLines.set(key, line)
  }
}

/** 调度目标点（地图点选）：高德 Marker 十字标记 */
function syncTarget() {
  if (!map || !AMap) return
  if (!props.target) {
    targetMarker?.setMap(null)
    targetMarker = undefined
    return
  }
  if (targetMarker) {
    targetMarker.setPosition([props.target.lng, props.target.lat])
    return
  }
  const root = document.createElement('div')
  root.className = 'amap-target-marker'
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('title', '调度目标点')
  targetMarker = new AMap!.Marker({ position: [props.target.lng, props.target.lat], anchor: 'center', content: root, zIndex: 95 })
  targetMarker.setMap(map!)
}

function applyBasemap(nextMode: BasemapMode) {
  mode.value = nextMode
  if (!map || !AMap) return
  if (nextMode === 'satellite') {
    mapRoot.value?.classList.remove('map-dark-filter')
    // 卫星：纯影像，不叠加路网/地名
    map.setLayers([new AMap.TileLayer.Satellite({ zIndex: 1 })])
    map.setMapStyle('amap://styles/normal')
  } else {
    // WebGL darkblue 样式渲染不稳定（全黑/无注记），暗色改用亮色栅格瓦片 + CSS 滤镜反相（注记烘焙在瓦片内）
    map.setLayers([new AMap.TileLayer({ zIndex: 1 })])
    map.setMapStyle('amap://styles/normal')
    if (nextMode === 'dark') mapRoot.value?.classList.add('map-dark-filter')
    else mapRoot.value?.classList.remove('map-dark-filter')
  }
}

function zoom(direction: 1 | -1) {
  if (map) direction > 0 ? map.zoomIn() : map.zoomOut()
  else demoZoom.value = Math.min(1.4, Math.max(.8, demoZoom.value + direction * .1))
}

function resetView() {
  map?.setZoomAndCenter(12, [121.4737, 31.2304])
  demoZoom.value = 1
}

async function initializeMap() {
  const key = import.meta.env.VITE_AMAP_KEY
  if (!key || !mapRoot.value) return
  try {
    mapState.value = 'loading'
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode }
    AMap = await AMapLoader.load({ key, version: '2.0', plugins: ['AMap.Scale'] }) as AMapNamespace
    map = new AMap.Map(mapRoot.value, { center: [121.4737, 31.2304], zoom: 12, viewMode: '2D', mapStyle: 'amap://styles/normal', showLabel: true })
    mapState.value = 'ready'
    applyBasemap(mode.value)
    map.on('click', (event) => {
      const lng = Number(event.lnglat.lng.toFixed(6))
      const lat = Number(event.lnglat.lat.toFixed(6))
      emit('pick', lng, lat)
    })
    syncMarkers()
    syncZones()
    syncConflicts()
    syncTarget()
    patchThirdPartyA11y()
  } catch (error) {
    console.error('AMap initialization failed', error)
    mapState.value = 'error'
  }
}

/** 第三方地图无障碍修补（Lighthouse）：iframe title 与 logo alt 无法由我们控制，初始化后注入；图层异步渲染时重试 */
function patchThirdPartyA11y(attempt = 0) {
  const frame = mapRoot.value?.querySelector('iframe')
  if (frame) frame.setAttribute('title', '高德地图底图')
  const logo = mapRoot.value?.querySelector('.amap-logo img, .amap-copyright img')
  if (logo) logo.setAttribute('alt', '高德地图')
  else if (attempt < 4) window.setTimeout(() => patchThirdPartyA11y(attempt + 1), 1000)
}

watch(() => props.aircraft, () => syncMarkers(), { deep: true })
watch(() => props.selectedId, () => syncMarkers())
watch(() => props.zones, () => syncZones(), { deep: true })
watch(() => props.conflicts, () => syncConflicts(), { deep: true })
watch(() => props.target, () => syncTarget())
/** 聚焦定位：指定坐标居中放大（真实地图 setZoomAndCenter；演示底图放大至最高倍） */
watch(() => props.focus, (focus) => {
  if (!focus) return
  if (map) map.setZoomAndCenter(FOCUS_ZOOM, [focus.lng, focus.lat])
  else demoZoom.value = 1.4
})
onMounted(async () => { await nextTick(); await initializeMap() })
onBeforeUnmount(() => { markers.forEach((marker) => marker.setMap(null)); markers.clear(); polygons.forEach((polygon) => polygon.setMap(null)); polygons.clear(); conflictLines.forEach((line) => line.setMap(null)); conflictLines.clear(); targetMarker?.setMap(null); targetMarker = undefined; map?.destroy() })
</script>

<template>
  <section class="ops-map" :class="[`map-${mode}`, `map-state-${mapState}`]" aria-label="无人机实时运行地图">
    <div ref="mapRoot" class="amap-root" :aria-hidden="mapState !== 'ready'" />
    <div v-if="mapState !== 'ready'" class="map-grid" :style="{ '--zoom': demoZoom }" @click.self="onDemoPick">
      <span v-for="n in 12" :key="`r${n}`" class="road" :class="`road-${n}`" />
      <span v-for="n in 5" :key="`z${n}`" class="zone" :class="`zone-${n}`" />
      <svg class="zone-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon v-for="zone in zones.filter((item) => item.enabled)" :key="zone.id" :points="zone.points.map(zonePointToPercent).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')" class="zone-polygon" />
      </svg>
      <svg class="conflict-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line v-for="segment in conflictSegments" :key="segment.key" :x1="segment.x1.toFixed(2)" :y1="segment.y1.toFixed(2)" :x2="segment.x2.toFixed(2)" :y2="segment.y2.toFixed(2)" :class="['conflict-line', { critical: segment.critical }]" />
      </svg>
      <div v-if="targetPosition" class="target-marker" :style="targetPosition" role="img" :aria-label="`调度目标点 ${props.target?.lng}, ${props.target?.lat}`"><Target /></div>
      <button v-for="item in aircraft" :key="item.id" type="button" class="aircraft-marker" :class="[item.status, { selected: selectedId === item.id }]" :style="demoPosition(item)" :aria-label="`${item.name}，${item.task}，电量 ${item.batteryPercent}%`" @click="selectAircraft(item)">
        <Plane class="aircraft-shape" />
        <span class="aircraft-label">{{ item.name }}</span>
      </button>
      <div v-if="mapState === 'loading'" class="map-loading"><span class="spinner" />正在连接地图服务</div>
      <div v-else-if="mapState === 'error'" class="map-loading map-error"><WifiOff />高德地图加载失败，已切换演示底图<button type="button" class="map-retry" @click="initializeMap"><RotateCw />重试</button></div>
    </div>

    <div class="map-status"><span :class="['status-dot', connected ? 'online' : 'offline']" /><span>{{ mapStatusText }}</span><strong>{{ connected ? '遥测在线' : '链路重连' }}</strong></div>
    <div class="map-tools map-types" aria-label="底图类型">
      <button type="button" :class="{ active: mode === 'satellite' }" title="卫星图" aria-label="切换卫星图" @click="applyBasemap('satellite')"><Satellite /></button>
      <button type="button" :class="{ active: mode === 'vector' }" title="电子地图" aria-label="切换电子地图" @click="applyBasemap('vector')"><MapIcon /></button>
      <button type="button" :class="{ active: mode === 'dark' }" title="暗色地图" aria-label="切换暗色地图" @click="applyBasemap('dark')"><Moon /></button>
    </div>
    <div class="map-tools map-zoom" aria-label="地图缩放">
      <button type="button" title="放大" aria-label="放大地图" @click="zoom(1)"><Plus /></button>
      <button type="button" title="缩小" aria-label="缩小地图" @click="zoom(-1)"><Minus /></button>
      <button type="button" title="重置视野" aria-label="重置地图视野" @click="resetView"><LocateFixed /></button>
    </div>
    <div class="map-legend"><span><i class="flying" />执行中</span><span><i class="standby" />待命</span><span><i class="warning" />告警</span><span><i class="conflict" />冲突</span></div>
    <div class="map-caption"><Crosshair />上海市低空运行试验区 <span>31.2304°N · 121.4737°E</span></div>
    <div v-if="selected" class="aircraft-popover" role="status">
      <div class="popover-title"><span :class="['status-dot', selected.status]" />{{ selected.name }}<small>{{ selected.id }}</small><button type="button" class="popover-close" aria-label="关闭飞机详情" @click="emit('clear')"><X /></button></div>
      <p>{{ selected.task }}</p>
      <dl><div><dt>飞行高度</dt><dd>{{ selected.altitudeM }} m</dd></div><div><dt>即时速度</dt><dd>{{ selected.speedMps }} m/s</dd></div><div><dt>航向</dt><dd>{{ selected.headingDeg }}°</dd></div><div><dt>剩余电量</dt><dd :class="{ warn: selected.batteryPercent < 35 }">{{ selected.batteryPercent }}%</dd></div></dl>
      <div v-if="endurance" class="endurance-line" :class="{ warn: endurance.low }">
        <span>预计续航</span><strong>{{ endurance.remainingMinutes }} min</strong><em v-if="endurance.low">电量偏低 · 建议返航</em><em v-else>续航充足</em>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Pause, Play, Satellite, Map as MapIcon, Moon, X } from 'lucide-vue-next'
import type { FlightReplay, FlightTrackPoint } from '@/types'

/**
 * 独立回放小窗：脱离态势地图的航线回放/计划预览播放器。
 * 有高德 Key 时渲染暗色迷你地图 + 旋转小飞机 + 航线；无 Key / 加载失败时回退到地图质感 SVG 画布。
 * 打开时自动聚焦关闭按钮，ESC / 背景点击 / X 关闭；关闭后焦点还原。
 */
const props = defineProps<{ replay: FlightReplay }>()
const emit = defineEmits<{ close: [] }>()

type MiniMapState = 'loading' | 'ready' | 'fallback'
type BasemapMode = 'satellite' | 'vector' | 'dark'

interface AMapMarker { setPosition(position: [number, number]): void; setMap(map: AMapInstance | null): void; shapeEl?: SVGElement }
interface AMapPolyline { setMap(map: AMapInstance | null): void; setPath(path: Array<[number, number]>): void }
interface AMapTileLayer { setMap(map: AMapInstance | null): void }
interface AMapInstance { add(item: unknown): void; setLayers(layers: unknown[]): void; setMapStyle(style: string): void; setFitView(overlays: unknown[], immediately?: boolean, avoid?: number[], maxZoom?: number): void; destroy(): void }
interface AMapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapInstance
  Marker: new (options: Record<string, unknown>) => AMapMarker
  Polyline: new (options: Record<string, unknown>) => AMapPolyline
  TileLayer: { new (options?: Record<string, unknown>): AMapTileLayer; Satellite: new (options?: Record<string, unknown>) => AMapTileLayer; RoadNet: new (options?: Record<string, unknown>) => AMapTileLayer }
}

const playbackIndex = ref(0)
const playing = ref(false)
const playbackSpeed = ref<1 | 2 | 4>(1)
let playbackTimer: number | undefined
let restoreFocusTarget: HTMLElement | null = null

const closeButton = ref<HTMLButtonElement>()
const trackRef = ref<HTMLElement>()

const isPreview = computed(() => props.replay.mode === 'preview')
const track = computed(() => (isPreview.value ? props.replay.planned : props.replay.actual))
const replayPoint = computed(() => track.value[playbackIndex.value])
const replayProgress = computed(() =>
  track.value.length ? Math.round((playbackIndex.value / Math.max(1, track.value.length - 1)) * 100) : 0,
)
const replayElapsed = computed(() => replayPoint.value?.elapsedSeconds ?? 0)

/** 航向：当前点相对前一点的方位角（正北为 0） */
const heading = computed(() => {
  const points = track.value
  if (!points.length) return 0
  const index = Math.min(playbackIndex.value, points.length - 1)
  const from = points[Math.max(0, index - 1)]
  const to = points[Math.min(points.length - 1, index + (index === 0 ? 1 : 0))]
  if (!from || !to || from === to) return 0
  const longitudeDelta = (to.longitude - from.longitude) * Math.cos(((from.latitude + to.latitude) / 2) * Math.PI / 180)
  const latitudeDelta = to.latitude - from.latitude
  return Math.atan2(longitudeDelta, latitudeDelta) * 180 / Math.PI
})

/** SVG 回退画布投影：按经纬度包围盒 + 15% 边距映射，纬度余弦校正纵横比 */
const fallbackView = computed(() => {
  const all = [...props.replay.planned, ...props.replay.actual]
  if (!all.length) return { width: 800, height: 400, toX: () => 0, toY: () => 0 }
  const lngs = all.map((point) => point.longitude)
  const lats = all.map((point) => point.latitude)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const lngSpan = Math.max(maxLng - minLng, 0.004)
  const latSpan = Math.max(maxLat - minLat, 0.004)
  const pad = 0.18
  const midLat = ((minLat + maxLat) / 2) * Math.PI / 180
  const aspect = latSpan / (lngSpan * Math.cos(midLat))
  const width = 800
  const height = Math.min(500, Math.max(300, Math.round(width * aspect)))
  const span = lngSpan * (1 + pad * 2)
  const latRange = latSpan * (1 + pad * 2)
  const toX = (point: FlightTrackPoint) => ((point.longitude - minLng + lngSpan * pad) / span) * width
  const toY = (point: FlightTrackPoint) => (1 - (point.latitude - minLat + latSpan * pad) / latRange) * height
  return { width, height, toX, toY }
})

function fallbackPoints(points: FlightTrackPoint[]) {
  return points.map((point) => `${fallbackView.value.toX(point).toFixed(2)},${fallbackView.value.toY(point).toFixed(2)}`).join(' ')
}

const actualFallbackPoints = computed(() => fallbackPoints(props.replay.actual.slice(0, playbackIndex.value + 1)))
const fallbackCursorStyle = computed(() => {
  if (!replayPoint.value) return {}
  return {
    transform: `translate(${fallbackView.value.toX(replayPoint.value)}px, ${fallbackView.value.toY(replayPoint.value)}px) rotate(${heading.value}deg)`,
  }
})
const startDot = computed(() => {
  const point = track.value[0]
  return point ? { cx: fallbackView.value.toX(point), cy: fallbackView.value.toY(point) } : null
})
const endDot = computed(() => {
  const point = track.value[track.value.length - 1]
  return track.value.length > 1 && point ? { cx: fallbackView.value.toX(point), cy: fallbackView.value.toY(point) } : null
})

// —— 高德迷你地图 ——
const mapState = ref<MiniMapState>(import.meta.env.VITE_AMAP_KEY ? 'loading' : 'fallback')
const basemapMode = ref<BasemapMode>('satellite')
const basemapModes: Array<{ key: BasemapMode; label: string; title: string }> = [
  { key: 'satellite', label: '卫星', title: '切换卫星影像底图' },
  { key: 'vector', label: '电子', title: '切换电子地图' },
  { key: 'dark', label: '暗色', title: '切换暗色地图' },
]
let AMap: AMapNamespace | undefined
let miniMap: AMapInstance | undefined
let plannedLine: AMapPolyline | undefined
let actualLine: AMapPolyline | undefined
let replayMarker: AMapMarker | undefined

function createPlaneGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('replay-aircraft-shape')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z')
  svg.append(path)
  return svg
}

function pathFor(points: FlightTrackPoint[]): Array<[number, number]> {
  return points.map((point) => [point.longitude, point.latitude])
}

function syncMarker() {
  const point = replayPoint.value
  if (!point || !miniMap || !AMap) return
  if (!replayMarker) {
    const content = document.createElement('span')
    content.className = 'replay-map-marker'
    const shape = createPlaneGlyph()
    shape.style.transform = `rotate(${heading.value - 45}deg)`
    content.append(shape)
    replayMarker = new AMap.Marker({ position: [point.longitude, point.latitude], anchor: 'center', content, zIndex: 140 })
    replayMarker.shapeEl = shape
    replayMarker.setMap(miniMap)
  } else {
    replayMarker.setPosition([point.longitude, point.latitude])
    if (replayMarker.shapeEl) replayMarker.shapeEl.style.transform = `rotate(${heading.value - 45}deg)`
  }
}

function syncActualLine() {
  if (isPreview.value) return
  const path = pathFor(props.replay.actual.slice(0, playbackIndex.value + 1))
  if (actualLine) actualLine.setPath(path)
}

function drawLayers() {
  if (!miniMap || !AMap) return
  plannedLine = new AMap.Polyline({
    path: pathFor(props.replay.planned), strokeColor: '#79aef2', strokeWeight: 3, strokeOpacity: 0.8, strokeStyle: 'dashed', zIndex: 92,
  })
  plannedLine.setMap(miniMap)
  if (!isPreview.value) {
    actualLine = new AMap.Polyline({
      path: pathFor(props.replay.actual.slice(0, playbackIndex.value + 1)), strokeColor: '#38b795', strokeWeight: 5, strokeOpacity: 0.95, zIndex: 94,
    })
    actualLine.setMap(miniMap)
  }
  miniMap.setFitView([plannedLine, actualLine].filter(Boolean) as AMapPolyline[], false, [40, 40, 40, 40], 16)
  syncMarker()
}

function applyBasemap() {
  if (!miniMap || !AMap) return
  if (basemapMode.value === 'satellite') {
    trackRef.value?.classList.remove('map-dark-filter')
    // 卫星：纯影像，不叠加路网/地名
    miniMap.setLayers([new AMap.TileLayer.Satellite({ zIndex: 1 })])
    miniMap.setMapStyle('amap://styles/normal')
  } else {
    // WebGL darkblue 样式渲染不稳定（全黑/无注记），暗色改用亮色栅格瓦片 + CSS 滤镜反相
    miniMap.setLayers([new AMap.TileLayer({ zIndex: 1 })])
    miniMap.setMapStyle('amap://styles/normal')
    if (basemapMode.value === 'dark') trackRef.value?.classList.add('map-dark-filter')
    else trackRef.value?.classList.remove('map-dark-filter')
  }
}

function setBasemap(mode: BasemapMode) {
  basemapMode.value = mode
  applyBasemap()
}

async function initMiniMap() {
  const key = import.meta.env.VITE_AMAP_KEY
  if (!key || !trackRef.value) { mapState.value = 'fallback'; return }
  try {
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode }
    AMap = await AMapLoader.load({ key, version: '2.0' }) as AMapNamespace
    miniMap = new AMap.Map(trackRef.value, {
      center: [121.4737, 31.2304], zoom: 13, viewMode: '2D', mapStyle: 'amap://styles/normal', showLabel: true,
    })
    mapState.value = 'ready'
    await nextTick()
    applyBasemap()
    drawLayers()
  } catch (error) {
    console.error('Replay mini-map init failed', error)
    mapState.value = 'fallback'
  }
}

// —— 播放控制 ——
function stopPlayback() {
  playing.value = false
  window.clearInterval(playbackTimer)
}

function startPlayback() {
  if (playbackIndex.value >= track.value.length - 1) playbackIndex.value = 0
  playing.value = true
  window.clearInterval(playbackTimer)
  playbackTimer = window.setInterval(() => {
    if (playbackIndex.value >= track.value.length - 1) return stopPlayback()
    playbackIndex.value += 1
  }, 600 / playbackSpeed.value)
}

function togglePlayback() {
  playing.value ? stopPlayback() : startPlayback()
}

function setPlaybackSpeed(speed: 1 | 2 | 4) {
  playbackSpeed.value = speed
  if (playing.value) startPlayback()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

watch(() => props.replay, () => {
  stopPlayback()
  playbackIndex.value = 0
}, { immediate: true })

watch(playbackIndex, () => {
  if (mapState.value === 'ready') { syncActualLine(); syncMarker() }
})

onMounted(() => {
  restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKeydown)
  void nextTick(() => closeButton.value?.focus())
  void initMiniMap()
})

onBeforeUnmount(() => {
  stopPlayback()
  window.removeEventListener('keydown', onKeydown)
  plannedLine?.setMap(null)
  actualLine?.setMap(null)
  replayMarker?.setMap(null)
  miniMap?.destroy()
  restoreFocusTarget?.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div class="replay-dialog-overlay" @click.self="emit('close')">
        <section class="replay-dialog" role="dialog" aria-modal="true" :aria-label="isPreview ? '飞行计划回放预览' : '飞行轨迹回放'">
          <header>
            <div>
              <span>{{ isPreview ? 'ROUTE PREVIEW · 计划回放' : 'FLIGHT REPLAY · 轨迹回放' }}</span>
              <strong>{{ replay.routeName }}</strong>
              <small>{{ replay.aircraftName }} · {{ isPreview ? `计划时长 ${Math.round(replay.durationSeconds / 60)} 分钟` : replay.startedAt }}</small>
            </div>
            <button ref="closeButton" type="button" aria-label="关闭回放小窗" @click="emit('close')"><X /></button>
          </header>

          <div class="replay-track" :class="{ fallback: mapState !== 'ready' }">
            <div ref="trackRef" v-show="mapState !== 'fallback'" class="replay-track-map" />
            <div v-if="mapState === 'loading'" class="replay-track-state"><span class="spinner" />正在载入回放地图</div>
            <div v-if="mapState === 'ready'" class="replay-basemaps" aria-label="回放底图类型">
              <button v-for="m in basemapModes" :key="m.key" type="button" :class="{ active: basemapMode === m.key }" :aria-pressed="basemapMode === m.key" :title="m.title" @click="setBasemap(m.key)">
                <Satellite v-if="m.key === 'satellite'" /><MapIcon v-else-if="m.key === 'vector'" /><Moon v-else /><span>{{ m.label }}</span>
              </button>
            </div>

            <svg v-if="mapState === 'fallback'" class="replay-track-fallback" :viewBox="`0 0 ${fallbackView.width} ${fallbackView.height}`" role="img" :aria-label="`${replay.routeName} 轨迹图：蓝色虚线为计划航线，青色实线为实际轨迹`">
              <g class="track-grid" aria-hidden="true">
                <line v-for="step in 4" :key="`v${step}`" :x1="fallbackView.width * step / 5" :y1="0" :x2="fallbackView.width * step / 5" :y2="fallbackView.height" />
                <line v-for="step in 4" :key="`h${step}`" :x1="0" :y1="fallbackView.height * step / 5" :x2="fallbackView.width" :y2="fallbackView.height * step / 5" />
              </g>
              <polyline :points="fallbackPoints(replay.planned)" class="track-line planned" />
              <polyline v-if="!isPreview && actualFallbackPoints" :points="actualFallbackPoints" class="track-line actual" />
              <circle v-if="startDot" class="track-dot start" :cx="startDot.cx" :cy="startDot.cy" r="5" />
              <circle v-if="endDot" class="track-dot end" :cx="endDot.cx" :cy="endDot.cy" r="5" />
              <g v-if="replayPoint" class="track-cursor" :style="fallbackCursorStyle">
                <circle class="track-cursor-ring" r="16" />
                <path class="track-cursor-plane" d="M0 -13 L6 9 L0 6 L-6 9 Z" />
              </g>
              <g class="track-compass" transform="translate(20, 20)"><path d="M0 -6 L3 0 L0 0 L-3 0 Z" /><text x="6" y="4">N</text></g>
            </svg>
            <div class="track-note"><i class="planned" />计划航线<span v-if="!isPreview"><i class="actual" />实际轨迹</span></div>
          </div>

          <div class="replay-controls">
            <button type="button" :aria-label="playing ? '暂停回放' : '播放回放'" @click="togglePlayback"><Pause v-if="playing" /><Play v-else /></button>
            <input v-model.number="playbackIndex" type="range" min="0" :max="Math.max(0, track.length - 1)" aria-label="回放进度" />
            <time>{{ Math.floor(replayElapsed / 60) }}:{{ String(replayElapsed % 60).padStart(2, '0') }}</time>
            <div class="replay-speeds" aria-label="回放速度"><button v-for="speed in ([1, 2, 4] as const)" :key="speed" type="button" :class="{ active: playbackSpeed === speed }" :aria-pressed="playbackSpeed === speed" @click="setPlaybackSpeed(speed)">{{ speed }}x</button></div>
          </div>

          <div v-if="isPreview" class="preview-summary"><span>计划航点<strong>{{ replay.planned.length }}</strong></span><span>计划高度<strong>{{ replay.planned[0]?.altitudeM ?? 0 }} m</strong></span><span>对应无人机<strong>{{ replay.aircraftName }}</strong></span></div>

          <footer>
            <span>进度<em>{{ replayProgress }}%</em></span>
            <em v-if="isPreview" class="preview-note">计划航迹 · 不代表实际飞行</em>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Camera, Car, Check, Clock3, Crosshair, Eye, Flame, LoaderCircle, MapPin, Send, Users, X } from 'lucide-vue-next'
import { api } from '@/services/api'
import type { AiRecognitionEvent } from '@/types'

const emit = defineEmits<{ dispatch: [payload: { label: string; lng: number; lat: number }] }>()

const events = ref<AiRecognitionEvent[]>([])
const loading = ref(false)
const error = ref('')
const actingId = ref('')
const filter = ref<'all' | 'reviewing' | 'confirmed' | 'archived'>('all')
const detailEvent = ref<AiRecognitionEvent>()

const filters: Array<{ key: typeof filter.value; label: string }> = [
  { key: 'all', label: '全部' }, { key: 'reviewing', label: '待复核' }, { key: 'confirmed', label: '已确认' }, { key: 'archived', label: '已归档' },
]
const visible = computed(() => events.value.filter((event) => filter.value === 'all' || event.status === filter.value))

const kindMeta: Record<AiRecognitionEvent['kind'], { icon: typeof Car; label: string }> = {
  traffic: { icon: Car, label: '交通' },
  smoke: { icon: Flame, label: '火情/烟雾' },
  gathering: { icon: Users, label: '人员聚集' },
  parking: { icon: MapPin, label: '违规停车' },
}

const statusLabel: Record<AiRecognitionEvent['status'], string> = { reviewing: '待复核', confirmed: '已确认', archived: '已归档' }
const statusOrder: Record<AiRecognitionEvent['status'], number> = { reviewing: 0, confirmed: 1, archived: 2 }
const timeline = ['待复核', '已确认', '已归档']

function confidenceClass(confidence: number) {
  return confidence >= 0.9 ? 'high' : confidence >= 0.75 ? 'mid' : 'low'
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await api<{ data: { rows: AiRecognitionEvent[]; demo: boolean } }>('/v1/events/ai-recognition')
    events.value = response.data.rows
    if (detailEvent.value) detailEvent.value = events.value.find((item) => item.id === detailEvent.value?.id)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '事件载入失败'
  } finally {
    loading.value = false
  }
}

async function setStatus(event: AiRecognitionEvent, status: AiRecognitionEvent['status']) {
  actingId.value = `${event.id}-${status}`
  try {
    const response = await api<{ data: AiRecognitionEvent }>(`/v1/events/ai-recognition/${event.id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to: status }),
    })
    events.value = events.value.map((item) => (item.id === event.id ? response.data : item))
    if (detailEvent.value?.id === event.id) detailEvent.value = response.data
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '事件流转失败'
  } finally {
    actingId.value = ''
  }
}

async function dispatchEvent(event: AiRecognitionEvent) {
  if (event.status === 'reviewing') await setStatus(event, 'confirmed')
  detailEvent.value = undefined
  emit('dispatch', { label: `${event.label}（${event.aircraftName}）`, lng: event.longitude, lat: event.latitude })
}

function openDetail(event: AiRecognitionEvent) {
  detailEvent.value = event
}

onMounted(load)
</script>

<template>
  <section class="ai-events-panel" aria-label="AI 识别事件处置">
    <div class="ai-events-head">
      <div class="segmented compact" aria-label="事件状态筛选">
        <button v-for="item in filters" :key="item.key" type="button" :class="{ active: filter === item.key }" :aria-pressed="filter === item.key" :aria-label="`筛选${item.label}事件`" @click="filter = item.key">{{ item.label }}</button>
      </div>
      <span class="demo-badge">演示数据 · 待接入识别模型</span>
    </div>

    <div v-if="loading" class="ai-events-state" role="status"><LoaderCircle class="spin" />事件载入中</div>
    <div v-else-if="error" class="ai-events-state error">{{ error }}<button type="button" class="ai-retry" aria-label="重试载入事件" @click="load">重试</button></div>
    <div v-else-if="!visible.length" class="ai-events-state">当前无匹配事件</div>

    <ul v-else class="ai-event-list">
      <li v-for="event in visible" :key="event.id">
        <component :is="kindMeta[event.kind].icon" class="ai-event-icon" :class="`kind-${event.kind}`" />
        <div class="ai-event-info">
          <header><b>{{ event.label }}</b><span :class="['confidence', confidenceClass(event.confidence)]">置信度 {{ (event.confidence * 100).toFixed(0) }}%</span></header>
          <small>{{ kindMeta[event.kind].label }} · {{ event.aircraftName }} · {{ event.occurredAt }} · <em :class="`status-${event.status}`">{{ statusLabel[event.status] }}</em></small>
        </div>
        <div class="ai-event-actions">
          <button type="button" :aria-label="`查看 ${event.label} 详情`" @click="openDetail(event)"><Eye />详情</button>
          <button v-if="event.status === 'reviewing'" type="button" :disabled="actingId === `${event.id}-confirmed`" :aria-label="`确认 ${event.label}`" @click="setStatus(event, 'confirmed')"><Check />确认</button>
          <button v-if="event.status === 'reviewing'" type="button" :disabled="Boolean(actingId)" :aria-label="`转派 ${event.label}`" @click="dispatchEvent(event)"><Send />转派</button>
          <button v-if="event.status === 'confirmed'" type="button" :disabled="actingId === `${event.id}-archived`" :aria-label="`归档 ${event.label}`" @click="setStatus(event, 'archived')">归档</button>
        </div>
      </li>
    </ul>
  </section>

  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="detailEvent" class="drawer-overlay" @click.self="detailEvent = undefined">
      <aside class="alert-drawer event-detail-drawer" role="dialog" aria-modal="true" aria-label="AI 识别事件详情">
        <header>
          <div class="drawer-title"><component :is="kindMeta[detailEvent.kind].icon" /><span>AI 识别事件详情</span><b>{{ detailEvent.id }}</b></div>
          <button type="button" class="drawer-close" aria-label="关闭事件详情" @click="detailEvent = undefined"><X /></button>
        </header>

        <div class="drawer-scroll event-detail-body">
          <div class="event-detail-title">
            <h3>{{ detailEvent.label }}</h3>
            <span :class="['wo-status', detailEvent.status === 'reviewing' ? 'pending' : detailEvent.status === 'confirmed' ? 'executing' : 'completed']">{{ statusLabel[detailEvent.status] }}</span>
          </div>

          <div class="event-confidence">
            <div class="event-confidence-head"><span>识别置信度</span><strong>{{ (detailEvent.confidence * 100).toFixed(0) }}%</strong></div>
            <div class="progress"><i :class="confidenceClass(detailEvent.confidence)" :style="{ width: `${detailEvent.confidence * 100}%` }" /></div>
          </div>

          <div class="event-snapshot" aria-label="影像快照">
            <Camera />
            <span>影像快照</span>
            <em>演示数据 · 待接入识别模型</em>
          </div>

          <p class="event-description">{{ detailEvent.description }}</p>

          <dl class="event-facts">
            <div><dt><component :is="kindMeta[detailEvent.kind].icon" />识别类型</dt><dd>{{ kindMeta[detailEvent.kind].label }}</dd></div>
            <div><dt><MapPin />发生位置</dt><dd>{{ detailEvent.location }}</dd></div>
            <div><dt><Crosshair />坐标</dt><dd class="mono">{{ detailEvent.longitude.toFixed(4) }}, {{ detailEvent.latitude.toFixed(4) }}</dd></div>
            <div><dt><Clock3 />发生时间</dt><dd>{{ detailEvent.occurredAt }}</dd></div>
            <div><dt><Users />识别机型</dt><dd>{{ detailEvent.aircraftName }}</dd></div>
          </dl>

          <div class="event-timeline" aria-label="处置记录">
            <h4>处置记录</h4>
            <ol>
              <li v-for="(step, index) in timeline" :key="step" :class="{ done: statusOrder[detailEvent.status] >= index, current: statusOrder[detailEvent.status] === index }">
                <i /><span>{{ step }}</span>
              </li>
            </ol>
          </div>
        </div>

        <footer class="event-detail-footer">
          <button v-if="detailEvent.status === 'reviewing'" type="button" :aria-label="`确认 ${detailEvent.label}`" @click="setStatus(detailEvent, 'confirmed')"><Check />确认</button>
          <button v-if="detailEvent.status === 'reviewing'" type="button" :aria-label="`转派 ${detailEvent.label}`" @click="dispatchEvent(detailEvent)"><Send />转派处置</button>
          <button v-if="detailEvent.status === 'confirmed'" type="button" :aria-label="`归档 ${detailEvent.label}`" @click="setStatus(detailEvent, 'archived')">归档</button>
          <button type="button" class="secondary" aria-label="关闭事件详情" @click="detailEvent = undefined">关闭</button>
        </footer>
      </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Radar, Send, TriangleAlert } from 'lucide-vue-next'
import { api } from '@/services/api'
import type { DispatchCandidate, DispatchTaskType } from '@/types'

const props = withDefaults(defineProps<{
  taskType?: DispatchTaskType
  lng?: number
  lat?: number
  priority?: 'normal' | 'high'
  label?: string
}>(), {
  taskType: 'inspect',
  lng: 121.4737,
  lat: 31.2304,
  priority: 'normal',
})
const emit = defineEmits<{ dispatched: [message: string] }>()

const taskTypes: Array<{ key: DispatchTaskType; label: string }> = [
  { key: 'patrol', label: '巡逻' }, { key: 'inspect', label: '巡检' }, { key: 'emergency', label: '应急' },
]
const presets = [
  { name: '中心城区', lng: 121.4737, lat: 31.2304 },
  { name: '滨江沿岸', lng: 121.462, lat: 31.217 },
  { name: '北区工业园', lng: 121.483, lat: 31.242 },
  { name: '河道中段', lng: 121.452, lat: 31.208 },
]
const taskType = ref<DispatchTaskType>(props.taskType)
const lng = ref(props.lng)
const lat = ref(props.lat)
const priority = ref<'normal' | 'high'>(props.priority)
const contextLabel = ref(props.label ?? '')
const rows = ref<DispatchCandidate[]>([])
const loading = ref(false)
const error = ref('')
const dispatching = ref(false)
const selectedId = ref('')
const confirmOpen = ref(false)

const selected = () => rows.value.find((item) => item.aircraftId === selectedId.value)

async function recommend() {
  loading.value = true; error.value = ''; confirmOpen.value = false
  try {
    const response = await api<{ data: { rows: DispatchCandidate[] } }>(`/v1/dispatch/candidates?taskType=${taskType.value}&lng=${lng.value}&lat=${lat.value}&priority=${priority.value}`)
    rows.value = response.data.rows
    selectedId.value = rows.value[0]?.aircraftId ?? ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '推荐失败'
  } finally {
    loading.value = false
  }
}

async function dispatch() {
  if (!selectedId.value) return
  dispatching.value = true; error.value = ''
  try {
    const response = await api<{ data: { taskId: string; aircraftName: string; etaMinutes: number; message: string } }>('/v1/dispatch/tasks', {
      method: 'POST',
      body: JSON.stringify({ taskType: taskType.value, lng: lng.value, lat: lat.value, priority: priority.value, aircraftId: selectedId.value }),
    })
    confirmOpen.value = false
    emit('dispatched', response.data.message)
    await recommend()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '派发失败'
  } finally {
    dispatching.value = false
  }
}

function applyContext() {
  taskType.value = props.taskType
  lng.value = props.lng
  lat.value = props.lat
  priority.value = props.priority
  contextLabel.value = props.label ?? ''
  void recommend()
}

function scoreClass(score: number) {
  return score >= 0.75 ? 'lvl-top' : score >= 0.55 ? 'lvl-mid' : 'lvl-low'
}

watch(() => [props.taskType, props.lng, props.lat, props.priority, props.label], applyContext)
onMounted(recommend)
</script>

<template>
  <div class="panel-scene">
    <div class="dispatch-form">
      <div class="segmented" aria-label="任务类型"><button v-for="item in taskTypes" :key="item.key" type="button" :class="{ active: taskType === item.key }" :aria-pressed="taskType === item.key" :aria-label="`任务类型 ${item.label}`" @click="taskType = item.key; recommend()">{{ item.label }}</button></div>
      <div class="dispatch-presets" aria-label="任务位置">
        <button v-for="p in presets" :key="p.name" type="button" :class="{ active: lng === p.lng && lat === p.lat }" :aria-pressed="lng === p.lng && lat === p.lat" :title="`将任务位置设为${p.name}`" :aria-label="`任务位置 ${p.name}`" @click="lng = p.lng; lat = p.lat; contextLabel = p.name; recommend()">{{ p.name }}</button>
      </div>
      <p v-if="contextLabel" class="dispatch-context">当前目标：<strong>{{ contextLabel }}</strong> · {{ lng.toFixed(4) }}, {{ lat.toFixed(4) }}</p>
      <div class="dispatch-row">
        <div class="priority-control" role="group" aria-label="优先级">
          <span>优先级</span>
          <div class="segmented priority-segmented">
            <button type="button" :class="{ active: priority === 'normal' }" :aria-pressed="priority === 'normal'" aria-label="常规优先级" @click="priority = 'normal'; recommend()">常规</button>
            <button type="button" :class="{ active: priority === 'high' }" :aria-pressed="priority === 'high'" aria-label="紧急优先级" @click="priority = 'high'; recommend()">紧急</button>
          </div>
        </div>
        <button type="button" class="dispatch-query" title="按当前条件重新评估" aria-label="重新评估推荐结果" @click="recommend()"><Radar />重新评估</button>
      </div>
    </div>

    <p v-if="error" class="dispatch-error" role="alert"><TriangleAlert />{{ error }}</p>
    <div v-if="loading" class="scene-loading"><span class="spinner" />评估可用无人机中…</div>

    <ul v-else-if="rows.length" class="dispatch-list">
      <li v-for="(row, index) in rows" :key="row.aircraftId" :class="[{ selected: selectedId === row.aircraftId }, { 'rank-first': index === 0 }]">
        <button type="button" class="dispatch-item" :aria-pressed="selectedId === row.aircraftId" :aria-label="`选择 ${row.name}`" @click="selectedId = row.aircraftId; confirmOpen = false">
          <span class="rank">{{ index + 1 }}</span>
          <div class="dispatch-info">
            <header><b>{{ row.name }}</b><em>综合评分 {{ (row.score * 100).toFixed(0) }}</em></header>
            <div class="progress"><i :class="scoreClass(row.score)" :style="{ width: `${row.score * 100}%` }" /></div>
            <small>{{ row.model }} · {{ row.status === 'standby' ? '待命' : row.status === 'flying' ? '执行中' : '告警' }} · 距目标 {{ (row.distanceM / 1000).toFixed(1) }}km · 预计 {{ row.etaMinutes }}min 到场 · 电量 {{ row.batteryPercent }}%</small>
            <ul class="dispatch-reasons"><li v-for="reason in row.reasons" :key="reason">{{ reason }}</li></ul>
          </div>
        </button>
      </li>
    </ul>
    <div v-else class="scene-empty">暂无可推荐无人机</div>

    <footer class="dispatch-footer">
      <div v-if="confirmOpen && selected()" class="dispatch-confirm" role="alertdialog" aria-label="确认智能派发">
        <p>确认派发 <strong>{{ selected()?.name }}</strong> 执行{{ taskType === 'emergency' ? '应急' : taskType === 'patrol' ? '巡逻' : '巡检' }}任务？预计 {{ selected()?.etaMinutes }} 分钟到场。</p>
        <div class="dispatch-confirm-actions">
          <button type="button" class="dispatch-submit" :disabled="dispatching" aria-label="确认执行智能派发" @click="dispatch"><Send v-if="!dispatching" />{{ dispatching ? '派发中…' : '确认派发' }}</button>
          <button type="button" class="ghost-btn" aria-label="取消派发" @click="confirmOpen = false">取消</button>
        </div>
      </div>
      <button v-else type="button" class="dispatch-submit" :disabled="!selectedId || dispatching" aria-label="执行智能派发" @click="confirmOpen = true">
        <Send />执行智能派发
      </button>
      <span>推荐依据：距离 40% · 电量 30% · 空闲度 20% · 机型 10%</span>
    </footer>
  </div>
</template>

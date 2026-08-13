<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Wrench } from 'lucide-vue-next'
import { api } from '@/services/api'
import type { AircraftHealth, WorkOrder } from '@/types'

const emit = defineEmits<{ created: [message: string] }>()

const rows = ref<AircraftHealth[]>([])
const loading = ref(false)
const error = ref('')
const creatingId = ref('')

function scoreClass(score: number) {
  return score >= 80 ? 'lvl-top' : score >= 65 ? 'lvl-mid' : 'lvl-low'
}
function scoreLabel(score: number) {
  return score >= 80 ? '良好' : score >= 65 ? '关注' : '需保养'
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await api<{ data: { rows: AircraftHealth[] } }>('/v1/aircraft/health')
    rows.value = response.data.rows
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '设备数据载入失败'
  } finally {
    loading.value = false
  }
}

async function createMaintenance(item: AircraftHealth) {
  creatingId.value = item.aircraftId
  try {
    const advice = item.parts.find((part) => part.remainingPercent < 15)?.advice ?? '计划保养'
    const response = await api<{ data: WorkOrder }>('/v1/work-orders', {
      method: 'POST',
      body: JSON.stringify({
        title: `设备保养 · ${item.name}`,
        lineName: '设备保养航线',
        orgName: '市级指挥中心',
        aircraftName: item.name,
        source: 'maintenance',
        sourceAlertId: `health-${item.aircraftId}`,
      }),
    })
    emit('created', `${response.data.id} · ${advice}`)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '保养工单生成失败'
  } finally {
    creatingId.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="panel-scene">
    <p v-if="error" class="dispatch-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="scene-loading"><span class="spinner" />设备健康评估中…</div>

    <ul v-else-if="rows.length" class="health-list">
      <li v-for="item in rows" :key="item.aircraftId" :class="{ 'needs-care': item.healthScore < 70 }">
        <div class="health-head">
          <div><b>{{ item.name }}</b><small>{{ item.model }} · 累计 {{ item.flightHours }}h / {{ item.totalFlights }} 架次</small></div>
          <div class="health-score" :class="scoreClass(item.healthScore)"><strong>{{ item.healthScore }}</strong><span>{{ scoreLabel(item.healthScore) }}</span></div>
        </div>
        <div class="health-parts">
          <div v-for="part in item.parts" :key="part.part" class="health-part">
            <span>{{ part.part }}</span><i><em :class="scoreClass(part.remainingPercent)" :style="{ width: `${part.remainingPercent}%` }" /></i><small>{{ part.remainingPercent }}%</small>
          </div>
          <p v-if="item.parts.some((part) => part.remainingPercent < 15)" class="health-advice"><Wrench />{{ item.parts.find((part) => part.remainingPercent < 15)?.advice }}</p>
          <button v-if="item.healthScore < 70 || item.parts.some((part) => part.remainingPercent < 15)" type="button" class="health-action" :disabled="creatingId === item.aircraftId" :aria-label="`为 ${item.name} 生成保养工单`" @click="createMaintenance(item)">
            <Wrench />{{ creatingId === item.aircraftId ? '生成中…' : '生成保养工单' }}
          </button>
        </div>
      </li>
    </ul>
    <div v-else class="scene-empty">暂无设备数据</div>
  </div>
</template>

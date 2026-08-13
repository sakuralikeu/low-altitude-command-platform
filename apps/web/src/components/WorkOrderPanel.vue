<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, CalendarPlus, CheckCircle2, ChevronDown, Clock3, MapPinned, Plane, ScanEye, X } from 'lucide-vue-next'
import { api } from '@/services/api'
import type { WorkOrder, WorkOrderStatus } from '@/types'

const props = defineProps<{ highlightId?: string }>()
const emit = defineEmits<{ previewRoute: [lineName: string, aircraftName?: string] }>()
const router = useRouter()

const statusTabs: Array<{ key: WorkOrderStatus | 'all'; label: string }> = [
  { key: 'all', label: '全部' }, { key: 'pending', label: '待接收' }, { key: 'received', label: '已接收' },
  { key: 'executing', label: '执行中' }, { key: 'completed', label: '已完结' },
]
const statusLabel: Record<WorkOrderStatus, string> = { pending: '待接收', received: '已接收', executing: '执行中', completed: '已完结' }
const nextAction: Partial<Record<WorkOrderStatus, { to: WorkOrderStatus; label: string }>> = {
  pending: { to: 'received', label: '接收' },
  received: { to: 'executing', label: '开始执行' },
  executing: { to: 'completed', label: '结案' },
}

const status = ref<WorkOrderStatus | 'all'>('all')
const orders = ref<WorkOrder[]>([])
const totals = ref<Record<WorkOrderStatus, number>>({ pending: 0, received: 0, executing: 0, completed: 0 })
const loading = ref(false)
const error = ref('')
const actingId = ref('')
const generating = ref(false)
const expandedId = ref('')
const feedback = ref<{ kind: 'success' | 'info'; message: string }>()

const visibleOrders = computed(() => (status.value === 'all' ? orders.value : orders.value.filter((item) => item.status === status.value)))

async function loadOrders() {
  loading.value = true; error.value = ''
  try {
    const orderResponse = await api<{ data: { rows: WorkOrder[]; totals: Record<WorkOrderStatus, number> } }>('/v1/work-orders')
    orders.value = orderResponse.data.rows
    totals.value = orderResponse.data.totals
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '工单载入失败'
  } finally {
    loading.value = false
  }
}

async function transition(order: WorkOrder) {
  const action = nextAction[order.status]
  if (!action) return
  actingId.value = order.id
  try {
    await api(`/v1/work-orders/${order.id}/transition`, { method: 'POST', body: JSON.stringify({ to: action.to }) })
    await loadOrders()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '状态流转失败'
  } finally {
    actingId.value = ''
  }
}

async function generateDaily() {
  generating.value = true
  feedback.value = undefined
  try {
    const response = await api<{ data: { generated: number; skipped: number; message: string } }>('/v1/work-orders/generate', { method: 'POST', body: JSON.stringify({ period: 'daily' }) })
    if (response.data.generated > 0) await loadOrders()
    feedback.value = { kind: response.data.generated > 0 ? 'success' : 'info', message: response.data.message }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '生成失败'
  } finally {
    generating.value = false
  }
}

function applyHighlight() {
  if (!props.highlightId) return
  const target = orders.value.find((item) => item.id === props.highlightId)
  if (!target) return
  status.value = 'all'
  expandedId.value = target.id
  void nextTick(() => document.getElementById(`wo-${target.id}`)?.scrollIntoView({ block: 'nearest' }))
}

watch(() => props.highlightId, applyHighlight)
watch(orders, applyHighlight)
onMounted(loadOrders)
</script>

<template>
  <div class="panel-scene">
    <div class="status-tabs workorder-tabs" aria-label="工单状态">
      <button v-for="tab in statusTabs" :key="tab.key" type="button" :class="{ active: status === tab.key }" :aria-pressed="status === tab.key" :aria-label="`筛选${tab.label}工单`" @click="status = tab.key">
        <span>{{ tab.label }}</span><strong>{{ tab.key === 'all' ? Object.values(totals).reduce((a, b) => a + b, 0) : totals[tab.key] }}</strong>
      </button>
    </div>
    <div class="workorder-toolbar">
      <button type="button" :disabled="generating" title="按日航线生成今日巡检计划" aria-label="生成今日巡检计划" @click="generateDaily"><CalendarPlus />{{ generating ? '生成中…' : '生成今日巡检计划' }}</button>
    </div>

    <div v-if="feedback" class="workorder-feedback" :class="feedback.kind" role="status"><CheckCircle2 /><span>{{ feedback.message }}</span><button type="button" aria-label="关闭生成结果" @click="feedback = undefined"><X /></button></div>

    <p v-if="error" class="dispatch-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="scene-loading"><span class="spinner" />工单载入中…</div>

    <ul v-else-if="visibleOrders.length" class="workorder-list">
      <li v-for="order in visibleOrders" :id="`wo-${order.id}`" :key="order.id" :class="{ expanded: expandedId === order.id, highlight: highlightId === order.id }">
        <div class="wo-row">
          <button type="button" class="wo-summary" :aria-expanded="expandedId === order.id" :aria-label="`展开 ${order.title}`" @click="expandedId = expandedId === order.id ? '' : order.id">
            <div class="wo-main"><b>{{ order.title }}</b><small>{{ order.id }} · {{ order.orgName }} · {{ order.lineName }}</small></div>
            <ChevronDown />
          </button>
          <div class="wo-side">
            <span :class="['wo-status', order.status]">{{ statusLabel[order.status] }}</span>
            <button v-if="nextAction[order.status]" type="button" :disabled="actingId === order.id" :aria-label="`${nextAction[order.status]!.label} ${order.title}`" @click="transition(order)">{{ actingId === order.id ? '…' : nextAction[order.status]!.label }}<ArrowRight /></button>
          </div>
        </div>
        <div v-if="expandedId === order.id" class="wo-detail">
          <span><MapPinned />执行航线<strong>{{ order.lineName }}</strong></span>
          <span><Plane />执行设备<strong>{{ order.aircraftName || '待调度分配' }}</strong></span>
          <span><Clock3 />创建时间<strong>{{ order.createdAt }}</strong></span>
          <span><Clock3 />要求完成<strong>{{ order.dueAt }}</strong></span>
          <button type="button" class="wo-route-preview" :aria-label="`在地图预览 ${order.lineName}`" @click="emit('previewRoute', order.lineName, order.aircraftName)"><MapPinned />在地图预览航线</button>
        </div>
      </li>
    </ul>
    <div v-else class="scene-empty">该状态下暂无工单</div>

    <section class="ai-events ai-events-jump" aria-label="AI 识别事件入口">
      <header><ScanEye /><span>AI 识别事件请在独立处置台复核</span></header>
      <button type="button" class="ghost-btn" aria-label="前往 AI 事件处置" @click="router.replace({ query: { ...router.currentRoute.value.query, module: 'ai' } })">前往 AI 事件处置</button>
    </section>
  </div>
</template>

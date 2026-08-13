<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])
const props = defineProps<{ labels: string[]; values: number[]; unit: string; color?: string }>()
const root = ref<HTMLDivElement>()
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
const description = computed(() => props.labels.map((label, index) => `${label} ${props.values[index] ?? 0}${props.unit}`).join('；'))

function render() {
  chart?.setOption({
    animationDuration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
    grid: { left: 2, right: 10, top: 8, bottom: 2, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: '#112126', borderColor: '#31515a', textStyle: { color: '#e7efea' }, valueFormatter: (value: number | string) => `${value} ${props.unit}` },
    xAxis: { type: 'value', axisLabel: { color: '#789198', fontSize: 10 }, splitLine: { lineStyle: { color: '#1f3439' } }, axisLine: { show: false } },
    yAxis: { type: 'category', inverse: true, data: props.labels, axisLabel: { color: '#b8c8c5', fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: 'bar', data: props.values, barWidth: 8, itemStyle: { color: props.color || '#38b795', borderRadius: [0, 2, 2, 0] }, label: { show: true, position: 'right', color: '#d6e2de', fontSize: 10, formatter: `{c} ${props.unit}` } }],
  })
}
onMounted(() => { if (root.value) { chart = echarts.init(root.value); observer = new ResizeObserver(() => chart?.resize()); observer.observe(root.value); render() } })
watch(() => [props.labels, props.values, props.unit, props.color], render, { deep: true })
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="root" class="chart-root" role="img" :aria-label="`飞行统计横向条形图：${description}`" /></template>

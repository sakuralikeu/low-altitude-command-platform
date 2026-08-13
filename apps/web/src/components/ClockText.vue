<script setup lang="ts">
// 独立时钟组件：把每秒触发的重渲染隔离在本组件内，避免整页每秒 diff
import { useNow } from '@vueuse/core'

const now = useNow({ interval: 1000 })
const timeText = () => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now.value)
</script>

<template>
  <strong class="clock-text" aria-live="off">{{ timeText() }}</strong>
</template>

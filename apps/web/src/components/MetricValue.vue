<script setup lang="ts">
import { useCountUp } from '@/composables/useCountUp'

const props = defineProps<{ value: number }>()
const display = useCountUp(() => props.value)
</script>

<template>
  {{ display.toLocaleString() }}
</template>

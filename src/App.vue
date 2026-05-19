<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Panel from './components/Panel.vue'
import Settings from './components/Settings.vue'
import SnipScreenshot from './components/SnipScreenshot.vue'

const currentRoute = ref(window.location.hash || '#/panel')

onMounted(() => {
  window.addEventListener('hashchange', () => {
    currentRoute.value = window.location.hash || '#/panel'
  })

  window.electronAPI.onScreenshotTaken(() => {
    window.electronAPI.showPanel()
  })
})

const isPanel = computed(() => currentRoute.value === '#/panel' || currentRoute.value === '#/')
const isSettings = computed(() => currentRoute.value === '#/settings')
const isScreenshot = computed(() => currentRoute.value === '#/screenshot' || currentRoute.value.startsWith('#/screenshot'))

const closeSettings = () => {
  window.location.hash = '/panel'
}
</script>

<template>
  <SnipScreenshot v-if="isScreenshot" />
  <Panel v-else-if="isPanel" />
  <Settings v-else-if="isSettings" />
  <div v-else style="padding: 20px; color: white;">
    未知页面
  </div>
</template>

<style>
#app {
  width: 100%;
  height: 100vh;
  background: transparent;
}
</style>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const imageData = ref('')
const naturalSize = ref({ w: 0, h: 0 })
const scale = ref(1)

let dragging = false
let dragStartScreenX = 0
let dragStartScreenY = 0
let dragStartWinX = 0
let dragStartWinY = 0
let rafId: number | null = null
let pendingX = 0
let pendingY = 0

const onImageLoad = (e: Event) => {
  const img = e.target as HTMLImageElement
  naturalSize.value = { w: img.naturalWidth, h: img.naturalHeight }
}

const applyScale = async (next: number, anchor: { clientX: number; clientY: number }) => {
  const minScale = 0.1
  const maxScale = 8
  const clamped = Math.max(minScale, Math.min(maxScale, next))
  if (clamped === scale.value) return
  if (!naturalSize.value.w || !naturalSize.value.h) {
    scale.value = clamped
    return
  }

  const bounds = await window.electronAPI.getPinnedBounds()
  if (!bounds) {
    scale.value = clamped
    return
  }

  const oldW = bounds.width
  const oldH = bounds.height
  const newW = Math.max(40, Math.round(naturalSize.value.w * clamped))
  const newH = Math.max(30, Math.round(naturalSize.value.h * clamped))

  const ax = Math.max(0, Math.min(oldW, anchor.clientX))
  const ay = Math.max(0, Math.min(oldH, anchor.clientY))
  const ratioX = newW / oldW
  const ratioY = newH / oldH
  const newX = bounds.x + Math.round(ax - ax * ratioX)
  const newY = bounds.y + Math.round(ay - ay * ratioY)

  await window.electronAPI.setPinnedBounds(newX, newY, newW, newH)
  scale.value = clamped
}

const onWheel = (e: WheelEvent) => {
  if (dragging) return
  e.preventDefault()
  const factor = e.deltaY > 0 ? 0.9 : 1.1
  applyScale(scale.value * factor, { clientX: e.clientX, clientY: e.clientY })
}

const flushMove = () => {
  rafId = null
  if (!dragging) return
  window.electronAPI.movePinnedWindow(pendingX, pendingY)
}

const onMouseDown = async (e: MouseEvent) => {
  if (e.button !== 0) return
  e.preventDefault()
  const bounds = await window.electronAPI.getPinnedBounds()
  if (!bounds) return
  await window.electronAPI.pinnedDragStart()
  dragging = true
  dragStartScreenX = e.screenX
  dragStartScreenY = e.screenY
  dragStartWinX = bounds.x
  dragStartWinY = bounds.y
  pendingX = bounds.x
  pendingY = bounds.y
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const onMouseMove = (e: MouseEvent) => {
  if (!dragging) return
  pendingX = dragStartWinX + (e.screenX - dragStartScreenX)
  pendingY = dragStartWinY + (e.screenY - dragStartScreenY)
  if (rafId === null) {
    rafId = requestAnimationFrame(flushMove)
  }
}

const onMouseUp = () => {
  if (!dragging) return
  dragging = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  window.electronAPI.movePinnedWindow(pendingX, pendingY)
  window.electronAPI.pinnedDragEnd()
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.electronAPI.closePinnedWindow()
  }
}

const onContextMenu = (e: MouseEvent) => {
  e.preventDefault()
  window.electronAPI.closePinnedWindow()
}

onMounted(async () => {
  try {
    imageData.value = await window.electronAPI.getPinnedImage()
  } catch (err) {
    console.error('getPinnedImage failed:', err)
  }
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})
</script>

<template>
  <div
    class="pinned-root"
    @wheel="onWheel"
    @mousedown="onMouseDown"
    @contextmenu="onContextMenu"
  >
    <img
      v-if="imageData"
      :src="imageData"
      class="pinned-image"
      draggable="false"
      @load="onImageLoad"
    />
  </div>
</template>

<style scoped>
.pinned-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: #000;
  cursor: grab;
  user-select: none;
  overflow: hidden;
}

.pinned-root::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 2px;
  background: linear-gradient(135deg, #ff6b8b 0%, #e94560 30%, #a855f7 65%, #38bdf8 100%);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
          mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  pointer-events: none;
  box-sizing: border-box;
}

.pinned-root:active {
  cursor: grabbing;
}

.pinned-image {
  width: 100%;
  height: 100%;
  object-fit: fill;
  display: block;
  -webkit-user-drag: none;
  pointer-events: none;
}
</style>

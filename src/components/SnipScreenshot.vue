<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

type Mode = 'select' | 'annotate'
type Tool = 'pen' | 'rect' | 'arrow'

interface Point { x: number; y: number }
interface Annotation {
  tool: Tool
  color: string
  width: number
  points: Point[]
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const backgroundImage = ref<HTMLImageElement | null>(null)

const mode = ref<Mode>('select')
const isPointerDown = ref(false)
const startPoint = ref<Point>({ x: 0, y: 0 })
const cursor = ref<Point>({ x: 0, y: 0 })
const hovering = ref(false)

const selection = ref({ x: 0, y: 0, width: 0, height: 0 })
const annotations = ref<Annotation[]>([])
const drawingAnnotation = ref<Annotation | null>(null)

const tool = ref<Tool>('pen')
const color = ref('#ff3b30')
const strokeWidth = ref(4)
const customPrompt = ref('')
const newChat = ref(false)

const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000']
const WIDTHS = [2, 4, 7]

const hasSelection = computed(() => selection.value.width > 5 && selection.value.height > 5)

const annotationToolbarStyle = computed(() => {
  if (!hasSelection.value || mode.value !== 'annotate') return { display: 'none' as const }
  const s = selection.value
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tbW = 440
  const tbH = 44
  const gap = 8

  let top = s.y + s.height + gap
  let left = s.x + s.width - tbW
  if (top + tbH > vh - 90) {
    top = s.y - tbH - gap
    if (top < 8) top = s.y + gap
  }
  if (left < 8) left = 8
  if (left + tbW > vw - 8) left = vw - tbW - 8
  return { top: top + 'px', left: left + 'px' }
})

const inSelection = (p: Point) => {
  const s = selection.value
  return p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height
}

const drawArrow = (ctx: CanvasRenderingContext2D, s: Point, e: Point, w: number) => {
  const head = 10 + w * 2.2
  const angle = Math.atan2(e.y - s.y, e.x - s.x)
  const lineEndX = e.x - (head * 0.7) * Math.cos(angle)
  const lineEndY = e.y - (head * 0.7) * Math.sin(angle)
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(lineEndX, lineEndY)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(e.x, e.y)
  ctx.lineTo(e.x - head * Math.cos(angle - Math.PI / 7), e.y - head * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(e.x - head * Math.cos(angle + Math.PI / 7), e.y - head * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

const drawAnnotation = (ctx: CanvasRenderingContext2D, a: Annotation) => {
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = a.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (a.tool === 'pen' && a.points.length > 0) {
    ctx.beginPath()
    a.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
  } else if (a.tool === 'rect' && a.points.length >= 2) {
    const s = a.points[0]
    const e = a.points[a.points.length - 1]
    ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y)
  } else if (a.tool === 'arrow' && a.points.length >= 2) {
    const s = a.points[0]
    const e = a.points[a.points.length - 1]
    drawArrow(ctx, s, e, a.width)
  }
}

const draw = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (backgroundImage.value) ctx.drawImage(backgroundImage.value, 0, 0)

  if (hasSelection.value) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.beginPath()
    ctx.rect(0, 0, canvas.width, canvas.height)
    const s = selection.value
    ctx.rect(s.x, s.y, s.width, s.height)
    ctx.fill('evenodd')

    ctx.save()
    ctx.beginPath()
    ctx.rect(s.x, s.y, s.width, s.height)
    ctx.clip()
    for (const a of annotations.value) drawAnnotation(ctx, a)
    if (drawingAnnotation.value) drawAnnotation(ctx, drawingAnnotation.value)
    ctx.restore()

    ctx.strokeStyle = '#c86b7d'
    ctx.lineWidth = 1.5
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.width - 1, s.height - 1)

    const handles: [number, number][] = [
      [s.x, s.y], [s.x + s.width, s.y],
      [s.x, s.y + s.height], [s.x + s.width, s.y + s.height],
      [s.x + s.width / 2, s.y], [s.x + s.width, s.y + s.height / 2],
      [s.x + s.width / 2, s.y + s.height], [s.x, s.y + s.height / 2]
    ]
    for (const [hx, hy] of handles) {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#c86b7d'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(hx - 3.5, hy - 3.5, 7, 7)
      ctx.fill()
      ctx.stroke()
    }

    const label = `${s.width} × ${s.height}`
    ctx.font = '12px -apple-system, "SF Pro Display", system-ui, sans-serif'
    const tw = ctx.measureText(label).width + 14
    const th = 22
    let lx = s.x
    let ly = s.y - th - 4
    if (ly < 4) ly = s.y + 4
    ctx.fillStyle = 'rgba(200, 107, 125, 0.95)'
    ctx.fillRect(lx, ly, tw, th)
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, lx + 7, ly + th / 2)
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (hovering.value && mode.value === 'select') {
      ctx.strokeStyle = '#c86b7d'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(0, cursor.value.y + 0.5)
      ctx.lineTo(canvas.width, cursor.value.y + 0.5)
      ctx.moveTo(cursor.value.x + 0.5, 0)
      ctx.lineTo(cursor.value.x + 0.5, canvas.height)
      ctx.stroke()
      ctx.setLineDash([])

      const coord = `${cursor.value.x}, ${cursor.value.y}`
      ctx.font = '11px -apple-system, system-ui, sans-serif'
      const ctw = ctx.measureText(coord).width + 12
      const cth = 18
      let cx = cursor.value.x + 14
      let cy = cursor.value.y + 14
      if (cx + ctw > canvas.width - 4) cx = cursor.value.x - ctw - 14
      if (cy + cth > canvas.height - 4) cy = cursor.value.y - cth - 14
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(cx, cy, ctw, cth)
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'middle'
      ctx.fillText(coord, cx + 6, cy + cth / 2)
    }
  }
}

const onMouseDown = (e: MouseEvent) => {
  const p = { x: e.clientX, y: e.clientY }
  isPointerDown.value = true
  startPoint.value = p
  cursor.value = p

  if (mode.value === 'select') {
    selection.value = { x: p.x, y: p.y, width: 0, height: 0 }
  } else if (mode.value === 'annotate' && inSelection(p)) {
    drawingAnnotation.value = {
      tool: tool.value,
      color: color.value,
      width: strokeWidth.value,
      points: [p]
    }
  }
  draw()
}

const onMouseMove = (e: MouseEvent) => {
  cursor.value = { x: e.clientX, y: e.clientY }
  hovering.value = true

  if (!isPointerDown.value) {
    if (mode.value === 'select' && !hasSelection.value) draw()
    return
  }

  if (mode.value === 'select') {
    const sp = startPoint.value
    selection.value = {
      x: Math.min(sp.x, cursor.value.x),
      y: Math.min(sp.y, cursor.value.y),
      width: Math.abs(cursor.value.x - sp.x),
      height: Math.abs(cursor.value.y - sp.y)
    }
  } else if (mode.value === 'annotate' && drawingAnnotation.value) {
    const a = drawingAnnotation.value
    if (a.tool === 'pen') {
      a.points.push({ ...cursor.value })
    } else {
      a.points[1] = { ...cursor.value }
    }
  }
  draw()
}

const onMouseUp = () => {
  if (!isPointerDown.value) return
  isPointerDown.value = false

  if (mode.value === 'select') {
    if (hasSelection.value) {
      mode.value = 'annotate'
    } else {
      selection.value = { x: 0, y: 0, width: 0, height: 0 }
    }
  } else if (mode.value === 'annotate' && drawingAnnotation.value) {
    annotations.value.push(drawingAnnotation.value)
    drawingAnnotation.value = null
  }
  draw()
}

const onMouseLeave = () => {
  hovering.value = false
  draw()
}

const setTool = (t: Tool) => { tool.value = t }
const setColor = (c: string) => { color.value = c }
const setWidth = (w: number) => { strokeWidth.value = w }

const undo = () => {
  annotations.value.pop()
  draw()
}

const clearAnnotations = () => {
  annotations.value = []
  draw()
}

const reselect = () => {
  annotations.value = []
  selection.value = { x: 0, y: 0, width: 0, height: 0 }
  mode.value = 'select'
  draw()
}

const confirmSelection = async () => {
  if (!hasSelection.value || !backgroundImage.value) return
  const s = selection.value
  const out = document.createElement('canvas')
  out.width = s.width
  out.height = s.height
  const ctx = out.getContext('2d')
  if (!ctx) return

  ctx.drawImage(backgroundImage.value, s.x, s.y, s.width, s.height, 0, 0, s.width, s.height)
  ctx.save()
  ctx.translate(-s.x, -s.y)
  for (const a of annotations.value) drawAnnotation(ctx, a)
  ctx.restore()

  const dataUrl = out.toDataURL('image/png')
  const prompt = customPrompt.value.trim() || '解析截图内容，回答截图相关问题，提取关键信息'
  
  localStorage.setItem('newChat', newChat.value ? 'true' : 'false')
  
  await window.electronAPI.screenshotCropped(dataUrl, prompt)
}

const cancelScreenshot = () => {
  window.electronAPI.exitScreenshot()
}

const openSettings = () => {
  window.electronAPI.openSettingsFromScreenshot()
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (mode.value === 'annotate') reselect()
    else cancelScreenshot()
  } else if (e.key === 'Enter' && hasSelection.value) {
    e.preventDefault()
    confirmSelection()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  }
}

onMounted(() => {
  newChat.value = false
  const params = new URLSearchParams(window.location.search)
  const imageData = params.get('image')
  if (imageData) {
    const img = new Image()
    img.onload = () => {
      backgroundImage.value = img
      const canvas = canvasRef.value
      if (canvas) {
        canvas.width = img.width
        canvas.height = img.height
      }
      draw()
    }
    img.src = decodeURIComponent(imageData)
  }
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="snip-container">
    <canvas
      ref="canvasRef"
      class="snip-canvas"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
    ></canvas>

    <div class="annot-toolbar" :style="annotationToolbarStyle">
      <div class="group">
        <button :class="['tool-btn', { active: tool === 'pen' }]" @click="setTool('pen')" title="画笔">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 21l3.5-1L20 6.5a2.121 2.121 0 0 0-3-3L3.5 17 3 21z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M14.5 5.5l4 4" stroke="currentColor" stroke-width="1.7"/>
          </svg>
        </button>
        <button :class="['tool-btn', { active: tool === 'rect' }]" @click="setTool('rect')" title="矩形">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" stroke-width="1.8"/>
          </svg>
        </button>
        <button :class="['tool-btn', { active: tool === 'arrow' }]" @click="setTool('arrow')" title="箭头">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 19L19 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
            <path d="M11 5h8v8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="divider"></div>
      <div class="group">
        <button
          v-for="c in PRESET_COLORS"
          :key="c"
          class="color-btn"
          :class="{ active: color === c }"
          :style="{ background: c }"
          @click="setColor(c)"
        ></button>
      </div>
      <div class="divider"></div>
      <div class="group">
        <button
          v-for="w in WIDTHS"
          :key="w"
          class="width-btn"
          :class="{ active: strokeWidth === w }"
          @click="setWidth(w)"
          :title="`粗细 ${w}px`"
        >
          <span class="dot" :style="{ width: (w + 2) + 'px', height: (w + 2) + 'px' }"></span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="group">
        <button class="tool-btn" @click="undo" :disabled="!annotations.length" title="撤销 (Ctrl+Z)">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="tool-btn" @click="clearAnnotations" :disabled="!annotations.length" title="清空标注">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="tool-btn" @click="reselect" title="重新框选">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4v6h6M21 20v-6h-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 10A9 9 0 0 1 18.5 6.5M21 14a9 9 0 0 1-15.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="snip-toolbar">
      <div class="toolbar-hint" v-if="mode === 'select'">
        <span>按住鼠标框选区域</span>
        <span class="sep">·</span>
        <kbd>Esc</kbd> 取消
      </div>
      <div class="toolbar-hint" v-else>
        <span>选择工具开始标注</span>
        <span class="sep">·</span>
        <kbd>Ctrl+Z</kbd> 撤销
        <span class="sep">·</span>
        <kbd>Esc</kbd> 重选
      </div>
      <div class="toolbar-prompt">
        <input
          v-model="customPrompt"
          type="text"
          placeholder="输入问题（可选）..."
          class="prompt-input"
          @keyup.enter="confirmSelection"
        />
      </div>
      <div class="toolbar-actions">
        <label class="new-chat-checkbox">
          <input type="checkbox" v-model="newChat" />
          <span>New Chat</span>
        </label>
        <button class="btn-settings" @click="openSettings" title="设置">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.6"/>
          </svg>
        </button>
        <button class="btn-cancel" @click="cancelScreenshot">取消</button>
        <button
          class="btn-confirm"
          @click="confirmSelection"
          :disabled="!hasSelection"
        >
          确认 (Enter)
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snip-container {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

.snip-canvas {
  display: block;
  cursor: crosshair;
}

.annot-toolbar {
  position: fixed;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(28, 28, 35, 0.96);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 6px 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.annot-toolbar .group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.annot-toolbar .divider {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  color: #d0d0dc;
  cursor: pointer;
  border-radius: 6px;
  padding: 0;
  transition: all 0.15s;
}

.tool-btn svg {
  width: 17px;
  height: 17px;
}

.tool-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.tool-btn.active {
  background: #c86b7d;
  color: #fff;
}

.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.color-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s, border-color 0.15s;
}

.color-btn:hover {
  transform: scale(1.15);
}

.color-btn.active {
  border-color: #fff;
  box-shadow: 0 0 0 2px #1e90ff;
}

.width-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  padding: 0;
}

.width-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.width-btn.active {
  background: rgba(30, 144, 255, 0.25);
}

.width-btn .dot {
  display: inline-block;
  background: currentColor;
  border-radius: 50%;
  color: #d0d0dc;
}

.width-btn.active .dot {
  color: #fff;
}

.snip-toolbar {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(22, 22, 30, 0.96);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.toolbar-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #b8b8c8;
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-hint .sep {
  color: #444;
}

.toolbar-hint kbd {
  background: #2a2a3a;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  color: #d0d0dc;
}

.toolbar-prompt {
  width: 240px;
}

.prompt-input {
  width: 100%;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.prompt-input:focus {
  border-color: #1e90ff;
}

.prompt-input::placeholder {
  color: #666;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.new-chat-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #ccc;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.new-chat-checkbox input {
  cursor: pointer;
  accent-color: #c86b7d;
}

.new-chat-checkbox span {
  white-space: nowrap;
}

.btn-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  color: #8a8a98;
  cursor: pointer;
  border-radius: 7px;
  padding: 0;
}

.btn-settings svg {
  width: 16px;
  height: 16px;
}

.btn-settings:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.btn-cancel {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: #ccc;
  padding: 7px 16px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
}

.btn-cancel:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.btn-confirm {
  background: #c86b7d;
  border: none;
  color: #fff;
  padding: 7px 16px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.btn-confirm:hover:not(:disabled) {
  background: #b85a6b;
}

.btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Tesseract from 'tesseract.js'
import { useScreenshotStore } from '../store/screenshot'

type Mode = 'select' | 'annotate'
type Tool = 'pen' | 'rect' | 'arrow'

interface Point { x: number; y: number }
interface Annotation {
  tool: Tool
  color: string
  width: number
  points: Point[]
}

interface TranslationLine {
  original: string
  translation: string
}

const store = useScreenshotStore()

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

const isTranslating = ref(false)
const translateResult = ref<TranslationLine[]>([])
const translateError = ref('')
const showTranslatePanel = ref(false)
let translateAbortController: AbortController | null = null

const copiedFlash = ref(false)
let copiedFlashTimer: ReturnType<typeof setTimeout> | null = null

const annotToolbarRef = ref<HTMLElement | null>(null)
const annotToolbarSize = ref({ w: 520, h: 44 })
const translatePanelRef = ref<HTMLElement | null>(null)
const translatePanelSize = ref({ w: 360, h: 120 })
let annotResizeObserver: ResizeObserver | null = null
let translateResizeObserver: ResizeObserver | null = null
const BOTTOM_SAFE = 130

interface OcrWord {
  text: string
  left: number
  top: number
  width: number
  height: number
  lineId: number
  wordIndex: number
}
const ocrWords = ref<OcrWord[]>([])
const ocrLoading = ref(false)
const ocrProgress = ref(0)
const ocrSelectedIds = ref<Set<string>>(new Set())
const ocrToast = ref('')
let ocrToastTimer: ReturnType<typeof setTimeout> | null = null
let ocrAbortToken = 0
const ocrSelecting = ref(false)
const ocrSelectStart = ref<{ x: number; y: number } | null>(null)
const ocrSelectRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const ocrShown = ref(false)
const ocrCopiedFlash = ref(false)
let ocrCopiedFlashTimer: ReturnType<typeof setTimeout> | null = null

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const isResizing = ref(false)
const resizeHandle = ref<ResizeHandle | null>(null)
const resizeStart = ref<{ mx: number; my: number; sx: number; sy: number; sw: number; sh: number } | null>(null)

const HANDLE_DIRS: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const cursorForHandle = (h: ResizeHandle): string => {
  switch (h) {
    case 'nw': case 'se': return 'nwse-resize'
    case 'ne': case 'sw': return 'nesw-resize'
    case 'n': case 's': return 'ns-resize'
    case 'e': case 'w': return 'ew-resize'
  }
}

const handlePosition = (h: ResizeHandle): { x: number; y: number } => {
  const s = selection.value
  switch (h) {
    case 'nw': return { x: s.x, y: s.y }
    case 'ne': return { x: s.x + s.width, y: s.y }
    case 'sw': return { x: s.x, y: s.y + s.height }
    case 'se': return { x: s.x + s.width, y: s.y + s.height }
    case 'n': return { x: s.x + s.width / 2, y: s.y }
    case 's': return { x: s.x + s.width / 2, y: s.y + s.height }
    case 'w': return { x: s.x, y: s.y + s.height / 2 }
    case 'e': return { x: s.x + s.width, y: s.y + s.height / 2 }
  }
}

const startResize = (h: ResizeHandle, e: MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isResizing.value = true
  resizeHandle.value = h
  resizeStart.value = {
    mx: e.clientX,
    my: e.clientY,
    sx: selection.value.x,
    sy: selection.value.y,
    sw: selection.value.width,
    sh: selection.value.height
  }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeUp)
}

const onResizeMove = (e: MouseEvent) => {
  if (!isResizing.value || !resizeHandle.value || !resizeStart.value) return
  const rs = resizeStart.value
  const dx = e.clientX - rs.mx
  const dy = e.clientY - rs.my
  let nx = rs.sx, ny = rs.sy, nw = rs.sw, nh = rs.sh
  switch (resizeHandle.value) {
    case 'nw': nx = rs.sx + dx; ny = rs.sy + dy; nw = rs.sw - dx; nh = rs.sh - dy; break
    case 'ne': ny = rs.sy + dy; nw = rs.sw + dx; nh = rs.sh - dy; break
    case 'sw': nx = rs.sx + dx; nw = rs.sw - dx; nh = rs.sh + dy; break
    case 'se': nw = rs.sw + dx; nh = rs.sh + dy; break
    case 'n': ny = rs.sy + dy; nh = rs.sh - dy; break
    case 's': nh = rs.sh + dy; break
    case 'w': nx = rs.sx + dx; nw = rs.sw - dx; break
    case 'e': nw = rs.sw + dx; break
  }
  if (nw < 0) { nx += nw; nw = -nw }
  if (nh < 0) { ny += nh; nh = -nh }
  const canvas = canvasRef.value
  if (canvas) {
    if (nx < 0) { nw += nx; nx = 0 }
    if (ny < 0) { nh += ny; ny = 0 }
    if (nx + nw > canvas.width) nw = canvas.width - nx
    if (ny + nh > canvas.height) nh = canvas.height - ny
  }
  selection.value = {
    x: Math.round(nx),
    y: Math.round(ny),
    width: Math.max(1, Math.round(nw)),
    height: Math.max(1, Math.round(nh))
  }
  draw()
}

const onResizeUp = () => {
  if (!isResizing.value) return
  isResizing.value = false
  resizeHandle.value = null
  resizeStart.value = null
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
  if (ocrShown.value || ocrWords.value.length) {
    resetOcr()
  }
  draw()
}

const PRESET_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000']
const WIDTHS = [2, 4, 7]

const hasSelection = computed(() => selection.value.width > 5 && selection.value.height > 5)

const annotationToolbarStyle = computed(() => {
  const visible = hasSelection.value && mode.value === 'annotate'
  const s = selection.value
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tbW = annotToolbarSize.value.w
  const tbH = annotToolbarSize.value.h
  const gap = 8

  let top: number
  let left = s.x + (s.width - tbW) / 2

  if (visible) {
    if (s.y + s.height + gap + tbH <= vh - BOTTOM_SAFE) {
      top = s.y + s.height + gap
    } else if (s.y - tbH - gap >= 8) {
      top = s.y - tbH - gap
    } else {
      top = Math.max(8, Math.min(s.y + s.height - tbH - gap, vh - BOTTOM_SAFE - tbH))
    }
  } else {
    top = -9999
  }

  if (left < 8) left = 8
  if (left + tbW > vw - 8) left = vw - tbW - 8

  return {
    top: top + 'px',
    left: left + 'px',
    visibility: visible ? ('visible' as const) : ('hidden' as const),
    pointerEvents: visible ? ('auto' as const) : ('none' as const)
  }
})

const translatePanelStyle = computed(() => {
  const visible = showTranslatePanel.value && hasSelection.value
  const s = selection.value
  const vw = window.innerWidth
  const vh = window.innerHeight
  const panelW = Math.max(320, Math.min(Math.max(s.width, 360), 720))
  const panelH = translatePanelSize.value.h
  const annotH = mode.value === 'annotate' ? annotToolbarSize.value.h + 24 : 0
  const gap = 16

  let left = s.x + (s.width - panelW) / 2
  let top: number

  if (visible) {
    const idealTop = s.y + s.height + gap + annotH
    if (idealTop + Math.min(panelH, 200) <= vh - BOTTOM_SAFE) {
      top = idealTop
    } else if (s.y - gap - Math.min(panelH, 320) >= 8) {
      top = s.y - gap - Math.min(panelH, 320)
    } else {
      top = Math.max(8, vh - BOTTOM_SAFE - Math.min(panelH, 320))
    }
  } else {
    top = -9999
  }

  if (left < 8) left = 8
  if (left + panelW > vw - 8) left = vw - panelW - 8

  return {
    top: top + 'px',
    left: left + 'px',
    width: panelW + 'px',
    maxHeight: '320px',
    visibility: visible ? ('visible' as const) : ('hidden' as const),
    pointerEvents: visible ? ('auto' as const) : ('none' as const)
  }
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
    if (hasSelection.value && inSelection(p)) {
    } else {
      selection.value = { x: p.x, y: p.y, width: 0, height: 0 }
    }
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
  if (showTranslatePanel.value) closeTranslatePanel()
  resetOcr()
  annotations.value = []
  selection.value = { x: 0, y: 0, width: 0, height: 0 }
  mode.value = 'select'
  draw()
}

const showOcrToast = (text: string) => {
  ocrToast.value = text
  if (ocrToastTimer) clearTimeout(ocrToastTimer)
  ocrToastTimer = setTimeout(() => {
    ocrToast.value = ''
  }, 1500)
}

const resetOcr = () => {
  ocrAbortToken++
  ocrLoading.value = false
  ocrProgress.value = 0
  ocrWords.value = []
  ocrSelectedIds.value = new Set()
  ocrSelectRect.value = null
  ocrSelecting.value = false
  ocrShown.value = false
}

const runSelectionOcr = async () => {
  if (!hasSelection.value || !backgroundImage.value) return
  const s = { ...selection.value }
  ocrAbortToken++
  const token = ocrAbortToken
  ocrShown.value = true
  ocrLoading.value = true
  ocrProgress.value = 0
  ocrWords.value = []
  ocrSelectedIds.value = new Set()
  ocrSelectRect.value = null

  try {
    const out = document.createElement('canvas')
    out.width = s.width
    out.height = s.height
    const ctx = out.getContext('2d')
    if (!ctx) {
      ocrLoading.value = false
      return
    }
    ctx.drawImage(backgroundImage.value, s.x, s.y, s.width, s.height, 0, 0, s.width, s.height)
    const dataUrl = out.toDataURL('image/png')

    const result = await Tesseract.recognize(dataUrl, 'chi_sim+eng', {
      logger: (m: any) => {
        if (token !== ocrAbortToken) return
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          ocrProgress.value = Math.round(m.progress * 100)
        }
      }
    })
    if (token !== ocrAbortToken) return

    const data: any = result.data
    const words: OcrWord[] = []
    let lineId = 0
    let wordIndex = 0
    const collectFromLines = (lines: any[]) => {
      for (const line of lines) {
        const lineWords = line.words || []
        for (const w of lineWords) {
          if (!w.text || !w.text.trim()) continue
          const bbox = w.bbox || {}
          words.push({
            text: w.text,
            left: bbox.x0 ?? 0,
            top: bbox.y0 ?? 0,
            width: (bbox.x1 ?? 0) - (bbox.x0 ?? 0),
            height: (bbox.y1 ?? 0) - (bbox.y0 ?? 0),
            lineId,
            wordIndex: wordIndex++
          })
        }
        lineId++
      }
    }
    if (data.blocks && data.blocks.length) {
      for (const block of data.blocks) {
        for (const para of (block.paragraphs || [])) {
          collectFromLines(para.lines || [])
        }
      }
    } else if (data.lines) {
      collectFromLines(data.lines)
    }
    ocrWords.value = words
    if (!words.length) {
      showOcrToast('未识别到文字')
    }
  } catch (err) {
    if (token === ocrAbortToken) {
      console.error('OCR failed:', err)
      showOcrToast('识别失败')
    }
  } finally {
    if (token === ocrAbortToken) {
      ocrLoading.value = false
    }
  }
}

const ocrWordKey = (w: OcrWord) => `${w.lineId}-${w.wordIndex}`

const ocrSelectionLayerStyle = computed(() => {
  const s = selection.value
  return {
    left: `${s.x}px`,
    top: `${s.y}px`,
    width: `${s.width}px`,
    height: `${s.height}px`
  }
})

const handleOcrLayerMouseDown = (e: MouseEvent) => {
  if (e.button !== 0) return
  if (mode.value !== 'annotate') return
  e.preventDefault()
  e.stopPropagation()
  const layer = e.currentTarget as HTMLElement
  const rect = layer.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  ocrSelecting.value = true
  ocrSelectStart.value = { x, y }
  ocrSelectRect.value = { x, y, w: 0, h: 0 }
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
    ocrSelectedIds.value = new Set()
  }
  window.addEventListener('mousemove', handleOcrLayerMouseMove)
  window.addEventListener('mouseup', handleOcrLayerMouseUp)
}

const handleOcrLayerMouseMove = (e: MouseEvent) => {
  if (!ocrSelecting.value || !ocrSelectStart.value) return
  const s = selection.value
  const localX = Math.max(0, Math.min(s.width, e.clientX - s.x))
  const localY = Math.max(0, Math.min(s.height, e.clientY - s.y))
  const sx = ocrSelectStart.value.x
  const sy = ocrSelectStart.value.y
  ocrSelectRect.value = {
    x: Math.min(localX, sx),
    y: Math.min(localY, sy),
    w: Math.abs(localX - sx),
    h: Math.abs(localY - sy)
  }
  computeOcrSelection()
}

const handleOcrLayerMouseUp = () => {
  ocrSelecting.value = false
  ocrSelectRect.value = null
  window.removeEventListener('mousemove', handleOcrLayerMouseMove)
  window.removeEventListener('mouseup', handleOcrLayerMouseUp)
}

const computeOcrSelection = () => {
  const r = ocrSelectRect.value
  if (!r) return
  const next = new Set<string>()
  for (const w of ocrWords.value) {
    const cx = w.left + w.width / 2
    const cy = w.top + w.height / 2
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
      next.add(ocrWordKey(w))
    }
  }
  ocrSelectedIds.value = next
}

const toggleOcrWord = (w: OcrWord, e: MouseEvent) => {
  e.stopPropagation()
  e.preventDefault()
  const key = ocrWordKey(w)
  const next = new Set(ocrSelectedIds.value)
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    if (next.has(key)) next.delete(key)
    else next.add(key)
  } else {
    if (next.size === 1 && next.has(key)) {
      next.clear()
    } else {
      next.clear()
      next.add(key)
    }
  }
  ocrSelectedIds.value = next
}

const ocrAllSelected = computed(() =>
  ocrWords.value.length > 0 && ocrSelectedIds.value.size === ocrWords.value.length
)

const toggleOcrSelectAll = () => {
  if (ocrAllSelected.value) {
    ocrSelectedIds.value = new Set()
  } else {
    const next = new Set<string>()
    for (const w of ocrWords.value) next.add(ocrWordKey(w))
    ocrSelectedIds.value = next
  }
}

const ocrSelectAll = () => {
  const next = new Set<string>()
  for (const w of ocrWords.value) next.add(ocrWordKey(w))
  ocrSelectedIds.value = next
}

const buildOcrText = (filterIds?: Set<string>): string => {
  const list = filterIds && filterIds.size > 0
    ? ocrWords.value.filter((w: OcrWord) => filterIds.has(ocrWordKey(w)))
    : [...ocrWords.value]
  list.sort((a: OcrWord, b: OcrWord) => a.lineId - b.lineId || a.wordIndex - b.wordIndex)
  const lines: string[] = []
  let currentLine = -1
  let buffer: string[] = []
  for (const w of list) {
    if (w.lineId !== currentLine) {
      if (buffer.length) lines.push(buffer.join(' '))
      buffer = [w.text]
      currentLine = w.lineId
    } else {
      buffer.push(w.text)
    }
  }
  if (buffer.length) lines.push(buffer.join(' '))
  return lines.join('\n').replace(/\s+([，。！？、；：）】」』])/g, '$1').replace(/([（【「『])\s+/g, '$1')
}

const writeClipboard = async (text: string): Promise<boolean> => {
  try {
    const api = (window.electronAPI as any)
    if (api && typeof api.writeClipboardText === 'function') {
      const res = await api.writeClipboardText(text)
      if (res && res.success) return true
    }
  } catch (e) {
    console.error('writeClipboardText failed:', e)
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    console.error('navigator.clipboard.writeText failed:', e)
    return false
  }
}

const toggleOcr = () => {
  if (ocrShown.value || ocrLoading.value) {
    resetOcr()
  } else {
    runSelectionOcr()
  }
}

const flashOcrCopied = () => {
  ocrCopiedFlash.value = true
  if (ocrCopiedFlashTimer) clearTimeout(ocrCopiedFlashTimer)
  ocrCopiedFlashTimer = setTimeout(() => {
    ocrCopiedFlash.value = false
  }, 1100)
}

const copyOcrText = async () => {
  if (ocrWords.value.length === 0) {
    showOcrToast('暂无识别内容')
    return
  }
  const useSelection = ocrSelectedIds.value.size > 0
  const text = useSelection ? buildOcrText(ocrSelectedIds.value) : buildOcrText()
  if (!text) {
    showOcrToast('复制失败')
    return
  }
  const ok = await writeClipboard(text)
  if (!ok) {
    showOcrToast('复制失败')
    return
  }
  flashOcrCopied()
  setTimeout(() => {
    resetOcr()
    window.electronAPI.exitScreenshot()
  }, 280)
}

const reRunOcr = () => {
  runSelectionOcr()
}

const buildCroppedDataUrl = (): string | null => {
  if (!hasSelection.value || !backgroundImage.value) return null
  const s = selection.value
  const out = document.createElement('canvas')
  out.width = s.width
  out.height = s.height
  const ctx = out.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(backgroundImage.value, s.x, s.y, s.width, s.height, 0, 0, s.width, s.height)
  ctx.save()
  ctx.translate(-s.x, -s.y)
  for (const a of annotations.value) drawAnnotation(ctx, a)
  ctx.restore()

  return out.toDataURL('image/png')
}

const copyCroppedImage = async () => {
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

  out.toBlob(async (blob) => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      window.electronAPI.exitScreenshot()
    } catch (e) {
      console.error('copy image failed', e)
    }
  }, 'image/png')
}

const pinSelection = async () => {
  const dataUrl = buildCroppedDataUrl()
  if (!dataUrl) return
  try {
    const api = (window.electronAPI as any)
    if (!api || typeof api.pinScreenshot !== 'function') {
      console.error('pinScreenshot api unavailable')
      return
    }
    await api.pinScreenshot(dataUrl)
    resetOcr()
    window.electronAPI.exitScreenshot()
  } catch (e) {
    console.error('pin selection failed', e)
  }
}

const parseTranslateResponse = (raw: string): TranslationLine[] => {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  const slice = text.slice(start, end + 1)
  try {
    const arr = JSON.parse(slice)
    if (!Array.isArray(arr)) return []
    return arr
      .map((it: any) => ({
        original: typeof it?.original === 'string' ? it.original : '',
        translation: typeof it?.translation === 'string' ? it.translation : ''
      }))
      .filter(it => it.original || it.translation)
  } catch {
    return []
  }
}

const translateSelection = async () => {
  if (!hasSelection.value || isTranslating.value) return
  const dataUrl = buildCroppedDataUrl()
  if (!dataUrl) return

  isTranslating.value = true
  translateError.value = ''
  translateResult.value = []
  showTranslatePanel.value = true
  translateAbortController = new AbortController()

  const prompt = '识别图片中的所有文本，按从上到下、从左到右的阅读顺序，把每一行原文翻译成简体中文。' +
    '严格只返回 JSON 数组，不要任何解释、前后缀或代码块标记。格式：' +
    '[{"original":"原文","translation":"中文译文"}]。' +
    '若图片中没有文字，返回 []。'

  try {
    const response = await store.sendToAI(
      prompt,
      [],
      dataUrl,
      undefined,
      translateAbortController.signal
    )
    const lines = parseTranslateResponse(response)
    if (!lines.length) {
      translateError.value = '未识别到文字内容'
    } else {
      translateResult.value = lines
    }
  } catch (error) {
    if ((error as any)?.name === 'AbortError') {
      translateError.value = '已取消翻译'
    } else {
      translateError.value = '翻译失败：' + ((error as Error).message || '未知错误')
    }
  } finally {
    translateAbortController = null
    isTranslating.value = false
  }
}

const stopTranslate = () => {
  if (translateAbortController) translateAbortController.abort()
}

const closeTranslatePanel = () => {
  if (translateAbortController) translateAbortController.abort()
  showTranslatePanel.value = false
  translateResult.value = []
  translateError.value = ''
  isTranslating.value = false
}

const copyTranslations = async () => {
  if (!translateResult.value.length) return
  const text = translateResult.value.map((l: TranslationLine) => l.translation).join('\n')
  try {
    await navigator.clipboard.writeText(text)
  } catch {}
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
  resetOcr()
  window.electronAPI.exitScreenshot()
}

const openSettings = () => {
  window.electronAPI.openSettingsFromScreenshot()
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (showTranslatePanel.value) {
      closeTranslatePanel()
      return
    }
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

onMounted(async () => {
  newChat.value = false
  let imageData = ''
  try {
    imageData = await window.electronAPI.getPendingScreenshot()
  } catch (e) {
    imageData = ''
  }
  if (!imageData) {
    const params = new URLSearchParams(window.location.search)
    imageData = params.get('image') || ''
    if (imageData) imageData = decodeURIComponent(imageData)
  }
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
    img.src = imageData
  }
  window.addEventListener('keydown', onKeyDown)

  if (annotToolbarRef.value && 'ResizeObserver' in window) {
    annotResizeObserver = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) {
        annotToolbarSize.value = { w: r.width, h: r.height }
      }
    })
    annotResizeObserver.observe(annotToolbarRef.value)
  }
  if (translatePanelRef.value && 'ResizeObserver' in window) {
    translateResizeObserver = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) {
        translatePanelSize.value = { w: r.width, h: r.height }
      }
    })
    translateResizeObserver.observe(translatePanelRef.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
  annotResizeObserver?.disconnect()
  translateResizeObserver?.disconnect()
  if (ocrToastTimer) clearTimeout(ocrToastTimer)
  if (ocrCopiedFlashTimer) clearTimeout(ocrCopiedFlashTimer)
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

    <div
      v-if="hasSelection && ocrShown && ocrWords.length"
      class="ocr-layer"
      :style="ocrSelectionLayerStyle"
      @mousedown="handleOcrLayerMouseDown"
    >
      <div
        v-for="w in ocrWords"
        :key="ocrWordKey(w)"
        class="ocr-word"
        :class="{ selected: ocrSelectedIds.has(ocrWordKey(w)) }"
        :style="{ left: w.left + 'px', top: w.top + 'px', width: w.width + 'px', height: w.height + 'px' }"
        @mousedown.stop
        @click="toggleOcrWord(w, $event)"
        :title="w.text"
      ></div>
      <div
        v-if="ocrSelectRect"
        class="ocr-marquee"
        :style="{ left: ocrSelectRect.x + 'px', top: ocrSelectRect.y + 'px', width: ocrSelectRect.w + 'px', height: ocrSelectRect.h + 'px' }"
      ></div>
    </div>

    <div v-if="ocrToast" class="ocr-toast">{{ ocrToast }}</div>

    <template v-if="hasSelection && !isPointerDown && !ocrSelecting">
      <div
        v-for="h in HANDLE_DIRS"
        :key="h"
        class="resize-handle"
        :class="['handle-' + h]"
        :style="{
          left: (handlePosition(h).x - 7) + 'px',
          top: (handlePosition(h).y - 7) + 'px',
          cursor: cursorForHandle(h)
        }"
        @mousedown="startResize(h, $event)"
      ></div>
    </template>

    <div class="annot-toolbar" ref="annotToolbarRef" :style="annotationToolbarStyle">
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
        <button
          class="tool-btn copy-btn"
          :class="{ flashed: copiedFlash }"
          @click="copyCroppedImage"
          :title="copiedFlash ? '已复制' : '复制截图'"
        >
          <svg v-if="!copiedFlash" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/>
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button
          class="tool-btn pin-btn"
          @click="pinSelection"
          :disabled="!hasSelection"
          title="置顶（Esc 关闭，滚轮缩放，按住拖动）"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 3l7 7-3.2 1.4-3.6 3.6-1 5L8 14 3 19M14 10l-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="divider"></div>
      <div class="group">
        <button
          v-if="ocrShown && !ocrLoading && ocrWords.length"
          class="tool-btn ocr-sub-btn select-all-btn"
          :class="{ active: ocrSelectedIds.size > 0 }"
          @click="toggleOcrSelectAll"
          :title="ocrAllSelected ? '取消全选' : '全选文字'"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/>
            <path v-if="ocrSelectedIds.size > 0" d="M8 12l3 3 5-6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="ocr-label">{{ ocrSelectedIds.size > 0 ? `已选 ${ocrSelectedIds.size}` : '全选' }}</span>
        </button>
        <button
          class="tool-btn ocr-btn-toolbar"
          :class="{ active: ocrShown || ocrLoading, loading: ocrLoading }"
          @click="toggleOcr"
          :disabled="!hasSelection"
          :title="ocrShown ? '取消文字识别' : '提取文字 (OCR)'"
        >
          <svg v-if="ocrLoading" class="ocr-spinner-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="14 36"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            <path d="M7 10h2v4H7zM11 10h2v4h-2zM15 10h2v4h-2z" fill="currentColor"/>
          </svg>
          <span class="ocr-label">{{ ocrLoading ? `识别中 ${ocrProgress}%` : (ocrShown ? '取消识别' : '提取文字') }}</span>
        </button>
        <button
          v-if="ocrShown && !ocrLoading && ocrWords.length"
          class="tool-btn ocr-sub-btn copy-btn"
          :class="{ flashed: ocrCopiedFlash }"
          @click="copyOcrText"
          :title="ocrCopiedFlash ? '已复制' : (ocrSelectedIds.size ? '复制所选 (' + ocrSelectedIds.size + ')' : '复制全部文字')"
        >
          <svg v-if="!ocrCopiedFlash" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/>
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="ocr-label">{{ ocrCopiedFlash ? '已复制' : (ocrSelectedIds.size ? '复制所选' : '复制文字') }}</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="group">
        <button
          class="tool-btn translate-btn"
          @click="translateSelection"
          :disabled="isTranslating"
          title="翻译"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5h10M8 3v2M5.5 5c0 4 2.5 7 5 8.5M11 8c0 3-3.5 6-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 21l4-10 4 10M14.5 17h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="translate-label">{{ isTranslating ? '翻译中' : '翻译' }}</span>
        </button>
      </div>
    </div>

    <div class="translate-panel" ref="translatePanelRef" :style="translatePanelStyle" v-show="showTranslatePanel">
      <div class="translate-panel-header">
        <span class="translate-panel-title">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5h10M8 3v2M5.5 5c0 4 2.5 7 5 8.5M11 8c0 3-3.5 6-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 21l4-10 4 10M14.5 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          翻译结果
        </span>
        <div class="translate-panel-actions">
          <button
            v-if="!isTranslating && translateResult.length"
            class="translate-action-btn"
            @click="copyTranslations"
            title="复制全部译文"
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/>
              <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            v-if="isTranslating"
            class="translate-action-btn stop"
            @click="stopTranslate"
            title="停止"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <rect x="6" y="6" width="12" height="12" rx="1.5"/>
            </svg>
          </button>
          <button class="translate-action-btn" @click="closeTranslatePanel" title="关闭">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="translate-panel-body">
        <div v-if="isTranslating && !translateResult.length" class="translate-loading">
          <div class="dots"><span></span><span></span><span></span></div>
          <span>正在识别并翻译...</span>
        </div>
        <div v-else-if="translateError" class="translate-error">
          {{ translateError }}
        </div>
        <div v-else-if="translateResult.length" class="translate-lines">
          <div v-for="(line, i) in translateResult" :key="i" class="translate-line">
            <div class="line-original">{{ line.original }}</div>
            <div class="line-translation">{{ line.translation }}</div>
          </div>
        </div>
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
  caret-color: #b85a6b;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.prompt-input:focus {
  border-color: #b85a6b;
  background: rgba(184, 90, 107, 0.12);
  box-shadow: 0 0 0 2px rgba(184, 90, 107, 0.18);
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

.translate-btn {
  width: auto !important;
  padding: 0 10px;
  gap: 6px;
  background: rgba(184, 90, 107, 0.18);
  color: #ffb6c4;
}

.translate-btn:hover:not(:disabled) {
  background: rgba(184, 90, 107, 0.35) !important;
  color: #fff !important;
}

.translate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.translate-label {
  font-size: 12px;
  font-weight: 500;
}

.copy-btn.flashed {
  background: rgba(52, 199, 89, 0.25) !important;
  color: #6dd58f !important;
}

.pin-btn:hover:not(:disabled) {
  background: rgba(184, 90, 107, 0.25) !important;
  color: #ffb6c4 !important;
}

.translate-panel {
  position: fixed;
  z-index: 12;
  display: flex;
  flex-direction: column;
  background: rgba(22, 22, 30, 0.97);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(184, 90, 107, 0.25);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.translate-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(184, 90, 107, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.translate-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #ffb6c4;
  font-size: 12px;
  font-weight: 500;
}

.translate-panel-title svg {
  width: 14px;
  height: 14px;
}

.translate-panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.translate-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: #b0b0c0;
  cursor: pointer;
  border-radius: 5px;
  padding: 0;
  transition: all 0.15s;
}

.translate-action-btn svg {
  width: 13px;
  height: 13px;
}

.translate-action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.translate-action-btn.stop {
  color: #ff8497;
}

.translate-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  min-height: 60px;
}

.translate-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #b0b0c0;
  font-size: 13px;
  padding: 8px 0;
}

.translate-loading .dots {
  display: flex;
  gap: 4px;
}

.translate-loading .dots span {
  width: 6px;
  height: 6px;
  background: #b85a6b;
  border-radius: 50%;
  animation: tdot 1.2s infinite ease-in-out;
}

.translate-loading .dots span:nth-child(2) { animation-delay: 0.15s; }
.translate-loading .dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes tdot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

.translate-error {
  color: #ff8497;
  font-size: 13px;
  padding: 4px 0;
}

.translate-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.translate-line {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  border-left: 2px solid rgba(184, 90, 107, 0.45);
  background: rgba(255, 255, 255, 0.02);
  transition: background 0.15s;
}

.translate-line:hover {
  background: rgba(255, 255, 255, 0.05);
}

.line-original {
  color: #8a8a98;
  font-size: 12.5px;
  line-height: 1.5;
  word-break: break-word;
}

.line-translation {
  color: #fff;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
  font-weight: 500;
}

.translate-panel-body::-webkit-scrollbar {
  width: 6px;
}

.translate-panel-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}

.ocr-layer {
  position: fixed;
  z-index: 9;
  cursor: text;
  user-select: none;
}

.ocr-word {
  position: absolute;
  border: 1px solid rgba(56, 189, 248, 0.55);
  background: rgba(56, 189, 248, 0.12);
  cursor: pointer;
  box-sizing: border-box;
  transition: background 0.1s, border-color 0.1s;
}

.ocr-word:hover {
  background: rgba(56, 189, 248, 0.25);
  border-color: rgba(56, 189, 248, 0.95);
}

.ocr-word.selected {
  background: rgba(184, 90, 107, 0.42);
  border-color: rgba(184, 90, 107, 1);
  box-shadow: 0 0 0 1px rgba(184, 90, 107, 0.7) inset;
}

.ocr-marquee {
  position: absolute;
  border: 1px dashed rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.08);
  pointer-events: none;
  box-sizing: border-box;
}

.ocr-btn-toolbar {
  width: auto !important;
  padding: 0 10px;
  gap: 6px;
  background: rgba(184, 90, 107, 0.18);
  color: #ffb6c4;
}

.ocr-btn-toolbar:hover:not(:disabled) {
  background: rgba(184, 90, 107, 0.35) !important;
  color: #fff !important;
}

.ocr-btn-toolbar.active {
  background: rgba(184, 90, 107, 0.5) !important;
  color: #fff !important;
}

.ocr-btn-toolbar.loading {
  cursor: wait;
}

.ocr-btn-toolbar:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ocr-spinner-icon {
  animation: ocrSpin 0.9s linear infinite;
}

@keyframes ocrSpin {
  to { transform: rotate(360deg); }
}

.ocr-sub-btn {
  width: auto !important;
  padding: 0 10px;
  gap: 6px;
}

.ocr-sub-btn.select-all-btn {
  background: rgba(255, 255, 255, 0.04);
  color: #d0d0dc;
  border: 1px solid transparent;
}

.ocr-sub-btn.select-all-btn:hover {
  background: rgba(184, 90, 107, 0.18);
  color: #ffb6c4;
}

.ocr-sub-btn.select-all-btn.active {
  background: rgba(184, 90, 107, 0.35);
  color: #fff;
  border-color: rgba(184, 90, 107, 0.6);
}

.ocr-sub-btn.select-all-btn.active:hover {
  background: rgba(184, 90, 107, 0.5);
}

.ocr-sub-btn.copy-btn {
  background: rgba(184, 90, 107, 0.18);
  color: #ffb6c4;
}

.ocr-sub-btn.copy-btn:hover:not(:disabled) {
  background: rgba(184, 90, 107, 0.35) !important;
  color: #fff !important;
}

.ocr-sub-btn.copy-btn.flashed {
  background: rgba(52, 199, 89, 0.25) !important;
  color: #6dd58f !important;
}

.ocr-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.ocr-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 8px 16px;
  background: rgba(20, 24, 40, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: #fff;
  font-size: 12px;
  backdrop-filter: blur(8px);
  animation: ocrToastIn 0.18s ease-out;
}

.resize-handle {
  position: fixed;
  width: 14px;
  height: 14px;
  z-index: 9;
  background: transparent;
}

@keyframes ocrToastIn {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
</style>

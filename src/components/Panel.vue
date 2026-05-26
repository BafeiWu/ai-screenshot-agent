<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { marked } from 'marked'
import Tesseract from 'tesseract.js'
import { useScreenshotStore, type Favorite, type FavoriteMessage, type AgentToolEvent } from '../store/screenshot'

marked.setOptions({
  breaks: true,
  gfm: true
})

const store = useScreenshotStore()
const messages = ref<FavoriteMessage[]>([])
const inputText = ref('')
const uploadedImage = ref<string | null>(null)
const uploadedImageName = ref('')
const isLoading = ref(false)
const isStreaming = ref(false)
const isHoveringMessages = ref(false)
const agentMode = ref(false)
const agentAuthorized = ref(false)
const showAgentAuthModal = ref(false)
const agentAllowedDirs = ref<string[]>([])
let pendingAgentInput: string | null = null
let abortController: AbortController | null = null
const copiedIndex = ref<number | null>(null)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const windowStartX = ref(0)
const windowStartY = ref(0)
const showImageViewer = ref(false)
const viewerImage = ref('')
const viewerZoom = ref(1)
const viewerOffsetX = ref(0)
const viewerOffsetY = ref(0)
const viewerDragging = ref(false)
let viewerDragStartX = 0
let viewerDragStartY = 0
let viewerOffsetStartX = 0
let viewerOffsetStartY = 0

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
const ocrImageSize = ref<{ w: number; h: number }>({ w: 0, h: 0 })
const ocrLoading = ref(false)
const ocrProgress = ref(0)
const ocrEnabled = ref(false)
const ocrSelectedIds = ref<Set<string>>(new Set())
const ocrToast = ref('')
let ocrToastTimer: ReturnType<typeof setTimeout> | null = null
const viewerImageEl = ref<HTMLImageElement | null>(null)
const ocrRenderedSize = ref<{ w: number; h: number; offsetX: number; offsetY: number }>({ w: 0, h: 0, offsetX: 0, offsetY: 0 })
const ocrSelecting = ref(false)
const ocrSelectStart = ref<{ x: number; y: number } | null>(null)
const ocrSelectRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const showHistory = ref(false)
const isFullscreen = ref(false)
const screenshotHotkey = ref('Alt+S')

interface HistoryItem {
  id: string
  timestamp: number
  imageData: string
  question: string
  answer: string
  messages?: FavoriteMessage[]
}

const history = ref<HistoryItem[]>([])
const currentHistoryId = ref<string | null>(null)

const showFavorites = ref(false)
const showFavoriteDialog = ref(false)
const favoriteTitle = ref('')
const currentFavoriteId = ref<string | null>(null)

const favorites = computed(() => store.favorites)

const isCurrentFavorited = computed(() => {
  return currentFavoriteId.value !== null
})
const favoriteSearch = ref('')
const currentFavorite = ref<{ imageData: string; question: string; answer: string } | null>(null)
const editingFavoriteId = ref<string | null>(null)
const editingTitle = ref('')
let clickTimer: ReturnType<typeof setTimeout> | null = null

const handleTitleClick = (item: { id: string; imageData: string; question: string; answer: string }, event: MouseEvent) => {
  event.stopPropagation()
  if (editingFavoriteId.value === item.id) return
  
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  clickTimer = setTimeout(() => {
    viewFavorite(item)
    clickTimer = null
  }, 300)
}

const startEditTitle = (item: { id: string; title: string }, event: MouseEvent) => {
  event.stopPropagation()
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  editingFavoriteId.value = item.id
  editingTitle.value = item.title
}

const saveEditTitle = () => {
  if (editingFavoriteId.value && editingTitle.value.trim()) {
    const updated = favorites.value.map((f: Favorite) =>
      f.id === editingFavoriteId.value ? { ...f, title: editingTitle.value.trim() } : f
    )
    store.setFavorites(updated)
    saveFavorites()
  }
  editingFavoriteId.value = null
  editingTitle.value = ''
}

const cancelEditTitle = () => {
  editingFavoriteId.value = null
  editingTitle.value = ''
}

const handleGlobalClick = (event: MouseEvent) => {
  if (editingFavoriteId.value) {
    const target = event.target as HTMLElement
    if (!target.closest('.edit-title-input') && !target.closest('.history-question')) {
      cancelEditTitle()
    }
  }
}

const filteredFavorites = computed(() => {
  if (!favoriteSearch.value.trim()) return favorites.value
  const keyword = favoriteSearch.value.toLowerCase()
  return favorites.value.filter((f: Favorite) => f.title.toLowerCase().includes(keyword))
})

const loadFavorites = async () => {
  try {
    console.log('Loading favorites...')
    const data = await window.electronAPI.getFavorites()
    console.log('Favorites loaded:', data)
    store.setFavorites(data || [])
  } catch (e) {
    console.error('Failed to load favorites:', e)
  }
}

const saveFavorites = async () => {
  try {
    const raw = JSON.parse(JSON.stringify(store.favorites))
    console.log('[Renderer] saveFavorites called, data:', raw)
    await window.electronAPI.saveFavorites(raw)
    console.log('[Renderer] saveFavorites completed')
  } catch (e) {
    console.error('[Renderer] saveFavorites error:', e)
  }
}

const toggleFavorite = () => {
  console.log('[toggleFavorite] called, isCurrentFavorited:', isCurrentFavorited.value, 'currentFavoriteId:', currentFavoriteId.value)
  
  if (isCurrentFavorited.value) {
    console.log('[toggleFavorite] removing favorite')
    if (currentFavoriteId.value) {
      const newFavorites = favorites.value.filter((f: Favorite) => f.id !== currentFavoriteId.value)
      store.setFavorites(newFavorites)
      saveFavorites()
      currentFavoriteId.value = null
      console.log('[toggleFavorite] favorite removed')
    }
    return
  }
  
  console.log('[toggleFavorite] showing favorite dialog')
  favoriteTitle.value = ''
  showFavoriteDialog.value = true
}

const confirmFavorite = async () => {
  if (!favoriteTitle.value.trim()) return
  console.log('Confirming favorite...')
  const lastUserMsg = messages.value.find((m: FavoriteMessage) => m.role === 'user')
  const lastAssistantMsg = messages.value.find((m: FavoriteMessage) => m.role === 'assistant')
  const lastImage = lastUserMsg?.image || store.currentImage
  
  if (currentFavoriteId.value) {
    const existingIndex = favorites.value.findIndex((f: Favorite) => f.id === currentFavoriteId.value)
    if (existingIndex !== -1) {
      const updatedFavorite = {
        ...favorites.value[existingIndex],
        timestamp: Date.now(),
        question: lastUserMsg?.content || '',
        answer: lastAssistantMsg?.content || '',
        messages: JSON.parse(JSON.stringify(messages.value))
      }
      const newFavorites = [...favorites.value]
      newFavorites[existingIndex] = updatedFavorite
      store.setFavorites(newFavorites)
      await saveFavorites()
      showFavoriteDialog.value = false
      favoriteTitle.value = ''
      return
    }
  }
  
  const newFavorite = {
    id: Date.now().toString(),
    title: favoriteTitle.value.trim(),
    timestamp: Date.now(),
    imageData: lastImage || '',
    question: lastUserMsg?.content || '',
    answer: lastAssistantMsg?.content || '',
    messages: JSON.parse(JSON.stringify(messages.value))
  }
  const newFavorites = [newFavorite, ...favorites.value]
  store.setFavorites(newFavorites)
  console.log('Saving favorites with new item:', newFavorites)
  await saveFavorites()
  console.log('Favorite saved!')
  currentFavoriteId.value = newFavorite.id
  showFavoriteDialog.value = false
  favoriteTitle.value = ''
}

const viewFavorite = (fav: { id: string; imageData: string; question: string; answer: string; messages?: Array<{ role: string; content: string; image?: string }> }) => {
  console.log('[viewFavorite] called, fav.id:', fav.id)
  console.log('[viewFavorite] fav.messages:', fav.messages)
  store.setCurrentImage(fav.imageData)
  if (fav.messages && fav.messages.length > 0) {
    messages.value = JSON.parse(JSON.stringify(fav.messages))
    console.log('[viewFavorite] loaded from messages, count:', fav.messages.length)
  } else if (fav.question || fav.answer) {
    messages.value = [
      { role: 'user', content: fav.question, image: fav.imageData },
      { role: 'assistant', content: fav.answer }
    ]
    console.log('[viewFavorite] loaded from question/answer')
  } else {
    messages.value = []
    console.log('[viewFavorite] loaded empty (no messages, no question/answer)')
  }
  currentFavoriteId.value = fav.id
  console.log('[viewFavorite] currentFavoriteId set to:', currentFavoriteId.value)
  showFavorites.value = false
}

const deleteFavorite = (id: string) => {
  store.setFavorites(favorites.value.filter((f: Favorite) => f.id !== id))
  saveFavorites()
}

const backToChat = () => {
  currentFavorite.value = null
}

const formatHotkey = (hk: string): string => {
  if (!hk) return ''
  return hk
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/CmdOrCtrl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Command/gi, 'Cmd')
    .split('+')
    .map(part => part.length === 1 ? part.toUpperCase() : part)
    .join('+')
}

const loadHotkeyFromSettings = async () => {
  try {
    const s = await window.electronAPI.getSettings()
    if (s?.screenshotHotkey) screenshotHotkey.value = s.screenshotHotkey
  } catch {}
}

interface ScreenshotRecord {
  id: string
  timestamp: number
  imageData: string
  question: string
  answer: string
  messages?: Array<{ role: string; content: string; image?: string }>
}

const handleDragStart = async (e: MouseEvent) => {
  e.preventDefault()
  isDragging.value = true
  dragStartX.value = e.screenX
  dragStartY.value = e.screenY

  const [startX, startY] = await window.electronAPI.getPanelPosition()
  windowStartX.value = startX
  windowStartY.value = startY

  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', handleDragEnd)
}

const handleDrag = (e: MouseEvent) => {
  if (!isDragging.value) return

  const deltaX = e.screenX - dragStartX.value
  const deltaY = e.screenY - dragStartY.value

  const newX = windowStartX.value + deltaX
  const newY = windowStartY.value + deltaY

  window.electronAPI.movePanel(newX, newY)
}

const handleDragEnd = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', handleDragEnd)
}

const isResizing = ref(false)
const resizeCorner = ref('')
const panelContent = ref<HTMLElement | null>(null)

const scrollToBottom = () => {
  if (isHoveringMessages.value) return
  requestAnimationFrame(() => {
    if (panelContent.value) {
      panelContent.value.scrollTop = panelContent.value.scrollHeight
    }
  })
}

const readImageFileAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

const loadUploadedFile = async (file: File) => {
  if (!file) return

  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件')
    return
  }

  if (file.size > 8 * 1024 * 1024) {
    alert('图片不能超过 8MB')
    return
  }

  try {
    uploadedImage.value = await readImageFileAsDataUrl(file)
    uploadedImageName.value = file.name
  } catch {
    alert('图片读取失败')
  }
}

const handleUploadClick = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) loadUploadedFile(file)
  }
  input.click()
}

const clearUploadedImage = () => {
  uploadedImage.value = null
  uploadedImageName.value = ''
}

const resizeStartX = ref(0)
const resizeStartY = ref(0)
const resizeStartWidth = ref(0)
const resizeStartHeight = ref(0)

const MIN_WIDTH = 300
const MIN_HEIGHT = 400

const startResize = async (corner: string, e: MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isResizing.value = true
  resizeCorner.value = corner
  resizeStartX.value = e.screenX
  resizeStartY.value = e.screenY
  resizeStartWidth.value = 400
  resizeStartHeight.value = 600

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', handleResizeEnd)
}

const handleResize = async (e: MouseEvent) => {
  if (!isResizing.value) return

  const deltaX = e.screenX - resizeStartX.value
  const deltaY = e.screenY - resizeStartY.value

  let newWidth = resizeStartWidth.value
  let newHeight = resizeStartHeight.value

  const isCorner = (resizeCorner.value.includes('left') || resizeCorner.value.includes('right')) &&
                    (resizeCorner.value.includes('top') || resizeCorner.value.includes('bottom'))

  if (isCorner) {
    const aspectRatio = resizeStartWidth.value / resizeStartHeight.value
    const moveX = resizeCorner.value.includes('left') ? -deltaX : deltaX
    const moveY = resizeCorner.value.includes('top') ? -deltaY : deltaY
    const move = Math.max(Math.abs(moveX), Math.abs(moveY))

    if (resizeCorner.value.includes('right')) {
      newWidth = Math.max(MIN_WIDTH, resizeStartWidth.value + move)
    } else {
      newWidth = Math.max(MIN_WIDTH, resizeStartWidth.value - move)
    }
    newHeight = Math.max(MIN_HEIGHT, newWidth / aspectRatio)
  } else {
    if (resizeCorner.value.includes('right')) {
      newWidth = Math.max(MIN_WIDTH, resizeStartWidth.value + deltaX)
    }
    if (resizeCorner.value.includes('left')) {
      newWidth = Math.max(MIN_WIDTH, resizeStartWidth.value - deltaX)
    }
    if (resizeCorner.value.includes('bottom')) {
      newHeight = Math.max(MIN_HEIGHT, resizeStartHeight.value + deltaY)
    }
    if (resizeCorner.value.includes('top')) {
      newHeight = Math.max(MIN_HEIGHT, resizeStartHeight.value - deltaY)
    }
  }

  window.electronAPI.resizePanel(Math.round(newWidth), Math.round(newHeight))
}

const handleResizeEnd = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', handleResizeEnd)
}

const rerunQuestion = async (content: string, image?: string) => {
  if (!content || isLoading.value) return
  
  const lastUserMsgIndex = messages.value.findIndex((m: FavoriteMessage, idx: number) => m.role === 'user' && idx === messages.value.length - 2)
  if (lastUserMsgIndex !== -1) {
    messages.value.splice(lastUserMsgIndex, 2)
  } else {
    messages.value = []
  }
  
  const userMessage = { role: 'user', content, image: image || store.currentImage || undefined }
  messages.value.push(userMessage)
  messages.value.push({ role: 'assistant', content: '' })
  scrollToBottom()

  const currentInput = content
  isLoading.value = true
  isStreaming.value = false
  const msgIndex = messages.value.length - 1
  abortController = new AbortController()
  const signal = abortController.signal

  try {
    const response = await store.sendToAI(currentInput, messages.value, userMessage.image || undefined, (token: string) => {
      isStreaming.value = true
      messages.value[msgIndex].content += token
      scrollToBottom()
    }, signal)
    if (response && !messages.value[msgIndex].content) {
      isStreaming.value = true
      const chars = response.split('')
      for (let i = 0; i < chars.length; i++) {
        if (signal.aborted) break
        messages.value[msgIndex].content += chars[i]
        scrollToBottom()
        await new Promise(r => setTimeout(r, 10))
      }
    }
    saveToHistory()
  } catch (error) {
    if ((error as any)?.name === 'AbortError' || signal.aborted) {
      if (!messages.value[msgIndex].content) {
        messages.value[msgIndex].content = '已停止生成'
      } else {
        messages.value[msgIndex].content += '\n\n[已停止生成]'
      }
      saveToHistory()
    } else {
      messages.value[msgIndex].content = '抱歉，AI 服务暂时不可用。'
    }
    scrollToBottom()
  }

  abortController = null
  isLoading.value = false
  isStreaming.value = false
}

const sendMessage = async () => {
  if ((!inputText.value.trim() && !uploadedImage.value) || isLoading.value) return

  if (agentMode.value && uploadedImage.value) {
    alert('Agent 模式暂不支持图片上传，请切回普通模式后发送图片')
    return
  }

  if (agentMode.value && !agentAuthorized.value) {
    pendingAgentInput = inputText.value
    try {
      agentAllowedDirs.value = await window.electronAPI.agentGetAllowedDirs()
    } catch {
      agentAllowedDirs.value = []
    }
    showAgentAuthModal.value = true
    return
  }

  if (agentMode.value) {
    await runAgentMessage(inputText.value)
    return
  }

  const userMessage = { role: 'user', content: inputText.value, image: uploadedImage.value || undefined }
  messages.value.push(userMessage)
  messages.value.push({ role: 'assistant', content: '' })
  scrollToBottom()

  const currentInput = inputText.value
  inputText.value = ''
  const currentImage = uploadedImage.value || undefined
  clearUploadedImage()
  isLoading.value = true
  isStreaming.value = false
  const msgIndex = messages.value.length - 1
  abortController = new AbortController()
  const signal = abortController.signal

  try {
    const response = await store.sendToAI(currentInput, messages.value, currentImage, (token: string) => {
      isStreaming.value = true
      messages.value[msgIndex].content += token
      scrollToBottom()
    }, signal)
    if (response && !messages.value[msgIndex].content) {
      isStreaming.value = true
      const chars = response.split('')
      for (let i = 0; i < chars.length; i++) {
        if (signal.aborted) break
        messages.value[msgIndex].content += chars[i]
        scrollToBottom()
        await new Promise(r => setTimeout(r, 10))
      }
    }
    saveToHistory()
  } catch (error) {
    if ((error as any)?.name === 'AbortError' || signal.aborted) {
      if (!messages.value[msgIndex].content) {
        messages.value[msgIndex].content = '已停止生成'
      } else {
        messages.value[msgIndex].content += '\n\n[已停止生成]'
      }
      saveToHistory()
    } else {
      messages.value[msgIndex].content = '抱歉，AI 服务暂时不可用。'
    }
    scrollToBottom()
  }

  abortController = null
  isLoading.value = false
  isStreaming.value = false
}

const confirmAgentAuth = async () => {
  showAgentAuthModal.value = false
  agentAuthorized.value = true
  if (pendingAgentInput) {
    const text = pendingAgentInput
    pendingAgentInput = null
    await runAgentMessage(text)
  }
}

const cancelAgentAuth = () => {
  showAgentAuthModal.value = false
  pendingAgentInput = null
}

const toggleAgentMode = () => {
  agentMode.value = !agentMode.value
  if (!agentMode.value) {
    agentAuthorized.value = false
  }
}

const runAgentMessage = async (input: string) => {
  const userMessage: FavoriteMessage = { role: 'user', content: input }
  messages.value.push(userMessage)
  const assistantMsg: FavoriteMessage = { role: 'assistant', content: '', toolEvents: [] }
  messages.value.push(assistantMsg)
  scrollToBottom()

  inputText.value = ''
  isLoading.value = true
  isStreaming.value = false
  const msgIndex = messages.value.length - 1
  abortController = new AbortController()
  const signal = abortController.signal

  try {
    await store.runAgentTask(input, [], undefined, (e: { type: string; text?: string; toolName?: string; toolInput?: any; toolResult?: any; message?: string }) => {
      const m = messages.value[msgIndex]
      if (e.type === 'text' && e.text) {
        isStreaming.value = true
        m.content += e.text
      } else if (e.type === 'tool_call') {
        if (!m.toolEvents) m.toolEvents = []
        m.toolEvents.push({
          toolName: e.toolName || '',
          input: e.toolInput,
          status: 'running'
        } as AgentToolEvent)
      } else if (e.type === 'tool_result') {
        if (!m.toolEvents) m.toolEvents = []
        const last = [...m.toolEvents].reverse().find(t => t.toolName === e.toolName && t.status === 'running')
        if (last) {
          last.result = e.toolResult
          last.status = e.toolResult?.error ? 'error' : 'done'
        }
      } else if (e.type === 'error') {
        if (!m.content) m.content = `[Agent 错误] ${e.message || ''}`
        else m.content += `\n\n[Agent 错误] ${e.message || ''}`
      }
      scrollToBottom()
    }, signal)
    saveToHistory()
  } catch (error) {
    const m = messages.value[msgIndex]
    if ((error as any)?.name === 'AbortError' || signal.aborted) {
      m.content = m.content ? m.content + '\n\n[已停止生成]' : '已停止生成'
      saveToHistory()
    } else {
      m.content = '抱歉，Agent 任务失败: ' + ((error as any)?.message || '')
    }
    scrollToBottom()
  }

  abortController = null
  isLoading.value = false
  isStreaming.value = false
}

const stopMessage = () => {
  if (abortController) {
    abortController.abort()
  }
}

const saveToHistory = async () => {
  const hist = await window.electronAPI.getHistory() as ScreenshotRecord[]
  if (messages.value.length >= 2) {
    const lastUserMsg = messages.value[messages.value.length - 2]
    const lastAImsg = messages.value[messages.value.length - 1]
    if (lastUserMsg.role === 'user' && lastAImsg.role === 'assistant') {
      if (currentHistoryId.value) {
        const existingIndex = hist.findIndex(h => h.id === currentHistoryId.value)
        if (existingIndex !== -1) {
          hist[existingIndex] = {
            ...hist[existingIndex],
            timestamp: Date.now(),
            question: lastUserMsg.content,
            answer: lastAImsg.content,
            imageData: lastUserMsg.image || hist[existingIndex].imageData,
            messages: JSON.parse(JSON.stringify(messages.value))
          }
        }
      } else {
        const record: ScreenshotRecord = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          imageData: lastUserMsg.image || '',
          question: lastUserMsg.content,
          answer: lastAImsg.content,
          messages: JSON.parse(JSON.stringify(messages.value))
        }
        hist.push(record)
        currentHistoryId.value = record.id
      }
      await window.electronAPI.saveHistory(hist)
    }
  }
}

const handleMinimize = () => {
  window.electronAPI.minimizePanel()
}

const handleClose = () => {
  messages.value = []
  window.electronAPI.hidePanel()
}

const openSettings = () => {
  window.electronAPI.openSettings()
}

const clearChat = async () => {
  console.log('[clearChat] called, isCurrentFavorited:', isCurrentFavorited.value, 'currentFavoriteId:', currentFavoriteId.value)
  messages.value = []
  store.setCurrentImage('')
  if (isCurrentFavorited.value && currentFavoriteId.value) {
    console.log('[clearChat] deleting favorite:', currentFavoriteId.value)
    const newFavorites = favorites.value.filter((f: Favorite) => f.id !== currentFavoriteId.value)
    store.setFavorites(newFavorites)
    await saveFavorites()
    currentFavoriteId.value = null
    console.log('[clearChat] favorite deleted')
  }
}

const toggleFullscreen = () => {
  window.electronAPI.toggleFullscreen()
  isFullscreen.value = !isFullscreen.value
}

const openImageViewer = (src: string) => {
  viewerImage.value = src
  viewerZoom.value = 1
  viewerOffsetX.value = 0
  viewerOffsetY.value = 0
  ocrEnabled.value = false
  ocrWords.value = []
  ocrSelectedIds.value = new Set()
  ocrSelectRect.value = null
  showImageViewer.value = true
}

const closeImageViewer = () => {
  showImageViewer.value = false
  viewerImage.value = ''
  viewerZoom.value = 1
  viewerOffsetX.value = 0
  viewerOffsetY.value = 0
  ocrEnabled.value = false
  ocrWords.value = []
  ocrSelectedIds.value = new Set()
  ocrSelectRect.value = null
}

const showOcrToast = (text: string) => {
  ocrToast.value = text
  if (ocrToastTimer) clearTimeout(ocrToastTimer)
  ocrToastTimer = setTimeout(() => {
    ocrToast.value = ''
  }, 1600)
}

const updateOcrRenderedSize = () => {
  const img = viewerImageEl.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const overlay = img.parentElement?.getBoundingClientRect()
  ocrRenderedSize.value = {
    w: rect.width,
    h: rect.height,
    offsetX: overlay ? rect.left - overlay.left : 0,
    offsetY: overlay ? rect.top - overlay.top : 0
  }
}

const runOcr = async () => {
  if (!viewerImage.value || ocrLoading.value) return
  if (ocrEnabled.value) {
    ocrEnabled.value = false
    ocrSelectedIds.value = new Set()
    ocrSelectRect.value = null
    return
  }
  viewerZoom.value = 1
  viewerOffsetX.value = 0
  viewerOffsetY.value = 0
  ocrLoading.value = true
  ocrProgress.value = 0
  try {
    const result = await Tesseract.recognize(viewerImage.value, 'chi_sim+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          ocrProgress.value = Math.round(m.progress * 100)
        }
      }
    })
    const data: any = result.data
    ocrImageSize.value = {
      w: data.imageWidth || (data as any).width || 0,
      h: data.imageHeight || (data as any).height || 0
    }
    if (!ocrImageSize.value.w || !ocrImageSize.value.h) {
      const probe = new Image()
      await new Promise<void>((resolve) => {
        probe.onload = () => resolve()
        probe.onerror = () => resolve()
        probe.src = viewerImage.value
      })
      ocrImageSize.value = { w: probe.naturalWidth, h: probe.naturalHeight }
    }
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
    } else if (data.words) {
      for (const w of data.words) {
        if (!w.text || !w.text.trim()) continue
        const bbox = w.bbox || {}
        words.push({
          text: w.text,
          left: bbox.x0 ?? 0,
          top: bbox.y0 ?? 0,
          width: (bbox.x1 ?? 0) - (bbox.x0 ?? 0),
          height: (bbox.y1 ?? 0) - (bbox.y0 ?? 0),
          lineId: 0,
          wordIndex: wordIndex++
        })
      }
    }
    ocrWords.value = words
    ocrEnabled.value = true
    ocrSelectedIds.value = new Set()
    await nextTick()
    updateOcrRenderedSize()
    if (words.length === 0) {
      showOcrToast('未识别到文字')
    } else {
      showOcrToast(`识别到 ${words.length} 个文字块`)
    }
  } catch (err) {
    console.error('OCR failed:', err)
    showOcrToast('识别失败')
  } finally {
    ocrLoading.value = false
  }
}

const ocrWordKey = (w: OcrWord) => `${w.lineId}-${w.wordIndex}`

const ocrWordStyle = (w: OcrWord) => {
  const sw = ocrImageSize.value.w
  const sh = ocrImageSize.value.h
  if (!sw || !sh) return { display: 'none' }
  const scaleX = ocrRenderedSize.value.w / sw
  const scaleY = ocrRenderedSize.value.h / sh
  return {
    left: `${ocrRenderedSize.value.offsetX + w.left * scaleX}px`,
    top: `${ocrRenderedSize.value.offsetY + w.top * scaleY}px`,
    width: `${w.width * scaleX}px`,
    height: `${w.height * scaleY}px`
  }
}

const handleOcrSelectStart = (e: MouseEvent) => {
  if (!ocrEnabled.value) return
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const overlay = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - overlay.left
  const y = e.clientY - overlay.top
  ocrSelecting.value = true
  ocrSelectStart.value = { x, y }
  ocrSelectRect.value = { x, y, w: 0, h: 0 }
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
    ocrSelectedIds.value = new Set()
  }
  window.addEventListener('mousemove', handleOcrSelectMove)
  window.addEventListener('mouseup', handleOcrSelectEnd)
}

const handleOcrSelectMove = (e: MouseEvent) => {
  if (!ocrSelecting.value || !ocrSelectStart.value) return
  const overlay = document.querySelector('.ocr-overlay') as HTMLElement | null
  if (!overlay) return
  const rect = overlay.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
  const sx = ocrSelectStart.value.x
  const sy = ocrSelectStart.value.y
  ocrSelectRect.value = {
    x: Math.min(x, sx),
    y: Math.min(y, sy),
    w: Math.abs(x - sx),
    h: Math.abs(y - sy)
  }
  computeOcrSelection()
}

const handleOcrSelectEnd = () => {
  ocrSelecting.value = false
  ocrSelectRect.value = null
  window.removeEventListener('mousemove', handleOcrSelectMove)
  window.removeEventListener('mouseup', handleOcrSelectEnd)
}

const computeOcrSelection = () => {
  const r = ocrSelectRect.value
  if (!r) return
  const sw = ocrImageSize.value.w
  const sh = ocrImageSize.value.h
  if (!sw || !sh) return
  const scaleX = ocrRenderedSize.value.w / sw
  const scaleY = ocrRenderedSize.value.h / sh
  const next = new Set<string>()
  for (const w of ocrWords.value) {
    const wx = ocrRenderedSize.value.offsetX + w.left * scaleX
    const wy = ocrRenderedSize.value.offsetY + w.top * scaleY
    const ww = w.width * scaleX
    const wh = w.height * scaleY
    const cx = wx + ww / 2
    const cy = wy + wh / 2
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
      next.add(ocrWordKey(w))
    }
  }
  ocrSelectedIds.value = next
}

const toggleOcrWord = (w: OcrWord, e: MouseEvent) => {
  if (!ocrEnabled.value) return
  e.stopPropagation()
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

const ocrSelectAll = () => {
  const next = new Set<string>()
  for (const w of ocrWords.value) next.add(ocrWordKey(w))
  ocrSelectedIds.value = next
}

const buildOcrSelectedText = (): string => {
  if (ocrSelectedIds.value.size === 0) return ''
  const selected = ocrWords.value.filter((w: OcrWord) => ocrSelectedIds.value.has(ocrWordKey(w)))
  selected.sort((a: OcrWord, b: OcrWord) => a.lineId - b.lineId || a.wordIndex - b.wordIndex)
  const lines: string[] = []
  let currentLine = -1
  let buffer: string[] = []
  for (const w of selected) {
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

const copyOcrSelection = async () => {
  const text = buildOcrSelectedText()
  if (!text) {
    showOcrToast('请先选择文字')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    showOcrToast('已复制')
  } catch (err) {
    console.error('复制失败:', err)
    showOcrToast('复制失败')
  }
}

const copyAllOcrText = async () => {
  if (ocrWords.value.length === 0) {
    showOcrToast('暂无识别内容')
    return
  }
  const lines: string[] = []
  let currentLine = -1
  let buffer: string[] = []
  for (const w of [...ocrWords.value].sort((a: OcrWord, b: OcrWord) => a.lineId - b.lineId || a.wordIndex - b.wordIndex)) {
    if (w.lineId !== currentLine) {
      if (buffer.length) lines.push(buffer.join(' '))
      buffer = [w.text]
      currentLine = w.lineId
    } else {
      buffer.push(w.text)
    }
  }
  if (buffer.length) lines.push(buffer.join(' '))
  const text = lines.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    showOcrToast('已复制全部文字')
  } catch (err) {
    console.error('复制失败:', err)
    showOcrToast('复制失败')
  }
}

const handleViewerWheel = (e: WheelEvent) => {
  if (ocrEnabled.value) return
  e.preventDefault()
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const px = e.clientX - cx
  const py = e.clientY - cy

  const oldZoom = viewerZoom.value
  const delta = e.deltaY > 0 ? -0.15 : 0.15
  const newZoom = Math.min(8, Math.max(0.5, oldZoom * (1 + delta)))
  if (newZoom === oldZoom) return

  const ratio = newZoom / oldZoom
  viewerOffsetX.value = (viewerOffsetX.value - px) * ratio + px
  viewerOffsetY.value = (viewerOffsetY.value - py) * ratio + py
  viewerZoom.value = newZoom
}

const handleViewerMouseDown = (e: MouseEvent) => {
  if (e.button !== 0) return
  viewerDragging.value = true
  viewerDragStartX = e.clientX
  viewerDragStartY = e.clientY
  viewerOffsetStartX = viewerOffsetX.value
  viewerOffsetStartY = viewerOffsetY.value
  window.addEventListener('mousemove', handleViewerMouseMove)
  window.addEventListener('mouseup', handleViewerMouseUp)
}

const handleViewerMouseMove = (e: MouseEvent) => {
  if (!viewerDragging.value) return
  viewerOffsetX.value = viewerOffsetStartX + (e.clientX - viewerDragStartX)
  viewerOffsetY.value = viewerOffsetStartY + (e.clientY - viewerDragStartY)
}

const handleViewerMouseUp = () => {
  viewerDragging.value = false
  window.removeEventListener('mousemove', handleViewerMouseMove)
  window.removeEventListener('mouseup', handleViewerMouseUp)
}

const viewerZoomIn = () => {
  viewerZoom.value = Math.min(8, viewerZoom.value * 1.2)
}

const viewerZoomOut = () => {
  const next = Math.max(0.5, viewerZoom.value / 1.2)
  viewerZoom.value = next
  if (next <= 1) {
    viewerOffsetX.value = 0
    viewerOffsetY.value = 0
  }
}

const viewerReset = () => {
  viewerZoom.value = 1
  viewerOffsetX.value = 0
  viewerOffsetY.value = 0
}

const copyToClipboard = async (content: string, index: number) => {
  try {
    await navigator.clipboard.writeText(content)
    copiedIndex.value = index
    setTimeout(() => {
      if (copiedIndex.value === index) copiedIndex.value = null
    }, 1500)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

const formatText = (text: string): string => {
  if (!text) return ''

  let formatted = marked.parse(text, { async: false }) as string

  formatted = formatted.replace(/<tr[^>]*>(\s*<(td|th)[^>]*>\s*<\/(td|th)>\s*)+<\/tr>/g, '')

  formatted = formatted.replace(/<table([^>]*)>([\s\S]*?)<\/table>/g, (_match, attrs, body) => {
    const toolbar =
      '<div class="table-toolbar">' +
        '<span class="table-toolbar-label">表格</span>' +
        '<div class="table-toolbar-actions">' +
          '<button class="table-action-btn" onclick="event.stopPropagation(); window.copyTable && window.copyTable(this)" title="复制">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '</button>' +
          '<button class="table-action-btn" onclick="event.stopPropagation(); window.downloadTable && window.downloadTable(this)" title="下载">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          '</button>' +
          '<button class="table-action-btn" onclick="event.stopPropagation(); window.fullscreenTable && window.fullscreenTable(this)" title="全屏">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>'
    const styledAttrs = (attrs || '') + ' class="downloadable-table"'
    return '<div class="table-wrap">' + toolbar + '<div class="table-scroll"><table' + styledAttrs + '>' + body + '</table></div></div>'
  })

  formatted = formatted.replace(/<a /g, '<a style="color:#ffffff !important;text-decoration:underline;" target="_blank" rel="noopener noreferrer" ')

  return formatted
}

const hasTable = (text: string): boolean => {
  if (!text) return false
  return text.includes('|') && !text.includes('---')
}

const hasVideo = (text: string): boolean => {
  if (!text) return false
  return text.includes('.mp4') || text.includes('.webm') || text.includes('.mov') || text.includes('.avi') || text.includes('video')
}

const downloadTable = (text: string) => {
  const lines = text.trim().split('\n')
  const rows: string[][] = []
  
  for (const line of lines) {
    if (line.trim().startsWith('|') && !line.includes('---')) {
      const cells = line.split('|').filter(cell => cell.trim() !== '')
      rows.push(cells.map(cell => cell.trim()))
    }
  }
  
  if (rows.length === 0) return
  
  const csv = rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `table_${Date.now()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const toggleHistory = async () => {
  if (showHistory.value) {
    showHistory.value = false
  } else {
    showHistory.value = true
    showFavorites.value = false
    history.value = await window.electronAPI.getHistory() as ScreenshotRecord[]
  }
}

const toggleFavorites = async () => {
  if (showFavorites.value) {
    showFavorites.value = false
  } else {
    if (isCurrentFavorited.value && messages.value.length > 0) {
      const lastUserMsg = messages.value.find((m: FavoriteMessage) => m.role === 'user')
      const lastAssistantMsg = messages.value.find((m: FavoriteMessage) => m.role === 'assistant')
      const favToUpdate = favorites.value.find((f: Favorite) => f.id === currentFavoriteId.value)
      if (favToUpdate && lastUserMsg && lastAssistantMsg) {
        const updatedFavorite = {
          ...favToUpdate,
          timestamp: Date.now(),
          question: lastUserMsg.content || '',
          answer: lastAssistantMsg.content || '',
          messages: JSON.parse(JSON.stringify(messages.value))
        }
        const newFavorites = favorites.value.map((f: Favorite) => f.id === favToUpdate.id ? updatedFavorite : f)
        store.setFavorites(newFavorites)
        await saveFavorites()
      }
    }
    showFavorites.value = true
    showHistory.value = false
    currentFavorite.value = null
    favoriteSearch.value = ''
    const data = await window.electronAPI.getFavorites()
    store.setFavorites(data || [])
  }
}

const clearHistory = async () => {
  if (history.value.length === 0) return
  if (!confirm('确定清空所有历史记录？此操作不可恢复。')) return
  await window.electronAPI.saveHistory([])
  history.value = []
}

const loadFromHistory = (item: ScreenshotRecord) => {
  store.setCurrentImage(item.imageData)
  if (item.messages && item.messages.length > 0) {
    messages.value = JSON.parse(JSON.stringify(item.messages))
  } else if (item.question || item.answer) {
    messages.value = [
      { role: 'user', content: item.question, image: item.imageData },
      { role: 'assistant', content: item.answer }
    ]
  } else {
    messages.value = []
  }
  currentHistoryId.value = item.id
  currentFavoriteId.value = null
  showHistory.value = false
}

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const handlePanelKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (showImageViewer.value) {
      closeImageViewer()
      return
    }
    if (isFullscreen.value) {
      toggleFullscreen()
      return
    }
    messages.value = []
    window.electronAPI.hidePanel()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handlePanelKeyDown)
  window.addEventListener('click', handleGlobalClick)
  window.addEventListener('resize', updateOcrRenderedSize)
  await loadHotkeyFromSettings()
  await loadFavorites()
  
  ;(window as any).copyTable = async (trigger: HTMLElement) => {
    const wrap = trigger?.closest('.table-wrap')
    const table = wrap?.querySelector('.downloadable-table') as HTMLElement | null
    if (table) {
      await navigator.clipboard.writeText(table.innerText)
      flashToolbarLabel(wrap as HTMLElement, '已复制')
    }
  }

  ;(window as any).downloadTable = (trigger: HTMLElement) => {
    const wrap = trigger?.closest('.table-wrap')
    const table = wrap?.querySelector('.downloadable-table') as HTMLElement | null
    if (!table) return
    const rows: string[][] = []
    table.querySelectorAll('tr').forEach((tr) => {
      const row: string[] = []
      tr.querySelectorAll('td, th').forEach((cell) => {
        row.push(`"${(cell as HTMLElement).innerText.replace(/"/g, '""')}"`)
      })
      if (row.length > 0) rows.push(row)
    })
    const csvContent = '﻿' + rows.map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `table_${Date.now()}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  ;(window as any).fullscreenTable = (trigger: HTMLElement) => {
    const wrap = trigger?.closest('.table-wrap') as HTMLElement | null
    if (!wrap) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else if (wrap.requestFullscreen) {
      wrap.requestFullscreen()
    }
  }

  function flashToolbarLabel(wrap: HTMLElement, text: string) {
    const label = wrap.querySelector('.table-toolbar-label') as HTMLElement | null
    if (!label) return
    const original = label.textContent
    label.textContent = text
    label.classList.add('flash')
    setTimeout(() => {
      label.textContent = original
      label.classList.remove('flash')
    }, 1200)
  }
  
  window.electronAPI.onSettingsUpdated((s) => {
    if (s?.screenshotHotkey) screenshotHotkey.value = s.screenshotHotkey
  })
  window.electronAPI.onScreenshotTaken(async (data) => {
    const newChat = localStorage.getItem('newChat') === 'true'
    localStorage.removeItem('newChat')
    
    console.log('[onScreenshotTaken] newChat:', newChat, 'currentFavoriteId before:', currentFavoriteId.value)
    store.setCurrentImage(data.dataUrl)
    if (newChat) {
      currentFavoriteId.value = null
      currentHistoryId.value = null
    }
    console.log('[onScreenshotTaken] currentFavoriteId after:', currentFavoriteId.value)
    showFavorites.value = false
    showHistory.value = false
    
    if (newChat) {
      messages.value = []
    }
    
    isLoading.value = true
    isStreaming.value = false

    const prompt = data.customPrompt || '解析截图内容，回答截图相关问题，提取关键信息'
    const userQuestion = data.customPrompt ? data.customPrompt : '解析截图内容'

    console.log('Screenshot taken, newChat:', newChat, 'messages before:', messages.value.length)
    messages.value.push({ role: 'user', content: userQuestion, image: data.dataUrl })
    messages.value.push({ role: 'assistant', content: '' })
    console.log('Messages after push:', messages.value.length)
    const msgIndex = messages.value.length - 1
    scrollToBottom()

    abortController = new AbortController()
    const signal = abortController.signal

    try {
      const response = await store.sendToAI(prompt, [], data.dataUrl, (token: string) => {
        isStreaming.value = true
        messages.value[msgIndex].content += token
        scrollToBottom()
      }, signal)
      if (response && !messages.value[msgIndex].content) {
        isStreaming.value = true
        const chars = response.split('')
        for (let i = 0; i < chars.length; i++) {
          if (signal.aborted) break
          messages.value[msgIndex].content += chars[i]
          scrollToBottom()
          await new Promise(r => setTimeout(r, 10))
        }
      }
      saveToHistory()
    } catch (error) {
      if ((error as any)?.name === 'AbortError' || signal.aborted) {
        if (!messages.value[msgIndex].content) {
          messages.value[msgIndex].content = '已停止生成'
        } else {
          messages.value[msgIndex].content += '\n\n[已停止生成]'
        }
        saveToHistory()
      } else {
        messages.value[msgIndex].content = '抱歉，AI 服务暂时不可用。'
      }
      scrollToBottom()
    }

    abortController = null
    isLoading.value = false
    isStreaming.value = false
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handlePanelKeyDown)
  window.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('resize', updateOcrRenderedSize)
})
</script>

<template>
  <div class="panel">
    <div class="panel-header" @mousedown="handleDragStart">
      <div class="header-left">
        <span class="logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#ff6b8b"/>
                <stop offset="100%" stop-color="#e94560"/>
              </linearGradient>
            </defs>
            <rect x="2.5" y="5" width="14" height="12" rx="2.5" stroke="url(#logoGrad)" stroke-width="1.8"/>
            <circle cx="9.5" cy="11" r="2.2" stroke="url(#logoGrad)" stroke-width="1.6"/>
            <path d="M18.5 4.5L19.4 6.6L21.5 7.5L19.4 8.4L18.5 10.5L17.6 8.4L15.5 7.5L17.6 6.6Z" fill="url(#logoGrad)"/>
            <circle cx="20.5" cy="14.5" r="1" fill="url(#logoGrad)"/>
          </svg>
        </span>
        <span class="title">SnapAI</span>
      </div>
      <div class="header-actions">
        <button class="btn-icon agent-toggle" :class="{ active: agentMode }" @click="toggleAgentMode" :title="agentMode ? '关闭 Agent 模式' : '开启 Agent 模式'">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="7" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/>
            <path d="M12 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="12" cy="3" r="1.2" fill="currentColor"/>
            <circle cx="9" cy="13" r="1.2" fill="currentColor"/>
            <circle cx="15" cy="13" r="1.2" fill="currentColor"/>
            <path d="M9 17h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="btn-icon" @click="openSettings" title="设置">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.6"/>
          </svg>
        </button>
        <button class="btn-icon" @click="toggleHistory" :class="{ active: showHistory }" title="历史">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="btn-icon" @click="toggleFavorites" :class="{ active: showFavorites }" title="收藏">
          <img src="/favorite.png" alt="收藏" class="btn-icon-img" />
        </button>
        <button class="btn-icon" @click="clearChat" title="删除此条会话">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="btn-icon" @click="toggleFullscreen" title="全屏">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="btn-icon" @click="handleMinimize" title="最小化">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="btn-icon close" @click="handleClose" title="关闭">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="panel-content" ref="panelContent" @mouseenter="isHoveringMessages = true" @mouseleave="isHoveringMessages = false">
      <div v-if="showHistory" class="history-view">
        <div class="history-header">
          <span>历史记录</span>
          <button
            class="history-clear-btn"
            @click="clearHistory"
            :disabled="history.length === 0"
            title="清空全部历史"
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <span>清空</span>
          </button>
        </div>
        <div v-if="history.length === 0" class="history-empty">
          暂无历史记录
        </div>
        <div v-else class="history-list">
          <div
            v-for="item in history"
            :key="item.id"
            class="history-item"
            @click="loadFromHistory(item)"
          >
            <div class="history-thumb">
              <img v-if="item.imageData" :src="item.imageData" alt="截图" />
            </div>
            <div class="history-info">
              <div class="history-question">{{ item.question }}</div>
              <div class="history-time">{{ formatTime(item.timestamp) }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="showFavorites && !currentFavorite" class="history-view">
        <div class="history-header favorites-header">
          <button class="back-btn" @click="showFavorites = false">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="favorites-title">我的收藏</span>
        </div>
        <div class="favorites-search">
          <input
            v-model="favoriteSearch"
            type="text"
            placeholder="搜索收藏标题..."
          />
        </div>
        <div v-if="filteredFavorites.length === 0" class="history-empty">
          暂无收藏
        </div>
        <div v-else class="history-list">
          <div
            v-for="item in filteredFavorites"
            :key="item.id"
            class="history-item"
            @click="viewFavorite(item)"
          >
            <div class="history-thumb">
              <img v-if="item.imageData" :src="item.imageData" alt="截图" />
            </div>
            <div class="history-info">
              <div class="history-question" @click="handleTitleClick(item, $event)" @dblclick="startEditTitle(item, $event)">
                <template v-if="editingFavoriteId === item.id">
                  <input 
                    v-model="editingTitle" 
                    class="edit-title-input"
                    @blur="saveEditTitle"
                    @keyup.enter="saveEditTitle"
                    @keyup.escape="cancelEditTitle"
                    @click.stop
                    autofocus
                  />
                </template>
                <template v-else>{{ item.title }}</template>
              </div>
              <div class="history-time">{{ formatTime(item.timestamp) }}</div>
            </div>
            <button class="delete-btn" @click.stop="deleteFavorite(item.id)" title="删除">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="currentFavorite" class="history-view">
        <div class="history-header">
          <button class="back-btn" @click="backToChat">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span>{{ currentFavorite.question || '收藏详情' }}</span>
        </div>
        <div class="favorite-detail">
          <div v-if="currentFavorite.imageData" class="detail-image">
            <img :src="currentFavorite.imageData" alt="截图" />
          </div>
          <div class="detail-content">
            <div class="detail-label">问题：</div>
            <div class="detail-text">{{ currentFavorite.question }}</div>
            <div class="detail-label">回答：</div>
            <div class="detail-text">{{ currentFavorite.answer }}</div>
          </div>
        </div>
      </div>

      <template v-else>
        <div v-if="messages.length === 0 && !isLoading" class="empty-state">
          <div class="empty-icon">📸</div>
          <p>按下 <kbd>{{ formatHotkey(screenshotHotkey) }}</kbd> 截图</p>
          <p class="sub">截图将自动发送给 AI 解析</p>
        </div>

        <div v-else class="messages">
          <div
            v-for="(msg, index) in messages"
            :key="index"
            class="message"
            :class="msg.role"
          >
            <div class="message-avatar">
              {{ msg.role === 'user' ? '👤' : '🤖' }}
            </div>
            <div v-if="msg.role === 'user'" class="user-message-stack">
              <button
                class="rerun-btn"
                @click="rerunQuestion(msg.content, msg.image)"
                title="重新提问"
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M21 12a9 9 0 1 1-2.5-6.2M21 4v6h-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div class="message-content">
                <img v-if="msg.image" :src="msg.image" class="message-image" @click="openImageViewer(msg.image)" />
                <div v-if="msg.content" v-html="msg.content"></div>
              </div>
            </div>
            <div class="message-content" v-else-if="!msg.content && isLoading">
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
            <div class="message-wrapper" v-else>
              <div v-if="msg.toolEvents && msg.toolEvents.length" class="agent-tool-events">
                <div
                  v-for="(t, i) in msg.toolEvents"
                  :key="i"
                  class="agent-workflow-step"
                  :class="t.status"
                >
                  <div class="agent-step-marker">
                    <svg v-if="t.status === 'done'" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M20 7L10 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span v-else-if="t.status === 'running'"></span>
                    <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
                      <path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.8"/>
                    </svg>
                  </div>
                  <div class="agent-step-content">
                    <div class="agent-step-title-row">
                      <span class="agent-tool-name">{{ t.toolName }}</span>
                      <span class="agent-tool-status">
                        <span v-if="t.status === 'running'">执行中</span>
                        <span v-else-if="t.status === 'done'">完成</span>
                        <span v-else>异常</span>
                      </span>
                    </div>
                    <div class="agent-tool-target" v-if="t.input?.path || t.input?.from || t.input?.url">{{ t.input.path || t.input.from || t.input.url }}</div>
                  </div>
                  <!-- <span class="agent-tool-status">
                    <span v-if="t.status === 'running'">…</span>
                    <span v-else-if="t.status === 'done'">✓</span>
                    <span v-else>✕</span>
                  </span>
                  </span> -->
                </div>
              </div>
              <div
                class="message-content"
                :class="{ 'agent-result-card': msg.toolEvents && msg.toolEvents.length }"
              >
                <div v-if="msg.toolEvents && msg.toolEvents.length" class="agent-result-icon">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 7L10 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <div class="agent-result-text" v-html="formatText(msg.content)"></div>
              </div>
              <div v-if="!msg.toolEvents || !msg.toolEvents.length" class="message-actions">
                <button
                  v-if="hasTable(msg.content)"
                  class="action-btn"
                  @click="downloadTable(msg.content)"
                  title="下载表格"
                >
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button
                  class="action-btn"
                  :class="{ copied: copiedIndex === index }"
                  @click="copyToClipboard(msg.content, index)"
                  :title="copiedIndex === index ? '已复制' : '复制'"
                >
                <svg v-if="copiedIndex !== index" class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/>
                  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
                <svg v-else class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="panel-input">
      <button
        class="btn-upload"
        @click="handleUploadClick"
        :disabled="isLoading || showHistory || showFavorites"
        title="上传图片"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <div v-if="uploadedImage" class="upload-preview">
        <button class="upload-thumb" @click="openImageViewer(uploadedImage)" title="查看图片">
          <img :src="uploadedImage" :alt="uploadedImageName || '上传图片'" />
        </button>
        <div class="upload-meta">
          <span class="upload-label">已添加图片</span>
          <span class="upload-name">{{ uploadedImageName }}</span>
        </div>
        <button class="upload-remove" @click="clearUploadedImage" title="移除图片">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <input
        class="text-input"
        v-model="inputText"
        type="text"
        :placeholder="uploadedImage ? '输入你想基于这张图片提问的内容...' : '继续追问...'"
        :disabled="isLoading || showHistory || showFavorites"
        @keyup.enter="sendMessage"
      />
      <button class="btn-favorite" @click="toggleFavorite" :disabled="showHistory || showFavorites" :title="isCurrentFavorited ? '取消收藏' : '收藏'">
        <img v-if="isCurrentFavorited" src="/favorited.png" alt="已收藏" />
        <img v-else src="/favorite.png" alt="收藏" />
      </button>
      <button
        v-if="isLoading"
        class="btn-stop"
        @click="stopMessage"
        title="停止生成"
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>
        </svg>
        <span>停止</span>
      </button>
      <button
        v-else
        class="btn-send"
        @click="sendMessage"
        :disabled="(!inputText.trim() && !uploadedImage) || showHistory || showFavorites"
      >
        发送
      </button>
    </div>

    <div class="resize-handle top-right" @mousedown="startResize('top-right', $event)"></div>
    <div class="resize-handle bottom-right" @mousedown="startResize('bottom-right', $event)"></div>

    <div
      v-if="showImageViewer"
      class="image-viewer-overlay"
      @click.self="closeImageViewer"
      @wheel="handleViewerWheel"
    >
      <div
        class="image-viewer-content"
        :class="{ dragging: viewerDragging, 'ocr-mode': ocrEnabled }"
        @click.stop
        @mousedown="ocrEnabled ? null : handleViewerMouseDown($event)"
      >
        <img
          ref="viewerImageEl"
          :src="viewerImage"
          class="viewer-image"
          :style="{ transform: `translate(${viewerOffsetX}px, ${viewerOffsetY}px) scale(${viewerZoom})` }"
          draggable="false"
          @load="updateOcrRenderedSize"
        />
        <div
          v-if="ocrEnabled && ocrWords.length"
          class="ocr-overlay"
          @mousedown="handleOcrSelectStart"
        >
          <div
            v-for="w in ocrWords"
            :key="ocrWordKey(w)"
            class="ocr-word"
            :class="{ selected: ocrSelectedIds.has(ocrWordKey(w)) }"
            :style="ocrWordStyle(w)"
            @mousedown.stop
            @click="toggleOcrWord(w, $event)"
            :title="w.text"
          >
            <span class="ocr-word-text">{{ w.text }}</span>
          </div>
          <div
            v-if="ocrSelectRect"
            class="ocr-marquee"
            :style="{ left: `${ocrSelectRect.x}px`, top: `${ocrSelectRect.y}px`, width: `${ocrSelectRect.w}px`, height: `${ocrSelectRect.h}px` }"
          ></div>
        </div>
        <div v-if="ocrLoading" class="ocr-loading">
          <div class="ocr-spinner"></div>
          <div class="ocr-loading-text">正在识别文字 {{ ocrProgress }}%</div>
        </div>
        <div v-if="ocrToast" class="ocr-toast">{{ ocrToast }}</div>
      </div>
      <div class="viewer-toolbar" @click.stop>
        <button class="viewer-tool-btn" @click="viewerZoomOut" title="缩小">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <span class="viewer-zoom-label">{{ Math.round(viewerZoom * 100) }}%</span>
        <button class="viewer-tool-btn" @click="viewerZoomIn" title="放大">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="viewer-tool-btn" @click="viewerReset" title="重置">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="viewer-toolbar-divider"></div>
        <button
          class="viewer-tool-btn ocr-toggle"
          :class="{ active: ocrEnabled, loading: ocrLoading }"
          @click="runOcr"
          :disabled="ocrLoading"
          :title="ocrEnabled ? '退出文字识别' : '识别文字 (OCR)'"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M7 9h2v6H7zM11 9h2v6h-2zM15 9h2v6h-2z" fill="currentColor"/>
          </svg>
        </button>
        <template v-if="ocrEnabled">
          <button class="viewer-tool-btn" @click="ocrSelectAll" title="全选文字">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <path d="M8 12l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="viewer-tool-btn" @click="copyOcrSelection" :disabled="ocrSelectedIds.size === 0" title="复制所选">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="viewer-tool-btn" @click="copyAllOcrText" title="复制全部文字">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </template>
      </div>
      <button class="viewer-close" @click="closeImageViewer" title="关闭">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div v-if="showFavoriteDialog" class="dialog-overlay" @click.self="showFavoriteDialog = false">
      <div class="dialog">
        <div class="dialog-header">
          <img src="/favorite.png" alt="收藏" class="dialog-icon-img" />
          <span>收藏此对话</span>
        </div>
        <div class="dialog-body">
          <input
            v-model="favoriteTitle"
            type="text"
            placeholder="请输入收藏标题..."
            @keyup.enter="confirmFavorite"
            autofocus
          />
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="showFavoriteDialog = false">取消</button>
          <button class="btn-confirm" @click="confirmFavorite" :disabled="!favoriteTitle.trim()">确认收藏</button>
        </div>
      </div>
    </div>

    <div v-if="showAgentAuthModal" class="dialog-mask" @click.self="cancelAgentAuth">
      <div class="dialog agent-auth-dialog">
        <div class="dialog-title">授权 Agent 操作本次任务</div>
        <div class="agent-auth-body">
          <div class="agent-auth-tip">本次任务期间,Agent 可在以下目录读写、移动、删除(删除走回收站):</div>
          <div v-if="agentAllowedDirs.length === 0" class="agent-auth-empty">
            尚未配置允许目录,请先在设置 → Agent 允许目录 中添加。
          </div>
          <div v-else class="agent-auth-dirs">
            <div v-for="d in agentAllowedDirs" :key="d" class="agent-auth-dir">{{ d }}</div>
          </div>
          <div class="agent-auth-warn">提示词注入或模型误解都可能导致非预期操作,授权前请确认目录范围。</div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="cancelAgentAuth">取消</button>
          <button class="btn-confirm" :disabled="agentAllowedDirs.length === 0" @click="confirmAgentAuth">允许并开始</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  width: 100%;
  height: 100%;
  background: #16213e;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #16213e;
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.logo {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.logo svg {
  width: 100%;
  height: 100%;
}

.title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(90deg, #ff6b8b 0%, #e94560 30%, #a855f7 65%, #38bdf8 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: titleShine 6s linear infinite;
  text-transform: uppercase;
}

@keyframes titleShine {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.header-actions {
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #9a9ab0;
  cursor: pointer;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-icon svg {
  width: 16px;
  height: 16px;
}

.btn-icon-img {
  width: 16px;
  height: 16px;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.btn-icon.active {
  background: transparent;
  color: inherit;
}

.btn-icon.close:hover {
  background: #e94560;
  color: #fff;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  color: #8a8aa8;
  cursor: pointer;
  border-radius: 6px;
  padding: 0;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.copy-btn.copied {
  color: #4ade80;
}

.copy-icon {
  width: 15px;
  height: 15px;
}

.message-wrapper:hover .copy-btn {
  opacity: 1;
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  position: absolute;
  right: 8px;
  top: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.message-wrapper {
  position: relative;
}

.message.assistant .message-actions {
  position: absolute;
  right: 8px;
  top: 8px;
}

.message-wrapper:hover .message-actions {
  opacity: 1;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  color: #8a8aa8;
  cursor: pointer;
  border-radius: 6px;
  padding: 0;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.action-btn.copied {
  color: #4ade80;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  scrollbar-width: thin;
  scrollbar-color: #3a3a5a #1a1a2e;
  min-width: 0;
}

.panel-content::-webkit-scrollbar {
  width: 1px;
}

.panel-content::-webkit-scrollbar-track {
  background: transparent;
}

.panel-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

.panel-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.history-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 16px;
  letter-spacing: 0.5px;
}

.history-clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid #3a3a5a;
  color: #9a9ab0;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.history-clear-btn svg {
  width: 13px;
  height: 13px;
}

.history-clear-btn:hover:not(:disabled) {
  background: #e94560;
  border-color: #e94560;
  color: #fff;
}

.history-clear-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-empty {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: #16213e;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.history-item:hover {
  background: #1f2849;
}

.history-thumb {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  background: #0f0f1a;
  flex-shrink: 0;
  cursor: pointer;
}

.history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.history-question {
  font-size: 13px;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edit-title-input {
  width: 100%;
  background: #2a2a4a;
  border: 1px solid #c86b7d;
  border-radius: 4px;
  padding: 4px 8px;
  color: #fff;
  font-size: 13px;
  outline: none;
}

.history-time {
  font-size: 11px;
  color: #666;
}

.image-preview {
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  background: #0f0f1a;
}

.image-preview img {
  width: 100%;
  display: block;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #888;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state p {
  margin: 8px 0;
}

.empty-state .sub {
  font-size: 12px;
  color: #666;
}

.empty-state kbd {
  background: #2a2a4a;
  padding: 4px 8px;
  border-radius: 4px;
  font-family: monospace;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  max-width: 100%;
}

.message {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-width: 0;
  max-width: 100%;
}

.message.user {
  flex-direction: row-reverse;
}

.user-message-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 0;
  max-width: calc(100% - 44px);
}

.message-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
  max-width: calc(100% - 44px);
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #2a2a4a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  position: relative;
}

.message.assistant .message-avatar {
  background: #e94560;
}

.message-image {
  max-width: 100%;
  border-radius: 10px;
  margin-bottom: 8px;
  cursor: zoom-in;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.message-image:hover {
  transform: scale(1.01);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}

.rerun-btn {
  align-self: flex-end;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s, border-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.message:hover .rerun-btn {
  opacity: 1;
}

.rerun-btn:hover {
  background: rgba(233, 69, 96, 0.15);
  border-color: #e94560;
}

.rerun-btn svg {
  width: 14px;
  height: 14px;
  color: #c86b7d;
}

.message-content {
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.message-content :deep(p),
.message-content :deep(li),
.message-content :deep(blockquote),
.message-content :deep(h1),
.message-content :deep(h2),
.message-content :deep(h3),
.message-content :deep(h4),
.message-content :deep(h5),
.message-content :deep(h6) {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-content :deep(pre) {
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.message-content :deep(code) {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.message-content a {
  color: #ffffff !important;
  text-decoration: underline;
}

.message-content table {
  max-width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}

.message-content table td,
.message-content table th {
  padding: 8px 12px;
  border: 1px solid #3a3a5a;
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-content table th {
  background: #1d1d33;
  font-weight: 600;
}

.message-content :deep(.table-wrap) {
  margin: 10px 0;
  max-width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
  white-space: normal;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.message-content :deep(.table-wrap:fullscreen) {
  background: #0f0f1a;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.message-content :deep(.table-wrap:fullscreen .table-scroll) {
  flex: 1;
  overflow: auto;
}

.message-content :deep(.table-toolbar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px 6px 14px;
  background: #1d2844;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.message-content :deep(.table-toolbar-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  letter-spacing: 0.4px;
  transition: color 0.2s ease;
}

.message-content :deep(.table-toolbar-label.flash) {
  color: #4ade80;
}

.message-content :deep(.table-toolbar-actions) {
  display: flex;
  gap: 4px;
}

.message-content :deep(.table-action-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.message-content :deep(.table-action-btn svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.message-content :deep(.table-action-btn:hover) {
  background: #e94560;
  border-color: #e94560;
  color: #ffffff;
}

.message-content :deep(.table-scroll) {
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.message-content :deep(.downloadable-table) {
  margin: 0;
  font-size: 13px;
  border-collapse: collapse;
  width: 100%;
  border: none;
  color: rgba(255, 255, 255, 0.85);
}

.message-content :deep(.downloadable-table td),
.message-content :deep(.downloadable-table th) {
  padding: 10px 14px;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-content :deep(.downloadable-table td:last-child),
.message-content :deep(.downloadable-table th:last-child) {
  border-right: none;
}

.message-content :deep(.downloadable-table tr:last-child td) {
  border-bottom: none;
}

.message-content :deep(.downloadable-table thead th),
.message-content :deep(.downloadable-table tr:first-child th) {
  background: #212b47;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 0.2px;
}

.message-content :deep(.downloadable-table tbody tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.015);
}

.message-content :deep(.downloadable-table tbody tr:hover) {
  background: rgba(255, 255, 255, 0.04);
}

.message.user .message-content {
  background: linear-gradient(135deg, #2a3358, #1d2844);
  border: 1px solid rgba(124, 137, 200, 0.25);
  border-bottom-right-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  position: relative;
}

.message.assistant .message-content {
  background: #16213e;
  border-bottom-left-radius: 4px;
  position: relative;
  padding-right: 40px;
  width: fit-content;
}

.message.assistant .message-content.agent-result-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: min(420px, 100%);
  padding: 14px 16px;
  padding-right: 42px;
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(56, 189, 248, 0.06));
  border: 1px solid rgba(74, 222, 128, 0.22);
  border-radius: 12px;
  border-bottom-left-radius: 4px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.agent-result-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-top: 1px;
  color: #0f172a;
  background: #72d98b;
  border-radius: 50%;
  box-shadow: 0 0 0 5px rgba(114, 217, 139, 0.12);
  flex-shrink: 0;
}

.agent-result-icon svg {
  width: 15px;
  height: 15px;
}

.agent-result-text {
  min-width: 0;
  color: rgba(255, 255, 255, 0.92);
}

.agent-result-text :deep(p) {
  margin: 0;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #666;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-8px);
    opacity: 1;
  }
}

.panel-input {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: #16213e;
  min-width: 0;
}

.panel-input .btn-upload {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  flex-shrink: 0;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  color: rgba(255, 255, 255, 0.72);
}

.panel-input .btn-upload:hover:not(:disabled) {
  opacity: 1;
  border-color: rgba(233, 69, 96, 0.55);
  color: #ffffff;
  background: rgba(233, 69, 96, 0.16);
}

.btn-upload svg {
  width: 18px;
  height: 18px;
}

.upload-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  order: -1;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 68px;
  padding: 8px;
  background: rgba(31, 40, 73, 0.72);
  border: 1px solid rgba(124, 137, 200, 0.18);
  border-radius: 10px;
  flex-shrink: 0;
}

.panel-input .upload-thumb {
  display: inline-flex;
  width: 52px;
  height: 52px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
  cursor: zoom-in;
}

.upload-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.upload-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.upload-label {
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  font-weight: 600;
}

.upload-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
}

.upload-preview img {
  flex-shrink: 0;
}

.panel-input .upload-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  flex-shrink: 0;
}

.panel-input .upload-remove:hover:not(:disabled) {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.upload-remove svg {
  width: 13px;
  height: 13px;
}

.panel-input .text-input {
  flex: 1;
  flex-basis: 0;
  min-width: 0;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  padding: 10px 14px;
  color: #fff;
  font-size: 14px;
  outline: none;
}

.panel-input .text-input:focus {
  border-color: #e94560;
}

.panel-input .text-input:disabled {
  opacity: 0.5;
}

.panel-input .btn-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 84px;
  height: 40px;
  min-width: 84px;
  flex: 0 0 84px;
  background: #e94560;
  border: none;
  border-radius: 8px;
  padding: 0 18px;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.2s;
}

.panel-input .btn-send:disabled,
.panel-input .btn-upload:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel-input .btn-send:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-stop {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #2a2f4a, #1d2844);
  border: 1px solid rgba(233, 69, 96, 0.4);
  border-radius: 8px;
  padding: 9px 16px;
  color: #ff6b8b;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-stop svg {
  width: 14px;
  height: 14px;
}

.btn-stop:hover {
  background: linear-gradient(135deg, #322a44, #29203a);
  border-color: rgba(233, 69, 96, 0.7);
  box-shadow: 0 0 0 2px rgba(233, 69, 96, 0.15);
}

.resize-handle {
  position: absolute;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  -webkit-app-region: no-drag;
}

.resize-handle.top-right {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}

.resize-handle.bottom-right {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}

.btn-favorite {
  background: transparent !important;
  border: none !important;
  padding: 6px 10px !important;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.btn-favorite:hover:not(:disabled) {
  opacity: 0.8;
}

.btn-favorite img {
  width: 20px;
  height: 20px;
}

.favorites-search {
  padding: 0 16px 16px;
}

.favorites-header {
  padding: 16px 16px 0;
}

.favorites-title {
  font-size: 15px;
  font-weight: 500;
  color: #fff;
}

.favorites-search input {
  width: 100%;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  padding: 10px 14px;
  color: #fff;
  font-size: 14px;
  outline: none;
}

.favorites-search input:focus {
  border-color: #c86b7d;
}

.back-btn {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-btn:hover {
  color: #fff;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.delete-btn {
  background: transparent;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.history-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  color: #e94560;
}

.delete-btn svg {
  width: 16px;
  height: 16px;
}

.favorite-detail {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.detail-image img {
  width: 100%;
  border-radius: 8px;
  margin-bottom: 16px;
}

.detail-label {
  font-size: 12px;
  color: #888;
  margin-top: 12px;
  margin-bottom: 4px;
}

.detail-text {
  color: #ccc;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.image-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  overflow: hidden;
}

.image-viewer-content {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  overflow: hidden;
}

.image-viewer-content.dragging {
  cursor: grabbing;
}

.viewer-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
  user-select: none;
  -webkit-user-drag: none;
  transition: transform 0.05s linear;
  will-change: transform;
}

.viewer-toolbar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: rgba(20, 24, 40, 0.85);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  z-index: 2;
}

.viewer-tool-btn {
  background: transparent;
  border: none;
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.viewer-tool-btn svg {
  width: 16px;
  height: 16px;
}

.viewer-tool-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.viewer-zoom-label {
  color: #fff;
  font-size: 12px;
  min-width: 44px;
  text-align: center;
  user-select: none;
}

.viewer-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  transition: background 0.15s, color 0.15s;
}

.viewer-close svg {
  width: 15px;
  height: 15px;
}

.viewer-close:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(8, 12, 28, 0.62);
  backdrop-filter: blur(10px);
}

.dialog {
  background: #1f2849;
  border-radius: 12px;
  padding: 16px;
  width: 280px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

.dialog-icon {
  width: 16px;
  height: 16px;
}

.dialog-icon-img {
  width: 16px;
  height: 16px;
}

.dialog-body input {
  width: 100%;
  background: #2a2a4a;
  border: 1px solid #3a3a5a;
  border-radius: 8px;
  padding: 10px;
  color: #fff;
  font-size: 14px;
  outline: none;
}

.dialog-body input:focus {
  border-color: #c86b7d;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.dialog-footer .btn-cancel {
  background: transparent;
  border: 1px solid #3a3a5a;
  color: #888;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.dialog-footer .btn-cancel:hover {
  border-color: #666;
  color: #fff;
}

.dialog-footer .btn-confirm {
  background: #c86b7d;
  border: none;
  color: #fff;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.dialog-footer .btn-confirm:hover:not(:disabled) {
  background: #e85570;
}

.dialog-footer .btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.image-viewer-content.ocr-mode {
  cursor: default;
}

.image-viewer-content.ocr-mode .viewer-image {
  transition: none;
  user-select: none;
}

.ocr-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: auto;
  cursor: crosshair;
  user-select: none;
}

.ocr-word {
  position: absolute;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.08);
  cursor: text;
  overflow: hidden;
  transition: background 0.1s, border-color 0.1s;
  box-sizing: border-box;
}

.ocr-word:hover {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.85);
}

.ocr-word.selected {
  background: rgba(233, 69, 96, 0.32);
  border-color: rgba(233, 69, 96, 0.95);
  box-shadow: 0 0 0 1px rgba(233, 69, 96, 0.6) inset;
}

.ocr-word-text {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  color: transparent;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}

.ocr-marquee {
  position: absolute;
  border: 1px dashed rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
  pointer-events: none;
  box-sizing: border-box;
}

.ocr-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 18px 26px;
  background: rgba(20, 24, 40, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: #fff;
  z-index: 5;
  backdrop-filter: blur(8px);
}

.ocr-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: #e94560;
  border-radius: 50%;
  animation: ocrSpin 0.8s linear infinite;
}

@keyframes ocrSpin {
  to { transform: rotate(360deg); }
}

.ocr-loading-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}

.ocr-toast {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 14px;
  background: rgba(20, 24, 40, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  color: #fff;
  font-size: 12px;
  z-index: 6;
  backdrop-filter: blur(8px);
  animation: ocrToastIn 0.18s ease-out;
}

@keyframes ocrToastIn {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.viewer-toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.18);
  margin: 0 4px;
}

.viewer-tool-btn.ocr-toggle.active {
  background: rgba(233, 69, 96, 0.35);
  color: #fff;
}

.viewer-tool-btn.ocr-toggle.loading {
  opacity: 0.6;
  cursor: wait;
}

.viewer-tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-icon.agent-toggle.active {
  background: linear-gradient(135deg, rgba(255, 107, 139, 0.2), rgba(168, 85, 247, 0.2));
  color: #ff6b8b;
}

.agent-tool-events {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: min(390px, 100%);
  margin: 2px 0 4px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}

.agent-workflow-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  position: relative;
  padding: 0 0 14px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

.agent-workflow-step:last-child {
  padding-bottom: 0;
}

.agent-workflow-step::before {
  content: "";
  position: absolute;
  left: 11px;
  top: 26px;
  bottom: 4px;
  width: 1px;
  background: linear-gradient(180deg, rgba(114, 217, 139, 0.42), rgba(255, 255, 255, 0.08));
}

.agent-workflow-step:last-child::before {
  display: none;
}

.agent-step-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 50%;
  color: #102018;
  background: #72d98b;
  box-shadow: 0 0 0 4px rgba(114, 217, 139, 0.11);
  flex-shrink: 0;
  z-index: 1;
}

.agent-step-marker svg {
  width: 13px;
  height: 13px;
}

.agent-step-marker span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.agent-workflow-step.running .agent-step-marker {
  color: #ffffff;
  background: #ff7b96;
  box-shadow: 0 0 0 4px rgba(255, 107, 139, 0.12);
}

.agent-workflow-step.error .agent-step-marker {
  color: #ffffff;
  background: #f87171;
  box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.12);
}

.agent-step-content {
  min-width: 0;
  flex: 1;
  padding: 7px 10px 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.065);
  border-radius: 9px;
}

.agent-step-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 4px;
}

.agent-tool-name {
  color: #ff7b96;
  font-weight: 700;
  flex-shrink: 0;
}

.agent-workflow-step.error .agent-tool-name {
  color: #f87171;
}

.agent-tool-target {
  min-width: 0;
  color: rgba(255, 255, 255, 0.52);
  font-family: Consolas, "SFMono-Regular", monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-tool-status {
  margin-left: auto;
  color: #72d98b;
  flex-shrink: 0;
  font-size: 11px;
}

.agent-workflow-step.running .agent-tool-status {
  color: #ff9aae;
}

.agent-workflow-step.error .agent-tool-status {
  color: #f87171;
}

.agent-auth-dialog {
  width: min(440px, 100%);
  max-width: 440px;
  padding: 22px 24px 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #20294d;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
}

.agent-auth-dialog .dialog-title {
  margin-bottom: 14px;
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0;
}

.agent-auth-body {
  padding: 0;
}

.agent-auth-tip {
  margin-bottom: 14px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
  line-height: 1.6;
}

.agent-auth-empty {
  margin-bottom: 14px;
  padding: 12px 14px;
  color: #fecaca;
  font-size: 12px;
  line-height: 1.5;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.18);
  border-radius: 8px;
}

.agent-auth-dirs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 170px;
  overflow-y: auto;
  margin-bottom: 14px;
  padding-right: 2px;
}

.agent-auth-dir {
  padding: 10px 12px;
  color: rgba(255, 255, 255, 0.86);
  font-family: Consolas, "SFMono-Regular", monospace;
  font-size: 12px;
  line-height: 1.35;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  word-break: break-all;
}

.agent-auth-warn {
  padding: 10px 12px;
  color: #fbbf24;
  font-size: 12px;
  line-height: 1.5;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.16);
  border-radius: 8px;
}

.agent-auth-dialog .dialog-footer {
  margin-top: 18px;
  gap: 10px;
}

.agent-auth-dialog .btn-cancel,
.agent-auth-dialog .btn-confirm {
  min-width: 94px;
  height: 38px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}

.agent-auth-dialog .btn-cancel {
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.1);
}

.agent-auth-dialog .btn-cancel:hover {
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
}

.agent-auth-dialog .btn-confirm {
  background: #e94560;
}

.agent-auth-dialog .btn-confirm:hover:not(:disabled) {
  background: #f0526d;
}
</style>

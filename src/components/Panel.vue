<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useScreenshotStore } from '../store/screenshot'

const store = useScreenshotStore()
const messages = ref<Array<{ role: string; content: string; image?: string }>>([])
const inputText = ref('')
const isLoading = ref(false)
const isStreaming = ref(false)
const copiedIndex = ref<number | null>(null)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const windowStartX = ref(0)
const windowStartY = ref(0)
const showHistory = ref(false)
const isFullscreen = ref(false)
const screenshotHotkey = ref('Alt+S')
const history = ref<Array<{ id: string; timestamp: number; imageData: string; question: string; answer: string; messages?: Array<{ role: string; content: string; image?: string }> }>>([])
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
    const updated = favorites.value.map(f => 
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
  return favorites.value.filter(f => f.title.toLowerCase().includes(keyword))
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
      const newFavorites = favorites.value.filter(f => f.id !== currentFavoriteId.value)
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
  const lastUserMsg = messages.value.find(m => m.role === 'user')
  const lastAssistantMsg = messages.value.find(m => m.role === 'assistant')
  const lastImage = lastUserMsg?.image || store.currentImage
  
  if (currentFavoriteId.value) {
    const existingIndex = favorites.value.findIndex(f => f.id === currentFavoriteId.value)
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
  store.setFavorites(favorites.value.filter(f => f.id !== id))
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
  requestAnimationFrame(() => {
    if (panelContent.value) {
      panelContent.value.scrollTop = panelContent.value.scrollHeight
    }
  })
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

const sendMessage = async () => {
  if (!inputText.value.trim() || isLoading.value) return

  const userMessage = { role: 'user', content: inputText.value }
  messages.value.push(userMessage)
  messages.value.push({ role: 'assistant', content: '' })
  scrollToBottom()

  isLoading.value = true
  isStreaming.value = false
  const msgIndex = messages.value.length - 1

  try {
    const response = await store.sendToAI(inputText.value, messages.value, undefined, (token) => {
      isStreaming.value = true
      messages.value[msgIndex].content += token
      scrollToBottom()
    })
    if (response && !messages.value[msgIndex].content) {
      isStreaming.value = true
      const chars = response.split('')
      for (let i = 0; i < chars.length; i++) {
        messages.value[msgIndex].content += chars[i]
        scrollToBottom()
        await new Promise(r => setTimeout(r, 10))
      }
    }
    saveToHistory()
  } catch (error) {
    messages.value[msgIndex].content = '抱歉，AI 服务暂时不可用。'
    scrollToBottom()
  }

  inputText.value = ''
  isLoading.value = false
  isStreaming.value = false
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
    const newFavorites = favorites.value.filter(f => f.id !== currentFavoriteId.value)
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
  let formatted = text

  formatted = formatted.replace(/\|(.+)\|/g, (match) => {
    const cells = match.slice(1, -1).split('|')
    const isHeader = cells.some(cell => cell.trim().startsWith('---'))
    if (isHeader) return ''

    const row = cells.map(cell => `<td style="padding: 8px; border: 1px solid #3a3a5a;">${cell.trim()}</td>`).join('')
    return `<tr>${row}</tr>`
  })

  if (formatted.includes('<td')) {
    formatted = `<table style="border-collapse: collapse; margin: 10px 0; font-size: 13px;">${formatted}</table>`
  }

  formatted = formatted.replace(/\n/g, '<br>')

  return formatted
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
      const lastUserMsg = messages.value.find(m => m.role === 'user')
      const lastAssistantMsg = messages.value.find(m => m.role === 'assistant')
      const favToUpdate = favorites.value.find(f => f.id === currentFavoriteId.value)
      if (favToUpdate && lastUserMsg && lastAssistantMsg) {
        const updatedFavorite = {
          ...favToUpdate,
          timestamp: Date.now(),
          question: lastUserMsg.content || '',
          answer: lastAssistantMsg.content || '',
          messages: JSON.parse(JSON.stringify(messages.value))
        }
        const newFavorites = favorites.value.map(f => f.id === favToUpdate.id ? updatedFavorite : f)
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
  await loadHotkeyFromSettings()
  await loadFavorites()
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

    try {
      const response = await store.sendToAI(prompt, [], data.dataUrl, (token) => {
        isStreaming.value = true
        messages.value[msgIndex].content += token
        scrollToBottom()
      })
      if (response && !messages.value[msgIndex].content) {
        isStreaming.value = true
        const chars = response.split('')
        for (let i = 0; i < chars.length; i++) {
          messages.value[msgIndex].content += chars[i]
          scrollToBottom()
          await new Promise(r => setTimeout(r, 10))
        }
      }
      saveToHistory()
    } catch (error) {
      messages.value[msgIndex].content = '抱歉，AI 服务暂时不可用。'
      scrollToBottom()
    }

    isLoading.value = false
    isStreaming.value = false
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handlePanelKeyDown)
  window.removeEventListener('click', handleGlobalClick)
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
        <span class="title">AI截图</span>
      </div>
      <div class="header-actions">
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

    <div class="panel-content" ref="panelContent">
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
            <div class="message-content" v-if="msg.role === 'user'">
              <img v-if="msg.image" :src="msg.image" class="message-image" />
              <div v-if="msg.content" v-html="msg.content"></div>
            </div>
            <div class="message-content" v-else-if="!msg.content && isLoading">
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
            <div class="message-wrapper" v-else>
              <div class="message-content" v-html="formatText(msg.content)"></div>
              <button
                class="copy-btn"
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
      </template>
    </div>

    <div class="panel-input">
      <input
        v-model="inputText"
        type="text"
        placeholder="继续追问..."
        :disabled="isLoading || showHistory || showFavorites"
        @keyup.enter="sendMessage"
      />
      <button class="btn-favorite" @click="toggleFavorite" :disabled="showHistory || showFavorites" :title="isCurrentFavorited ? '取消收藏' : '收藏'">
        <img v-if="isCurrentFavorited" src="/favorited.png" alt="已收藏" />
        <img v-else src="/favorite.png" alt="收藏" />
      </button>
      <button @click="sendMessage" :disabled="isLoading || !inputText.trim() || showHistory || showFavorites">
        发送
      </button>
    </div>

    <div class="resize-handle top-right" @mousedown="startResize('top-right', $event)"></div>
    <div class="resize-handle bottom-right" @mousedown="startResize('bottom-right', $event)"></div>

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
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.logo svg {
  width: 100%;
  height: 100%;
}

.title {
  font-size: 14px;
  font-weight: 600;
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
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  color: #8a8aa8;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s, color 0.2s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.copy-btn.copied {
  color: #4ade80;
  opacity: 1;
}

.copy-icon {
  width: 15px;
  height: 15px;
}

.message-wrapper:hover .copy-btn {
  opacity: 1;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scrollbar-width: thin;
  scrollbar-color: #3a3a5a #1a1a2e;
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
}

.message {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.message.user {
  flex-direction: row-reverse;
}

.message-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  flex: 1;
  min-width: 0;
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
}

.message.assistant .message-avatar {
  background: #e94560;
}

.message-image {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 8px;
}

.message-content {
  max-width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

.message-content table {
  max-width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
  overflow-x: auto;
  display: block;
}

.message-content td {
  padding: 8px 12px;
  border: 1px solid #3a3a5a;
}

.message-content tr:first-child td {
  background: #2a2a4a;
}

.message.user .message-content {
  background: #e94560;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  background: #16213e;
  border-bottom-left-radius: 4px;
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
  gap: 8px;
  padding: 12px 16px;
  background: #16213e;
}

.panel-input input {
  flex: 1;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  padding: 10px 14px;
  color: #fff;
  font-size: 14px;
  outline: none;
}

.panel-input input:focus {
  border-color: #e94560;
}

.panel-input input:disabled {
  opacity: 0.5;
}

.panel-input button {
  background: #e94560;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.panel-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel-input button:hover:not(:disabled) {
  opacity: 0.9;
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
</style>

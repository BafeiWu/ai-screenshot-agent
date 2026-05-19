<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
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
const history = ref<Array<{ id: string; timestamp: number; imageData: string; question: string; answer: string }>>([])

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
      const record: ScreenshotRecord = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        imageData: store.currentImage || '',
        question: lastUserMsg.content,
        answer: lastAImsg.content
      }
      hist.push(record)
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

const clearChat = () => {
  messages.value = []
  store.setCurrentImage('')
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
  showHistory.value = !showHistory.value
  if (showHistory.value) {
    history.value = await window.electronAPI.getHistory() as ScreenshotRecord[]
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
  messages.value = [
    { role: 'user', content: item.question },
    { role: 'assistant', content: item.answer }
  ]
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
  await loadHotkeyFromSettings()
  window.electronAPI.onSettingsUpdated((s) => {
    if (s?.screenshotHotkey) screenshotHotkey.value = s.screenshotHotkey
  })
  window.electronAPI.onScreenshotTaken(async (data) => {
    store.setCurrentImage(data.dataUrl)
    messages.value = []
    isLoading.value = true
    isStreaming.value = false

    const prompt = data.customPrompt || '解析截图内容，回答截图相关问题，提取关键信息'
    const userQuestion = data.customPrompt ? data.customPrompt : '解析截图内容'

    messages.value.push({ role: 'user', content: userQuestion })
    messages.value.push({ role: 'assistant', content: '' })
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
        <button class="btn-icon" @click="clearChat" title="清空当前对话">
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

      <template v-else>
        <div v-if="store.currentImage" class="image-preview">
          <img :src="store.currentImage" alt="截图预览" />
        </div>

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
            <div class="message-content" v-if="msg.role === 'user'" v-html="msg.content">
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
        :disabled="isLoading || showHistory"
        @keyup.enter="sendMessage"
      />
      <button @click="sendMessage" :disabled="isLoading || !inputText.trim() || showHistory">
        发送
      </button>
    </div>

    <div class="resize-handle top-right" @mousedown="startResize('top-right', $event)"></div>
    <div class="resize-handle bottom-right" @mousedown="startResize('bottom-right', $event)"></div>
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

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.btn-icon.active {
  background: #e94560;
  color: #fff;
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
}

.history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-info {
  flex: 1;
  min-width: 0;
}

.history-question {
  font-size: 13px;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
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
</style>

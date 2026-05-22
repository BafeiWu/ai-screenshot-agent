<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Settings {
  screenshotHotkey: string
  fullscreenHotkey: string
  windowHotkey: string
  panelHotkey: string
  autoStart: boolean
  panelOpacity: number
}

interface AiProfile {
  id: string
  title: string
  apiKey: string
  apiModel: string
  apiBaseUrl: string
}

const settings = ref<Settings>({
  screenshotHotkey: 'Alt+S',
  fullscreenHotkey: 'CommandOrControl+Alt+F',
  windowHotkey: 'CommandOrControl+Alt+W',
  panelHotkey: 'CommandOrControl+Alt+P',
  autoStart: false,
  panelOpacity: 0.95
})

const aiProfiles = ref<AiProfile[]>([])
const activeProfileId = ref<string>('')
type AiView = 'default' | 'list' | 'form'
const aiView = ref<AiView>('default')
const editingProfileId = ref<string | null>(null)
const formTitle = ref('')
const formApiKey = ref('')
const formApiModel = ref('')
const formApiBaseUrl = ref('')
const formError = ref('')

const isRecording = ref<string | null>(null)
const recordingKey = ref('')
const saveStatus = ref('')
const currentVersion = ref('')
const updateStatus = ref('')
const latestVersion = ref('')
const isDownloading = ref(false)
const downloadProgress = ref(0)
const downloadSpeed = ref('')

const activeProfile = computed(() =>
  aiProfiles.value.find((p: AiProfile) => p.id === activeProfileId.value) || null
)

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

const genId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const persistAiProfiles = async () => {
  await window.electronAPI.saveAiProfiles({
    profiles: JSON.parse(JSON.stringify(aiProfiles.value)),
    activeId: activeProfileId.value
  })
}

const openNewProfile = () => {
  editingProfileId.value = null
  formTitle.value = ''
  formApiKey.value = ''
  formApiModel.value = ''
  formApiBaseUrl.value = ''
  formError.value = ''
  aiView.value = 'form'
}

const openEditProfile = (id: string) => {
  const p = aiProfiles.value.find((x: AiProfile) => x.id === id)
  if (!p) return
  editingProfileId.value = id
  formTitle.value = p.title
  formApiKey.value = ''
  formApiModel.value = p.apiModel
  formApiBaseUrl.value = p.apiBaseUrl
  formError.value = ''
  aiView.value = 'form'
}

const cancelForm = () => {
  formError.value = ''
  aiView.value = aiProfiles.value.length > 0 ? 'list' : 'default'
}

const submitForm = async () => {
  const title = formTitle.value.trim()
  const model = formApiModel.value.trim()
  const baseUrl = formApiBaseUrl.value.trim()
  const key = formApiKey.value
  if (!title || !model || !baseUrl) {
    formError.value = '标题、模型、API 地址不能为空'
    return
  }

  if (editingProfileId.value) {
    const p = aiProfiles.value.find((x: AiProfile) => x.id === editingProfileId.value)
    if (p) {
      p.title = title
      p.apiModel = model
      p.apiBaseUrl = baseUrl
      if (key) p.apiKey = key
    }
  } else {
    if (!key) {
      formError.value = 'API Key 不能为空'
      return
    }
    const profile: AiProfile = {
      id: genId(),
      title,
      apiKey: key,
      apiModel: model,
      apiBaseUrl: baseUrl
    }
    aiProfiles.value.push(profile)
    if (!activeProfileId.value) activeProfileId.value = profile.id
  }

  await persistAiProfiles()
  aiView.value = 'list'
}

const selectProfile = async (id: string) => {
  activeProfileId.value = id
  await persistAiProfiles()
}

const deleteProfile = async (id: string) => {
  const idx = aiProfiles.value.findIndex((x: AiProfile) => x.id === id)
  if (idx < 0) return
  aiProfiles.value.splice(idx, 1)
  if (activeProfileId.value === id) {
    activeProfileId.value = aiProfiles.value[0]?.id || ''
  }
  await persistAiProfiles()
  if (aiProfiles.value.length === 0) aiView.value = 'default'
}

const openManageList = () => {
  aiView.value = 'list'
}

const finishList = () => {
  aiView.value = 'default'
}

onMounted(async () => {
  window.addEventListener('keydown', handleEscKey)

  try {
    currentVersion.value = await window.electronAPI.getVersion()
  } catch (e) {
    currentVersion.value = '1.0.0'
  }

  window.electronAPI.onDownloadProgress((progress) => {
    downloadProgress.value = Math.round(progress.percent || 0)
    downloadSpeed.value = `${formatBytes(progress.bytesPerSecond)}/s`
    updateStatus.value = `下载中 ${downloadProgress.value}% (${formatBytes(progress.transferred)}/${formatBytes(progress.total)})`
  })

  window.electronAPI.onUpdateDownloaded((info) => {
    updateStatus.value = `新版本 ${info.version} 已下载，点击安装`
    isDownloading.value = false
    downloadProgress.value = 100
  })

  window.electronAPI.onUpdateError((message) => {
    updateStatus.value = '更新失败: ' + message
    isDownloading.value = false
    downloadProgress.value = 0
  })

  try {
    const savedSettings = await window.electronAPI.getSettings()
    if (savedSettings) {
      settings.value = {
        screenshotHotkey: savedSettings.screenshotHotkey ?? settings.value.screenshotHotkey,
        fullscreenHotkey: savedSettings.fullscreenHotkey ?? settings.value.fullscreenHotkey,
        windowHotkey: savedSettings.windowHotkey ?? settings.value.windowHotkey,
        panelHotkey: savedSettings.panelHotkey ?? settings.value.panelHotkey,
        autoStart: savedSettings.autoStart ?? settings.value.autoStart,
        panelOpacity: savedSettings.panelOpacity ?? settings.value.panelOpacity
      }
    }
    const ai = await window.electronAPI.getAiProfiles()
    aiProfiles.value = ai.profiles || []
    activeProfileId.value = ai.activeId || (aiProfiles.value[0]?.id ?? '')
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
})

const checkForUpdates = async () => {
  updateStatus.value = '检查更新...'
  try {
    const result = await window.electronAPI.checkForUpdates()
    if (result.updateAvailable) {
      latestVersion.value = result.version
      updateStatus.value = `发现新版本 ${result.version}，点击下载`
    } else {
      updateStatus.value = '已是最新版本'
      setTimeout(() => {
        updateStatus.value = ''
      }, 3000)
    }
  } catch (e) {
    updateStatus.value = '检查更新失败'
    setTimeout(() => {
      updateStatus.value = ''
    }, 3000)
  }
}

const downloadUpdate = async () => {
  if (latestVersion.value && !isDownloading.value) {
    isDownloading.value = true
    updateStatus.value = '下载中...'
    try {
      const result = await window.electronAPI.downloadUpdate()
      if (!result.success) {
        updateStatus.value = '下载失败: ' + result.error
        isDownloading.value = false
      }
    } catch (e) {
      updateStatus.value = '下载失败'
      isDownloading.value = false
    }
  }
}

const installUpdate = () => {
  window.electronAPI.installUpdate()
}

const updateBtnLabel = computed(() => {
  if (isDownloading.value) return `下载中 ${downloadProgress.value}%`
  if (updateStatus.value.includes('已下载')) return '立即安装'
  if (updateStatus.value.includes('失败')) return '重试'
  if (updateStatus.value.includes('点击下载')) return '下载'
  return '检查更新'
})

const handleUpdateClick = () => {
  if (isDownloading.value) return
  if (updateStatus.value.includes('已下载')) {
    installUpdate()
  } else if (updateStatus.value.includes('失败')) {
    if (latestVersion.value) {
      downloadUpdate()
    } else {
      checkForUpdates()
    }
  } else if (latestVersion.value && updateStatus.value.includes('点击下载')) {
    downloadUpdate()
  } else {
    checkForUpdates()
  }
}

const handleSave = async () => {
  try {
    saveStatus.value = '保存中...'
    const plainSettings = JSON.parse(JSON.stringify(settings.value))
    const result = await window.electronAPI.saveSettings(plainSettings) as any

    if (result && typeof result === 'object' && 'success' in result) {
      if (result.success) {
        saveStatus.value = '保存成功!'
        setTimeout(() => {
          window.electronAPI.closeSettings()
        }, 150)
      } else {
        saveStatus.value = '保存失败: ' + (result.error || '未知错误')
      }
    } else {
      saveStatus.value = '保存成功!'
      setTimeout(() => {
        window.electronAPI.closeSettings()
      }, 150)
    }
  } catch (error) {
    saveStatus.value = '保存失败: ' + String(error)
    console.error('Save error:', error)
  }
}

const startRecording = (hotkeyType: string) => {
  isRecording.value = hotkeyType
  recordingKey.value = ''
}

const handleKeyDown = (e: KeyboardEvent) => {
  if (!isRecording.value) return
  e.preventDefault()
  e.stopPropagation()

  const keys: string[] = []
  if (e.ctrlKey) keys.push('CommandOrControl')
  if (e.altKey) keys.push('Alt')
  if (e.shiftKey) keys.push('Shift')
  if (e.metaKey) keys.push('Meta')

  const key = e.key.toUpperCase()
  if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) {
    keys.push(key)
  }

  recordingKey.value = keys.join('+')
}

const finishRecording = () => {
  if (!recordingKey.value) return

  switch (isRecording.value) {
    case 'screenshot':
      settings.value.screenshotHotkey = recordingKey.value
      break
    case 'fullscreen':
      settings.value.fullscreenHotkey = recordingKey.value
      break
    case 'window':
      settings.value.windowHotkey = recordingKey.value
      break
    case 'panel':
      settings.value.panelHotkey = recordingKey.value
      break
  }

  isRecording.value = null
  recordingKey.value = ''
}

const closeWindow = () => {
  window.electronAPI.closeSettings()
}

const handleEscKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeWindow()
  }
}

onUnmounted(() => {
  window.removeEventListener('keydown', handleEscKey)
})
</script>

<template>
  <div class="settings-window">
    <div class="settings-header" @mousedown="() => {}">
      <span class="header-title">设置</span>
      <button class="close-btn" @click="closeWindow">✕</button>
    </div>

    <div class="settings-content">
      <div class="section">
        <div class="section-title">快捷键设置</div>

        <div class="setting-row">
          <span class="setting-label">区域截图</span>
          <div class="hotkey-control">
            <input
              type="text"
              :value="isRecording === 'screenshot' ? recordingKey : settings.screenshotHotkey"
              readonly
              @keydown="handleKeyDown"
              @keyup="finishRecording"
            />
            <button v-if="isRecording !== 'screenshot'" @click="startRecording('screenshot')">设置</button>
            <span v-else class="recording">按下快捷键...</span>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">全屏截图</span>
          <div class="hotkey-control">
            <input
              type="text"
              :value="isRecording === 'fullscreen' ? recordingKey : settings.fullscreenHotkey"
              readonly
              @keydown="handleKeyDown"
              @keyup="finishRecording"
            />
            <button v-if="isRecording !== 'fullscreen'" @click="startRecording('fullscreen')">设置</button>
            <span v-else class="recording">按下快捷键...</span>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">窗口截图</span>
          <div class="hotkey-control">
            <input
              type="text"
              :value="isRecording === 'window' ? recordingKey : settings.windowHotkey"
              readonly
              @keydown="handleKeyDown"
              @keyup="finishRecording"
            />
            <button v-if="isRecording !== 'window'" @click="startRecording('window')">设置</button>
            <span v-else class="recording">按下快捷键...</span>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">调出面板</span>
          <div class="hotkey-control">
            <input
              type="text"
              :value="isRecording === 'panel' ? recordingKey : settings.panelHotkey"
              readonly
              @keydown="handleKeyDown"
              @keyup="finishRecording"
            />
            <button v-if="isRecording !== 'panel'" @click="startRecording('panel')">设置</button>
            <span v-else class="recording">按下快捷键...</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">AI 设置</div>

        <template v-if="aiView === 'default'">
          <div v-if="activeProfile" class="ai-active-row">
            <div class="ai-active-info">
              <div class="ai-active-title">{{ activeProfile.title }}</div>
              <div class="ai-active-model">{{ activeProfile.apiModel }}</div>
            </div>
            <button class="ghost-btn" @click="openManageList">切换 / 管理</button>
          </div>
          <button v-else class="primary-btn full" @click="openNewProfile">新建模型库</button>
        </template>

        <template v-else-if="aiView === 'list'">
          <div class="ai-list-header">
            <span class="ai-list-tip">点选要使用的模型</span>
            <button class="ghost-btn small" @click="openNewProfile">+ 新建</button>
          </div>
          <div class="ai-list">
            <div
              v-for="p in aiProfiles"
              :key="p.id"
              class="ai-list-row"
              :class="{ active: p.id === activeProfileId }"
              @click="selectProfile(p.id)"
            >
              <span class="radio-dot" :class="{ checked: p.id === activeProfileId }"></span>
              <div class="ai-row-info">
                <div class="ai-row-title">{{ p.title }}</div>
                <div class="ai-row-model">{{ p.apiModel }}</div>
              </div>
              <button class="row-btn" @click.stop="openEditProfile(p.id)">编辑</button>
              <button class="row-btn danger" @click.stop="deleteProfile(p.id)">删除</button>
            </div>
            <div v-if="aiProfiles.length === 0" class="ai-empty">暂无模型，点击"+ 新建"开始</div>
          </div>
          <div class="ai-list-footer">
            <button class="ghost-btn small" @click="finishList">完成</button>
          </div>
        </template>

        <template v-else-if="aiView === 'form'">
          <div class="setting-row vertical">
            <span class="setting-label">标题</span>
            <input
              type="text"
              v-model="formTitle"
              placeholder="例如: 豆包视觉、Claude Sonnet"
              class="full-input"
            />
          </div>
          <div class="setting-row vertical">
            <span class="setting-label">API Key</span>
            <input
              type="password"
              v-model="formApiKey"
              :placeholder="editingProfileId ? '••••已保存（留空保持不变）' : '输入 API Key'"
              class="full-input"
            />
          </div>
          <div class="setting-row vertical">
            <span class="setting-label">模型</span>
            <input
              type="text"
              v-model="formApiModel"
              placeholder="例如: doubao-vision-pro"
              class="full-input"
            />
          </div>
          <div class="setting-row vertical">
            <span class="setting-label">API 地址</span>
            <input
              type="text"
              v-model="formApiBaseUrl"
              placeholder="例如: https://ark.cn-beijing.volces.com/api/v3"
              class="full-input"
            />
          </div>
          <div v-if="formError" class="form-error">{{ formError }}</div>
          <div class="form-actions">
            <button class="ghost-btn small" @click="cancelForm">取消</button>
            <button class="primary-btn small" @click="submitForm">保存</button>
          </div>
        </template>
      </div>

      <div class="section">
        <div class="section-title">面板设置</div>
        <div class="setting-row">
          <span class="setting-label">透明度</span>
          <div class="slider-control">
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              v-model.number="settings.panelOpacity"
            />
            <span class="slider-value">{{ Math.round(settings.panelOpacity * 100) }}%</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">系统</div>
        <div class="setting-row checkbox-row">
          <label class="checkbox-label">
            <input type="checkbox" v-model="settings.autoStart" />
            <span>开机自动启动</span>
          </label>
        </div>
      </div>
    </div>

    <div class="settings-footer">
      <span v-if="saveStatus" class="save-status">{{ saveStatus }}</span>
      <div class="version-info">
        <span class="version-text">v{{ currentVersion }}</span>
        <button
          class="update-btn"
          :class="{ 'update-btn-primary': updateStatus.includes('已下载'), 'update-btn-error': updateStatus.includes('失败') }"
          @click="handleUpdateClick"
          :disabled="isDownloading"
        >
          {{ updateBtnLabel }}
        </button>
        <div v-if="isDownloading" class="progress-wrap">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
          </div>
          <span class="progress-text">{{ downloadProgress }}% · {{ downloadSpeed }}</span>
        </div>
        <span v-else-if="updateStatus" class="update-status" :class="{ clickable: updateStatus.includes('点击') || updateStatus.includes('已下载'), error: updateStatus.includes('失败') }">{{ updateStatus }}</span>
      </div>
      <button class="save-btn" @click="handleSave">保存</button>
    </div>
  </div>
</template>

<style scoped>
.settings-window {
  width: 100%;
  height: 100vh;
  background: #17213d;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 8px;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: #16213e;
  -webkit-app-region: drag;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.close-btn {
  background: transparent;
  border: none;
  color: #888;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  -webkit-app-region: no-drag;
}

.close-btn:hover {
  background: #e94560;
  color: #fff;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.settings-content::-webkit-scrollbar {
  width: 1px;
}

.settings-content::-webkit-scrollbar-track {
  background: transparent;
}

.settings-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #e94560;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #2a2a4a;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.setting-row.vertical {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.setting-label {
  font-size: 13px;
  color: #ccc;
  flex-shrink: 0;
}

.hotkey-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hotkey-control input {
  width: 140px;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  padding: 8px 10px;
  color: #fff;
  font-size: 12px;
  text-align: center;
}

.hotkey-control input:focus {
  border-color: #e94560;
  outline: none;
}

.hotkey-control button {
  background: #2a2a4a;
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.hotkey-control button:hover {
  background: #3a3a5a;
}

.recording {
  font-size: 11px;
  color: #e94560;
  min-width: 80px;
}

.full-input {
  width: 200px;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  padding: 8px 10px;
  color: #fff;
  font-size: 12px;
}

.full-input:focus {
  border-color: #e94560;
  outline: none;
}

.ai-active-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid transparent;
  background:
    linear-gradient(#1f2849, #1f2849) padding-box,
    linear-gradient(135deg, #ff6b8b, #e94560 45%, #a855f7 100%) border-box;
  border-radius: 6px;
  padding: 10px 12px;
  gap: 10px;
}

.ai-active-info {
  min-width: 0;
  flex: 1;
}

.ai-active-title {
  font-size: 13px;
  color: #fff;
  font-weight: 500;
}

.ai-active-model {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
  word-break: break-all;
}

.ai-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ai-list-tip {
  font-size: 11px;
  color: #888;
}

.ai-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.ai-list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #1f2849;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.ai-list-row:hover {
  border-color: #3a3a5a;
}

.ai-list-row.active {
  border-color: #e94560;
}

.radio-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid #555;
  flex-shrink: 0;
  position: relative;
}

.radio-dot.checked {
  border-color: #e94560;
}

.radio-dot.checked::after {
  content: '';
  position: absolute;
  inset: 2px;
  background: #e94560;
  border-radius: 50%;
}

.ai-row-info {
  flex: 1;
  min-width: 0;
}

.ai-row-title {
  font-size: 12px;
  color: #fff;
}

.ai-row-model {
  font-size: 10px;
  color: #888;
  margin-top: 2px;
  word-break: break-all;
}

.row-btn {
  background: transparent;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  color: #ccc;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
}

.row-btn:hover {
  border-color: #e94560;
  color: #e94560;
}

.row-btn.danger:hover {
  border-color: #f87171;
  color: #f87171;
}

.ai-empty {
  text-align: center;
  font-size: 11px;
  color: #666;
  padding: 16px 0;
}

.ai-list-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.form-error {
  font-size: 11px;
  color: #f87171;
  margin-top: 4px;
}

.ghost-btn {
  background: transparent;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  color: #ccc;
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
}

.ghost-btn:hover {
  border-color: #e94560;
  color: #e94560;
}

.ghost-btn.small {
  padding: 5px 10px;
  font-size: 11px;
}

.primary-btn {
  background: #e94560;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  padding: 8px 16px;
  cursor: pointer;
}

.primary-btn:hover {
  opacity: 0.9;
}

.primary-btn.full {
  width: 100%;
  padding: 10px;
}

.primary-btn.small {
  padding: 5px 12px;
  font-size: 11px;
}

.full-input {
  width: 100%;
  box-sizing: border-box;
}

.slider-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slider-control input[type="range"] {
  width: 150px;
  accent-color: #e94560;
}

.slider-value {
  font-size: 12px;
  color: #888;
  min-width: 40px;
  text-align: right;
}

.checkbox-row {
  justify-content: flex-start;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #e94560;
}

.checkbox-label span {
  font-size: 13px;
  color: #ccc;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #16213e;
}

.save-status {
  font-size: 12px;
  color: #4ade80;
}

.save-btn {
  background: #e94560;
  border: none;
  border-radius: 6px;
  padding: 10px 24px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.save-btn:hover {
  opacity: 0.9;
}

.version-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.version-text {
  font-size: 12px;
  color: #888;
}

.update-btn {
  background: transparent;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  padding: 6px 12px;
  color: #888;
  font-size: 11px;
  cursor: pointer;
}

.update-btn:hover {
  border-color: #e94560;
  color: #e94560;
}

.update-status {
  font-size: 11px;
  color: #4ade80;
}

.update-status.clickable {
  color: #e94560;
  cursor: pointer;
  text-decoration: underline;
}

.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 140px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #2a2a4a;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #e94560, #f47b8e);
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 11px;
  color: #ccc;
  white-space: nowrap;
}

.update-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.update-btn-primary {
  background: #4ade80;
  border-color: #4ade80;
  color: #0f0f1a;
  font-weight: 600;
}

.update-btn-primary:hover {
  background: #22c55e;
  border-color: #22c55e;
  color: #0f0f1a;
}

.update-btn-error {
  border-color: #f87171;
  color: #f87171;
}

.update-btn-error:hover {
  background: #f87171;
  color: #0f0f1a;
}

.update-status.error {
  color: #f87171;
}
</style>

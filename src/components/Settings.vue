<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useScreenshotStore } from '../store/screenshot'

interface Settings {
  screenshotHotkey: string
  fullscreenHotkey: string
  windowHotkey: string
  autoStart: boolean
  panelOpacity: number
  apiModel: string
  apiBaseUrl: string
}

const store = useScreenshotStore()
const settings = ref<Settings>({
  screenshotHotkey: 'Alt+S',
  fullscreenHotkey: 'CommandOrControl+Alt+F',
  windowHotkey: 'CommandOrControl+Alt+W',
  autoStart: false,
  panelOpacity: 0.95,
  apiModel: 'doubao-vision-pro',
  apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
})
const apiKey = ref('')
const isRecording = ref<string | null>(null)
const recordingKey = ref('')
const saveStatus = ref('')
const currentVersion = ref('')
const updateStatus = ref('')
const latestVersion = ref('')
const isDownloading = ref(false)
const downloadProgress = ref('')

onMounted(async () => {
  try {
    currentVersion.value = await window.electronAPI.getVersion()
  } catch (e) {
    currentVersion.value = '1.0.0'
  }

  window.electronAPI.onUpdateDownloaded((info) => {
    updateStatus.value = `新版本 ${info.version} 已下载，点击安装`
    isDownloading.value = false
  })
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

const handleUpdateClick = () => {
  if (latestVersion.value && !isDownloading.value) {
    if (updateStatus.value.includes('点击下载')) {
      downloadUpdate()
    } else if (updateStatus.value.includes('已下载')) {
      installUpdate()
    }
  } else if (!updateStatus.value.includes('下载中')) {
    checkForUpdates()
  }
}

const handleSave = async () => {
  try {
    saveStatus.value = '保存中...'
    const plainSettings = JSON.parse(JSON.stringify(settings.value))
    if (apiKey.value) {
      plainSettings.apiKey = apiKey.value
    }
    const result = await window.electronAPI.saveSettings(plainSettings)
    console.log('Save result:', result)
    if (result && typeof result === 'object' && 'success' in result) {
      if (result.success) {
        saveStatus.value = '保存成功!'
        setTimeout(() => {
          window.electronAPI.closeSettings()
        }, 500)
      } else {
        saveStatus.value = '保存失败: ' + (result.error || '未知错误')
      }
    } else if (result === true) {
      saveStatus.value = '保存成功!'
      setTimeout(() => {
        window.electronAPI.closeSettings()
      }, 500)
    } else {
      saveStatus.value = '保存成功!'
      setTimeout(() => {
        window.electronAPI.closeSettings()
      }, 500)
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
  if (e.alt) keys.push('Alt')
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
  }

  isRecording.value = null
  recordingKey.value = ''
}

const closeWindow = () => {
  window.electronAPI.closeSettings()
}

onMounted(async () => {
  try {
    const savedSettings = await window.electronAPI.getSettings()
    if (savedSettings) {
      settings.value = savedSettings
    }
    apiKey.value = localStorage.getItem('doubao_api_key') || ''
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
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
      </div>

      <div class="section">
        <div class="section-title">AI 设置</div>
        <div class="setting-row vertical">
          <span class="setting-label">API Key</span>
          <input
            type="password"
            v-model="apiKey"
            placeholder="输入 API Key"
            class="full-input"
          />
        </div>
        <div class="setting-row vertical">
          <span class="setting-label">模型</span>
          <input
            type="text"
            v-model="settings.apiModel"
            placeholder="例如: doubao-vision-pro"
            class="full-input"
          />
        </div>
        <div class="setting-row vertical">
          <span class="setting-label">API 地址</span>
          <input
            type="text"
            v-model="settings.apiBaseUrl"
            placeholder="例如: https://ark.cn-beijing.volces.com/api/v3"
            class="full-input"
          />
        </div>
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
        <button class="update-btn" @click="handleUpdateClick">{{ updateStatus.includes('下载') || updateStatus.includes('安装') || updateStatus.includes('下载中') ? '更新' : '检查更新' }}</button>
        <span v-if="updateStatus" class="update-status" :class="{ clickable: updateStatus.includes('点击') }">{{ updateStatus }}</span>
      </div>
      <button class="save-btn" @click="handleSave">保存</button>
    </div>
  </div>
</template>

<style scoped>
.settings-window {
  width: 100%;
  height: 100vh;
  background: #1a1a2e;
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
  background: #0f0f1a;
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
  background: #0f0f1a;
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
</style>

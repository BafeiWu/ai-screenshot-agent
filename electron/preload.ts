import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenshot: (type: 'region' | 'fullscreen' | 'window') =>
    ipcRenderer.invoke('get-screenshot', type),

  sendToPanel: (data: any) =>
    ipcRenderer.invoke('send-to-panel', data),

  hidePanel: () =>
    ipcRenderer.invoke('hide-panel'),

  minimizePanel: () =>
    ipcRenderer.invoke('minimize-panel'),

  resizePanel: (width: number, height: number) =>
    ipcRenderer.invoke('resize-panel', width, height),

  showPanel: () =>
    ipcRenderer.invoke('show-panel'),

  getSettings: () =>
    ipcRenderer.invoke('get-settings'),

  saveSettings: (settings: any) =>
    ipcRenderer.invoke('save-settings', settings),

  getHistory: () =>
    ipcRenderer.invoke('get-history'),

  saveHistory: (history: any[]) =>
    ipcRenderer.invoke('save-history', history),

  openSettings: () =>
    ipcRenderer.invoke('open-settings'),

  closeSettings: () =>
    ipcRenderer.invoke('close-settings'),

  toggleFullscreen: () =>
    ipcRenderer.invoke('toggle-fullscreen'),

  closeScreenshot: () =>
    ipcRenderer.invoke('close-screenshot'),

  screenshotCropped: (croppedImageData: string, customPrompt?: string) =>
    ipcRenderer.invoke('screenshot-cropped', croppedImageData, customPrompt),

  exitScreenshot: () =>
    ipcRenderer.invoke('exit-screenshot'),

  writeClipboardText: (text: string) =>
    ipcRenderer.invoke('write-clipboard-text', text),

  pinScreenshot: (imageData: string) =>
    ipcRenderer.invoke('pin-screenshot', imageData),

  getPinnedImage: () =>
    ipcRenderer.invoke('get-pinned-image'),

  closePinnedWindow: () =>
    ipcRenderer.invoke('close-pinned-window'),

  resizePinnedWindow: (width: number, height: number) =>
    ipcRenderer.invoke('resize-pinned-window', width, height),

  movePinnedWindow: (x: number, y: number) =>
    ipcRenderer.invoke('move-pinned-window', x, y),

  getPinnedBounds: () =>
    ipcRenderer.invoke('get-pinned-bounds'),

  movePinnedBy: (dx: number, dy: number) =>
    ipcRenderer.invoke('move-pinned-by', dx, dy),

  pinnedDragStart: () =>
    ipcRenderer.invoke('pinned-drag-start'),

  pinnedDragEnd: () =>
    ipcRenderer.invoke('pinned-drag-end'),

  setPinnedBounds: (x: number, y: number, width: number, height: number) =>
    ipcRenderer.invoke('set-pinned-bounds', x, y, width, height),

  openSettingsFromScreenshot: () =>
    ipcRenderer.invoke('open-settings-from-screenshot'),

  movePanel: (x: number, y: number) =>
    ipcRenderer.invoke('move-panel', x, y),

  getPanelPosition: () =>
    ipcRenderer.invoke('get-panel-position'),

  getApiKey: () =>
    ipcRenderer.invoke('get-api-key'),

  getPendingScreenshot: () =>
    ipcRenderer.invoke('get-pending-screenshot'),

  getVersion: () =>
    ipcRenderer.invoke('get-version'),

  checkForUpdates: () =>
    ipcRenderer.invoke('check-for-updates'),

  downloadUpdate: () =>
    ipcRenderer.invoke('download-update'),

  installUpdate: () =>
    ipcRenderer.invoke('install-update'),

  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update-available', (_, info) => callback(info))
  },

  onUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.on('update-downloaded', (_, info) => callback(info))
  },

  onDownloadProgress: (callback: (progress: { percent: number, bytesPerSecond: number, transferred: number, total: number }) => void) => {
    ipcRenderer.on('download-progress', (_, progress) => callback(progress))
  },

  onUpdateError: (callback: (message: string) => void) => {
    ipcRenderer.on('update-error', (_, message) => callback(message))
  },

  onScreenshotTaken: (callback: (data: { type: string, dataUrl: string, customPrompt?: string }) => void) => {
    ipcRenderer.on('screenshot-taken', (_, data) => callback(data))
  },

  onAIResponse: (callback: (data: any) => void) => {
    ipcRenderer.on('ai-response', (_, data) => callback(data))
  },

  onSettingsUpdated: (callback: (settings: any) => void) => {
    ipcRenderer.on('settings-updated', (_, settings) => callback(settings))
  },

  getFavorites: () =>
    ipcRenderer.invoke('get-favorites'),

  saveFavorites: (favorites: any[]) =>
    ipcRenderer.invoke('save-favorites', favorites)
})

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

  getAiProfiles: () =>
    ipcRenderer.invoke('get-ai-profiles'),

  saveAiProfiles: (payload: { profiles: any[]; activeId: string }) =>
    ipcRenderer.invoke('save-ai-profiles', payload),

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
    ipcRenderer.invoke('save-favorites', favorites),

  aiStreamRequest: (payload: { requestId: string; endpoint: string; apiKey: string; body: any; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('ai-stream-request', payload),

  aiStreamAbort: (requestId: string) =>
    ipcRenderer.invoke('ai-stream-abort', requestId),

  onAiStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on('ai-stream-chunk', listener)
    return () => ipcRenderer.removeListener('ai-stream-chunk', listener)
  },

  onAiStreamError: (callback: (data: { requestId: string; message: string; aborted?: boolean }) => void) => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on('ai-stream-error', listener)
    return () => ipcRenderer.removeListener('ai-stream-error', listener)
  },

  onAiStreamDone: (callback: (data: { requestId: string }) => void) => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on('ai-stream-done', listener)
    return () => ipcRenderer.removeListener('ai-stream-done', listener)
  },

  agentGetAllowedDirs: () =>
    ipcRenderer.invoke('agent-get-allowed-dirs'),

  agentSetAllowedDirs: (dirs: string[]) =>
    ipcRenderer.invoke('agent-set-allowed-dirs', dirs),

  agentPickDirectory: () =>
    ipcRenderer.invoke('agent-pick-directory'),

  agentReadFile: (args: { path: string }) =>
    ipcRenderer.invoke('agent-tool-read-file', args),

  agentListDir: (args: { path: string }) =>
    ipcRenderer.invoke('agent-tool-list-dir', args),

  agentSearchFiles: (args: { path: string; pattern: string; contentMatch?: string }) =>
    ipcRenderer.invoke('agent-tool-search-files', args),

  agentFetchUrl: (args: { url: string }) =>
    ipcRenderer.invoke('agent-tool-fetch-url', args),

  agentExtractLinks: (args: { url: string }) =>
    ipcRenderer.invoke('agent-tool-extract-links', args),

  agentDownloadUrl: (args: { url: string; path: string }) =>
    ipcRenderer.invoke('agent-tool-download-url', args),

  agentWriteFile: (args: { path: string; content: string }) =>
    ipcRenderer.invoke('agent-tool-write-file', args),

  agentMoveFile: (args: { from: string; to: string }) =>
    ipcRenderer.invoke('agent-tool-move-file', args),

  agentDeleteFile: (args: { path: string }) =>
    ipcRenderer.invoke('agent-tool-delete-file', args)
})

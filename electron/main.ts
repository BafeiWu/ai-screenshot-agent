import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, desktopCapturer, dialog, Notification, clipboard } from 'electron'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

log.transports.file.level = 'info'
autoUpdater.logger = log
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function isNewerVersion(remote: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const r = parse(remote)
  const c = parse(current)
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const a = r[i] || 0
    const b = c[i] || 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

function migrateLegacyUserData() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'AI截图')
    const newDir = app.getPath('userData')
    const flagFile = path.join(newDir, '.migrated-from-legacy')

    if (!fs.existsSync(oldDir)) return
    if (fs.existsSync(flagFile)) return
    if (fs.existsSync(path.join(newDir, 'config.json'))) return

    fs.mkdirSync(newDir, { recursive: true })
    fs.cpSync(oldDir, newDir, { recursive: true, force: false, errorOnExist: false })
    fs.writeFileSync(flagFile, new Date().toISOString())
    log.info(`Migrated user data from ${oldDir} to ${newDir}`)
  } catch (err) {
    log.error('Legacy data migration failed:', err)
  }
}

migrateLegacyUserData()

const store = new Store()

interface AiProfile {
  id: string
  title: string
  apiKey: string
  apiModel: string
  apiBaseUrl: string
}

function migrateLegacyAiProfile() {
  const profiles = store.get('aiProfiles', null) as AiProfile[] | null
  if (Array.isArray(profiles) && profiles.length > 0) return

  const legacyKey = store.get('apiKey', '') as string
  const legacyModel = store.get('apiModel', '') as string
  const legacyBase = store.get('apiBaseUrl', '') as string
  if (!legacyKey && !legacyModel && !legacyBase) {
    store.set('aiProfiles', [])
    return
  }

  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const profile: AiProfile = {
    id,
    title: '默认',
    apiKey: legacyKey,
    apiModel: legacyModel || 'doubao-vision-pro',
    apiBaseUrl: legacyBase || 'https://ark.cn-beijing.volces.com/api/v3'
  }
  store.set('aiProfiles', [profile])
  store.set('activeAiProfileId', id)
}

migrateLegacyAiProfile()

let mainWindow: BrowserWindow | null = null
let panelWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let screenshotWindow: BrowserWindow | null = null
let pendingScreenshotImage: string = ''
const pinnedWindows = new Set<BrowserWindow>()
const pinnedWindowImages = new WeakMap<BrowserWindow, string>()
const pinnedDragLock = new WeakMap<BrowserWindow, { width: number; height: number }>()
let tray: Tray | null = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function getAssetPath(...paths: string[]): string {
  const basePath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, '..')
    : process.resourcesPath
  return path.join(basePath, ...paths)
}

function parsePngDimensions(dataUrl: string): { width: number; height: number } | null {
  try {
    const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i)
    if (!m) return null
    const buf = Buffer.from(m[2], 'base64')
    if (m[1].toLowerCase() === 'png' && buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      if (width > 0 && height > 0) return { width, height }
    }
    const img = nativeImage.createFromBuffer(buf)
    const size = img.getSize()
    if (size.width > 0 && size.height > 0) return size
    return null
  } catch {
    return null
  }
}

function getAppIcon(): nativeImage {
  const candidatePaths = VITE_DEV_SERVER_URL
    ? [
        path.join(__dirname, '..', 'icon.ico'),
        path.join(__dirname, '..', 'icon.png')
      ]
    : [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'icon.png'),
        path.join(__dirname, '..', 'icon.ico'),
        path.join(__dirname, '..', 'icon.png')
      ]
  for (const p of candidatePaths) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) {
      console.log('Icon loaded from:', p)
      return img
    }
  }
  console.error('No icon found in any path')
  return nativeImage.createEmpty()
}

const appIcon = nativeImage.createEmpty()

function createMainWindow() {
  if (mainWindow) return

  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createPanelWindow() {
  if (panelWindow) {
    panelWindow.show()
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  panelWindow = new BrowserWindow({
    width: 400,
    height: Math.min(600, Math.floor(height * 0.7)),
    x: width - 420,
    y: 100,
    frame: false,
    transparent: false,
    backgroundColor: '#16213e',
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (VITE_DEV_SERVER_URL) {
    panelWindow.loadURL(`${VITE_DEV_SERVER_URL}#/panel`)
  } else {
    panelWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/panel' })
  }

  panelWindow.on('closed', () => {
    panelWindow = null
  })
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWindow.setAlwaysOnTop(true, 'screen-saver')

  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(`${VITE_DEV_SERVER_URL}#/settings`)
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/settings' })
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

async function createScreenshotWindow() {
  if (screenshotWindow) {
    screenshotWindow.focus()
    return
  }

  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    })

    let screenshotImage = ''
    if (sources.length > 0) {
      screenshotImage = sources[0].thumbnail.toDataURL()
    }
    pendingScreenshotImage = screenshotImage

    screenshotWindow = new BrowserWindow({
      width: width,
      height: height,
      x: 0,
      y: 0,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      fullscreen: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    screenshotWindow.focus()

    if (VITE_DEV_SERVER_URL) {
      screenshotWindow.loadURL(`${VITE_DEV_SERVER_URL}#/screenshot`)
    } else {
      screenshotWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
        hash: '/screenshot'
      })
    }

    screenshotWindow.on('closed', () => {
      screenshotWindow = null
      pendingScreenshotImage = ''
    })
  } catch (error) {
    console.error('Failed to create screenshot window:', error)
  }
}

function formatHotkey(hk: string): string {
  if (!hk) return ''
  return hk
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/CmdOrCtrl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Command/gi, 'Cmd')
    .split('+')
    .map(p => p.length === 1 ? p.toUpperCase() : p)
    .join('+')
}

function buildTrayMenu() {
  if (!tray) return
  const screenshotHotkey = formatHotkey(store.get('screenshotHotkey', 'Alt+S') as string)
  const fullscreenHotkey = formatHotkey(store.get('fullscreenHotkey', 'CommandOrControl+Alt+F') as string)
  const windowHotkey = formatHotkey(store.get('windowHotkey', 'CommandOrControl+Alt+W') as string)
  const panelHotkey = formatHotkey(store.get('panelHotkey', 'CommandOrControl+Alt+P') as string)

  const contextMenu = Menu.buildFromTemplate([
    { label: `截图 (${screenshotHotkey})`, click: () => createScreenshotWindow() },
    { label: `全屏截图 (${fullscreenHotkey})`, click: () => takeFullscreenScreenshot() },
    { label: `窗口截图 (${windowHotkey})`, click: () => takeWindowScreenshot() },
    { label: `调出面板 (${panelHotkey})`, click: () => createPanelWindow() },
    { type: 'separator' },
    { label: '显示面板', click: () => createPanelWindow() },
    { label: '隐藏面板', click: () => panelWindow?.hide() },
    { type: 'separator' },
    { label: '设置', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(contextMenu)
}

function createTray() {
  try {
    const trayIcon = getAppIcon()
    if (trayIcon.isEmpty()) {
      console.error('Tray icon is empty, icon file not found')
      return
    }

    tray = new Tray(trayIcon)
    tray.setToolTip('SnapAI')
    buildTrayMenu()

    tray.on('click', () => {
      if (panelWindow?.isVisible()) {
        panelWindow.hide()
      } else {
        createPanelWindow()
      }
    })
  } catch (error) {
    console.error('Failed to create tray:', error)
  }
}

async function takeFullscreenScreenshot() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    })

    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL()
      panelWindow?.webContents.send('screenshot-taken', { type: 'fullscreen', dataUrl })
      createPanelWindow()
    }
  } catch (error) {
    console.error('Fullscreen screenshot failed:', error)
  }
}

async function takeWindowScreenshot() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL()
      panelWindow?.webContents.send('screenshot-taken', { type: 'window', dataUrl })
      createPanelWindow()
    }
  } catch (error) {
    console.error('Window screenshot failed:', error)
  }
}

function registerShortcuts() {
  try {
    const screenshotHotkey = store.get('screenshotHotkey', 'Alt+S') as string
    const fullscreenHotkey = store.get('fullscreenHotkey', 'CommandOrControl+Alt+F') as string
    const windowHotkey = store.get('windowHotkey', 'CommandOrControl+Alt+W') as string
    const panelHotkey = store.get('panelHotkey', 'CommandOrControl+Alt+P') as string

    globalShortcut.unregisterAll()

    const registered1 = globalShortcut.register(screenshotHotkey, () => {
      console.log('Screenshot shortcut triggered')
      createScreenshotWindow()
    })

    const registered2 = globalShortcut.register(fullscreenHotkey, () => {
      takeFullscreenScreenshot()
    })

    const registered3 = globalShortcut.register(windowHotkey, () => {
      takeWindowScreenshot()
    })

    const registered4 = globalShortcut.register(panelHotkey, () => {
      if (panelWindow?.isVisible()) {
        panelWindow.hide()
      } else {
        createPanelWindow()
      }
    })

    console.log('Shortcuts registered:', registered1, registered2, registered3, registered4)
  } catch (error) {
    console.error('Failed to register shortcuts:', error)
  }
}

function setupIPC() {
  ipcMain.handle('get-screenshot', async (_, type: 'region' | 'fullscreen' | 'window') => {
    const sources = await desktopCapturer.getSources({
      types: type === 'window' ? ['window'] : ['screen'],
      thumbnailSize: type === 'fullscreen' ? screen.getPrimaryDisplay().size : { width: 1920, height: 1080 }
    })

    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL()
    }
    return null
  })

  ipcMain.handle('send-to-panel', (_, data: any) => {
    panelWindow?.webContents.send('ai-response', data)
  })

  ipcMain.handle('hide-panel', () => {
    panelWindow?.hide()
  })

  ipcMain.handle('minimize-panel', () => {
    panelWindow?.minimize()
  })

  ipcMain.handle('resize-panel', (_, width: number, height: number) => {
    if (panelWindow) {
      const minWidth = 300
      const minHeight = 400
      panelWindow.setSize(
        Math.max(minWidth, Math.round(width)),
        Math.max(minHeight, Math.round(height))
      )
    }
  })

  ipcMain.handle('show-panel', () => {
    createPanelWindow()
  })

  ipcMain.handle('get-settings', () => {
    const profiles = (store.get('aiProfiles', []) as AiProfile[]) || []
    const activeId = store.get('activeAiProfileId', '') as string
    const active = profiles.find(p => p.id === activeId) || profiles[0] || null

    return {
      screenshotHotkey: store.get('screenshotHotkey', 'Alt+S'),
      fullscreenHotkey: store.get('fullscreenHotkey', 'CommandOrControl+Alt+F'),
      windowHotkey: store.get('windowHotkey', 'CommandOrControl+Alt+W'),
      panelHotkey: store.get('panelHotkey', 'CommandOrControl+Alt+P'),
      autoStart: store.get('autoStart', false),
      panelOpacity: store.get('panelOpacity', 0.95),
      apiKey: active?.apiKey || '',
      apiModel: active?.apiModel || 'doubao-vision-pro',
      apiBaseUrl: active?.apiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
      aiProfiles: profiles,
      activeAiProfileId: active?.id || ''
    }
  })

  ipcMain.handle('save-settings', (_, settings: any) => {
    console.log('save-settings called with:', settings ? Object.keys(settings) : settings)
    try {
      Object.keys(settings).forEach(key => {
        if (key === 'apiKey' || key === 'apiModel' || key === 'apiBaseUrl') return
        store.set(key, settings[key])
      })

      if (settings.panelOpacity !== undefined && panelWindow) {
        panelWindow.setOpacity(settings.panelOpacity)
      }

      registerShortcuts()
      buildTrayMenu()

      panelWindow?.webContents.send('settings-updated', settings)

      console.log('save-settings success')
      return { success: true }
    } catch (error) {
      console.error('Save settings error:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-ai-profiles', () => {
    return {
      profiles: (store.get('aiProfiles', []) as AiProfile[]) || [],
      activeId: (store.get('activeAiProfileId', '') as string) || ''
    }
  })

  ipcMain.handle('save-ai-profiles', (_, payload: { profiles: AiProfile[]; activeId: string }) => {
    try {
      store.set('aiProfiles', payload.profiles || [])
      store.set('activeAiProfileId', payload.activeId || '')
      panelWindow?.webContents.send('settings-updated', { aiProfilesUpdated: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-history', () => {
    return store.get('history', [])
  })

  ipcMain.handle('save-history', (_, history: any[]) => {
    store.set('history', history)
    return true
  })

  ipcMain.handle('get-favorites', () => {
    const data = store.get('favorites', [])
    console.log('[Main] get-favorites:', data)
    return data
  })

  ipcMain.handle('get-pending-screenshot', () => {
    return pendingScreenshotImage
  })

  ipcMain.handle('save-favorites', (_, favorites: any[]) => {
    console.log('[Main] save-favorites:', favorites)
    store.set('favorites', favorites)
    return true
  })

  ipcMain.handle('get-api-key', () => {
    const profiles = (store.get('aiProfiles', []) as AiProfile[]) || []
    const activeId = store.get('activeAiProfileId', '') as string
    const active = profiles.find(p => p.id === activeId) || profiles[0]
    return active?.apiKey || ''
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('check-for-updates', async () => {
    try {
      if (VITE_DEV_SERVER_URL) {
        log.info('Update check skipped in dev mode')
        return { updateAvailable: false, version: app.getVersion(), notes: '' }
      }
      const result = await autoUpdater.checkForUpdates()
      const currentVersion = app.getVersion()
      const remoteVersion = result?.updateInfo?.version

      if (remoteVersion && isNewerVersion(remoteVersion, currentVersion)) {
        return {
          updateAvailable: true,
          version: remoteVersion,
          notes: result.updateInfo.releaseNotes || ''
        }
      }
      return { updateAvailable: false, version: currentVersion, notes: '' }
    } catch (error) {
      log.error('Update check failed:', error)
      return { updateAvailable: false, version: app.getVersion(), notes: '' }
    }
  })

  ipcMain.handle('download-update', async () => {
    try {
      if (VITE_DEV_SERVER_URL) {
        return { success: false, error: 'Cannot download in dev mode' }
      }
      autoUpdater.downloadUpdate().catch((err) => {
        log.error('Download update failed:', err)
      })
      return { success: true }
    } catch (error) {
      log.error('Download update failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('install-update', () => {
    if (!VITE_DEV_SERVER_URL) {
      autoUpdater.quitAndInstall()
    }
  })

  ipcMain.handle('open-settings', () => {
    createSettingsWindow()
    if (settingsWindow) {
      settingsWindow.setAlwaysOnTop(true, 'screen-saver')
      settingsWindow.show()
      settingsWindow.focus()
    }
  })

  ipcMain.handle('close-settings', () => {
    settingsWindow?.close()
  })

  ipcMain.handle('close-screenshot', () => {
    screenshotWindow?.close()
  })

  ipcMain.handle('exit-screenshot', () => {
    if (screenshotWindow) {
      screenshotWindow.close()
      screenshotWindow = null
    }
  })

  ipcMain.handle('write-clipboard-text', (_, text: string) => {
    try {
      clipboard.writeText(typeof text === 'string' ? text : '')
      return { success: true }
    } catch (error) {
      console.error('write-clipboard-text failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('open-settings-from-screenshot', () => {
    if (screenshotWindow) {
      screenshotWindow.hide()
    }
    createSettingsWindow()
    if (settingsWindow) {
      settingsWindow.setAlwaysOnTop(true, 'screen-saver')
      settingsWindow.focus()
    }
  })

  let originalPanelBounds = { x: 0, y: 100, width: 400, height: 600 }
  let isInCustomFullscreen = false

  ipcMain.handle('toggle-fullscreen', () => {
    if (panelWindow) {
      if (isInCustomFullscreen) {
        isInCustomFullscreen = false
        panelWindow.setFullScreen(false)
        panelWindow.setPosition(originalPanelBounds.x, originalPanelBounds.y)
        panelWindow.setSize(originalPanelBounds.width, originalPanelBounds.height)
      } else {
        originalPanelBounds = {
          x: panelWindow.getPosition()[0],
          y: panelWindow.getPosition()[1],
          width: panelWindow.getSize()[0],
          height: panelWindow.getSize()[1]
        }
        const primaryDisplay = screen.getPrimaryDisplay()
        const { width, height } = primaryDisplay.size
        panelWindow.setSize(width, height)
        panelWindow.setPosition(0, 0)
        panelWindow.setFullScreen(true)
        isInCustomFullscreen = true
      }
    }
  })

  ipcMain.handle('screenshot-cropped', (_, croppedImageData: string, customPrompt?: string) => {
    screenshotWindow?.close()
    createPanelWindow()
    panelWindow?.webContents.send('screenshot-taken', { type: 'cropped', dataUrl: croppedImageData, customPrompt })
    panelWindow?.show()
    panelWindow?.focus()
  })

  ipcMain.handle('pin-screenshot', async (_, imageData: string) => {
    if (!imageData) return { success: false }
    try {
      const dim = parsePngDimensions(imageData)
      const cursor = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursor)
      const work = display.workArea
      const maxW = Math.max(120, Math.floor(work.width * 0.9))
      const maxH = Math.max(120, Math.floor(work.height * 0.9))
      let w = dim?.width || 400
      let h = dim?.height || 300
      const ratio = Math.min(maxW / w, maxH / h, 1)
      w = Math.max(80, Math.round(w * ratio))
      h = Math.max(60, Math.round(h * ratio))
      const x = work.x + Math.round((work.width - w) / 2)
      const y = work.y + Math.round((work.height - h) / 2)

      const win = new BrowserWindow({
        width: w,
        height: h,
        x,
        y,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: true,
        thickFrame: false,
        hasShadow: true,
        roundedCorners: true,
        useContentSize: true,
        minWidth: 40,
        minHeight: 30,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      pinnedWindows.add(win)
      pinnedWindowImages.set(win, imageData)
      win.on('closed', () => {
        pinnedWindows.delete(win)
      })
      if (VITE_DEV_SERVER_URL) {
        win.loadURL(`${VITE_DEV_SERVER_URL}#/pinned`)
      } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/pinned' })
      }
      screenshotWindow?.close()
      return { success: true }
    } catch (error) {
      console.error('pin-screenshot failed:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-pinned-image', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return ''
    return pinnedWindowImages.get(win) || ''
  })

  ipcMain.handle('close-pinned-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      pinnedWindows.delete(win)
      win.close()
    }
  })

  ipcMain.handle('resize-pinned-window', (event, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const w = Math.max(40, Math.round(width))
    const h = Math.max(30, Math.round(height))
    const [x, y] = win.getPosition()
    win.setBounds({ x, y, width: w, height: h })
  })

  ipcMain.handle('move-pinned-window', (event, x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const lock = pinnedDragLock.get(win)
    if (lock) {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: lock.width, height: lock.height })
    } else {
      win.setPosition(Math.round(x), Math.round(y))
    }
  })

  ipcMain.handle('get-pinned-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const b = win.getBounds()
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  })

  ipcMain.handle('move-pinned-by', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [x, y] = win.getPosition()
    const lock = pinnedDragLock.get(win)
    if (lock) {
      win.setBounds({ x: Math.round(x + dx), y: Math.round(y + dy), width: lock.width, height: lock.height })
    } else {
      win.setPosition(Math.round(x + dx), Math.round(y + dy))
    }
  })

  ipcMain.handle('pinned-drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const b = win.getBounds()
    pinnedDragLock.set(win, { width: b.width, height: b.height })
  })

  ipcMain.handle('pinned-drag-end', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    pinnedDragLock.delete(win)
  })

  ipcMain.handle('set-pinned-bounds', (event, x: number, y: number, width: number, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const w = Math.max(40, Math.round(width))
    const h = Math.max(30, Math.round(height))
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
  })

  ipcMain.handle('move-panel', (_, x: number, y: number) => {
    if (panelWindow) {
      panelWindow.setPosition(Math.round(x), Math.round(y))
    }
  })

  ipcMain.handle('get-panel-position', () => {
    if (panelWindow) {
      return panelWindow.getPosition()
    }
    return [0, 0]
  })

  const aiAbortControllers = new Map<string, AbortController>()

  ipcMain.handle('ai-stream-abort', (_, requestId: string) => {
    const ctl = aiAbortControllers.get(requestId)
    if (ctl) {
      try { ctl.abort() } catch {}
      aiAbortControllers.delete(requestId)
    }
  })

  ipcMain.handle('ai-stream-request', async (event, payload: {
    requestId: string
    endpoint: string
    apiKey: string
    body: any
    headers?: Record<string, string>
  }) => {
    const { requestId, endpoint, apiKey, body, headers: extraHeaders } = payload
    const sender = event.sender
    const ctl = new AbortController()
    aiAbortControllers.set(requestId, ctl)

    const send = (channel: string, data: any) => {
      if (!sender.isDestroyed()) sender.send(channel, { requestId, ...data })
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(extraHeaders || {})
      }
      if (!extraHeaders || (!extraHeaders['Authorization'] && !extraHeaders['x-api-key'])) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctl.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        send('ai-stream-error', { message: `API request failed: ${response.status} - ${errorText}` })
        return { ok: false }
      }

      const reader = response.body?.getReader()
      if (!reader) {
        send('ai-stream-error', { message: 'No response body' })
        return { ok: false }
      }

      const decoder = new TextDecoder()
      while (true) {
        if (ctl.signal.aborted) {
          try { await reader.cancel() } catch {}
          send('ai-stream-error', { message: 'AbortError', aborted: true })
          return { ok: false }
        }
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        send('ai-stream-chunk', { chunk })
      }

      send('ai-stream-done', {})
      return { ok: true }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        send('ai-stream-error', { message: 'AbortError', aborted: true })
      } else {
        send('ai-stream-error', { message: err?.message || String(err) })
      }
      return { ok: false }
    } finally {
      aiAbortControllers.delete(requestId)
    }
  })
}

app.whenReady().then(() => {
  console.log('App ready, initializing...')
  createMainWindow()
  createPanelWindow()
  createTray()
  setupIPC()
  registerShortcuts()

  if (!VITE_DEV_SERVER_URL) {
    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info.version)
      if (settingsWindow) {
        settingsWindow.webContents.send('update-available', info)
      }
      if (panelWindow) {
        panelWindow.webContents.send('update-available', info)
      }
    })

    autoUpdater.on('download-progress', (progress) => {
      const payload = {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }
      log.info(`Download progress: ${progress.percent.toFixed(2)}%`)
      if (settingsWindow) {
        settingsWindow.webContents.send('download-progress', payload)
      }
      if (panelWindow) {
        panelWindow.webContents.send('download-progress', payload)
      }
    })

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info.version)
      if (settingsWindow) {
        settingsWindow.webContents.send('update-downloaded', info)
      }
      if (panelWindow) {
        panelWindow.webContents.send('update-downloaded', info)
      }

      if (Notification.isSupported()) {
        new Notification({
          title: '更新已下载',
          body: `新版本 ${info.version} 已下载，点击立即安装`
        }).show()
      }

      const targetWindow = settingsWindow || panelWindow || mainWindow
      if (targetWindow) {
        dialog.showMessageBox(targetWindow, {
          type: 'info',
          title: '更新已就绪',
          message: `新版本 ${info.version} 已下载完成`,
          detail: '点击"立即安装"重启应用并完成更新，或稍后在退出应用时自动安装。',
          buttons: ['立即安装', '稍后'],
          defaultId: 0,
          cancelId: 1
        }).then((result) => {
          if (result.response === 0) {
            autoUpdater.quitAndInstall()
          }
        })
      }
    })

    autoUpdater.on('error', (error) => {
      log.error('AutoUpdater error:', error)
      const rawMessage = error?.message || String(error)
      let friendlyMessage = rawMessage
      if (/sha512/i.test(rawMessage) && /expected/i.test(rawMessage)) {
        friendlyMessage = '安装包校验失败：服务器上的安装包与版本清单不一致，请联系开发者重新发布。'
      } else if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(rawMessage)) {
        friendlyMessage = '网络连接失败，请检查网络后重试。'
      } else if (/404/.test(rawMessage)) {
        friendlyMessage = '未找到安装包文件（可能 Release 缺少 .exe 或 latest.yml）。'
      }
      if (settingsWindow) {
        settingsWindow.webContents.send('update-error', friendlyMessage)
      }
      if (panelWindow) {
        panelWindow.webContents.send('update-error', friendlyMessage)
      }
    })

    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Initial update check failed:', err)
    })
  }

  console.log('Initialization complete')
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

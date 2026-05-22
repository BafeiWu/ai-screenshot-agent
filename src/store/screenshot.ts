import { defineStore } from 'pinia'
import { ref } from 'vue'

interface Message {
  role: string
  content: string
}

export interface FavoriteMessage {
  role: string
  content: string
  image?: string
}

export interface Favorite {
  id: string
  title: string
  timestamp: number
  imageData: string
  question: string
  answer: string
  messages?: FavoriteMessage[]
}

export const useScreenshotStore = defineStore('screenshot', () => {
  const currentImage = ref<string | null>(null)
  const apiKey = ref<string>('')
  const conversationId = ref<string>('')
  const favorites = ref<Favorite[]>([])

  const setCurrentImage = (image: string | null) => {
    currentImage.value = image
  }

  const setFavorites = (data: Favorite[]) => {
    favorites.value = data
  }

  const sendToAI = async (
    userMessage: string,
    history: Message[] = [],
    imageData?: string,
    onToken?: (token: string) => void,
    signal?: AbortSignal
  ): Promise<string> => {
    const image = imageData || currentImage.value

    let apiKeyValue = apiKey.value
    let apiModel = 'doubao-vision-pro'
    let apiBaseUrl = 'https://ark.cn-beijing.volces.com/api/v3'

    const savedSettings = await window.electronAPI.getSettings()
    if (savedSettings?.apiKey) {
      apiKeyValue = savedSettings.apiKey
      apiKey.value = apiKeyValue
    }
    if (savedSettings?.apiModel) {
      apiModel = savedSettings.apiModel
    }
    if (savedSettings?.apiBaseUrl) {
      apiBaseUrl = savedSettings.apiBaseUrl
    }

    if (!apiKeyValue) {
      return '请先在设置中配置豆包 API Key'
    }

    let messages: Array<any>
    
    if (image) {
      messages = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: image },
            { type: 'text', text: userMessage }
          ]
        }
      ]
    } else {
      messages = [
        {
          role: 'user',
          content: userMessage
        }
      ]
    }

    try {
      let endpoint = apiBaseUrl
      let requestBody: any = {}
      let extraHeaders: Record<string, string> | undefined
      const isAnthropic = apiBaseUrl.includes('cc.freemodel') || apiBaseUrl.includes('anthropic') || /\/v1\/messages\b/.test(apiBaseUrl)
      const isResponses = !isAnthropic && (apiBaseUrl.includes('freemodel') || apiBaseUrl.includes('codex'))

      if (isAnthropic) {
        endpoint = apiBaseUrl.endsWith('/') ? apiBaseUrl + 'v1/messages' : apiBaseUrl + '/v1/messages'
        const anthropicContent: any[] = []
        if (image) {
          const m = image.match(/^data:(image\/\w+);base64,(.+)$/)
          if (m) {
            anthropicContent.push({
              type: 'image',
              source: { type: 'base64', media_type: m[1], data: m[2] }
            })
          }
        }
        anthropicContent.push({ type: 'text', text: userMessage })

        requestBody = {
          model: apiModel,
          max_tokens: 4096,
          messages: [{ role: 'user', content: anthropicContent }],
          stream: true
        }
        extraHeaders = {
          'x-api-key': apiKeyValue,
          'anthropic-version': '2023-06-01'
        }
      } else if (isResponses) {
        endpoint = apiBaseUrl.endsWith('/') ? apiBaseUrl + 'v1/responses' : apiBaseUrl + '/v1/responses'
        const inputContent: any[] = []

        if (image) {
          inputContent.push({ type: 'input_image', image_url: image })
        }
        inputContent.push({ type: 'input_text', text: userMessage })

        requestBody = {
          model: apiModel,
          input: [
            {
              role: 'user',
              content: inputContent
            }
          ],
          stream: true
        }
      } else {
        endpoint = apiBaseUrl.endsWith('/') ? apiBaseUrl + 'chat/completions' : apiBaseUrl + '/chat/completions'
        requestBody = {
          model: apiModel,
          messages: messages,
          stream: true
        }
      }
      
      console.log('API Request:', {
        endpoint,
        apiKeyValue: apiKeyValue ? apiKeyValue.substring(0, 10) + '...' : 'empty',
        apiModel,
        imageLength: image ? image.length : 0,
        requestBody: JSON.stringify(requestBody)
      })

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      let fullContent = ''
      let buffer = ''

      let offChunk: (() => void) | null = null
      let offError: (() => void) | null = null
      let offDone: (() => void) | null = null
      const cleanup = () => {
        offChunk?.(); offChunk = null
        offError?.(); offError = null
        offDone?.(); offDone = null
      }

      offChunk = window.electronAPI.onAiStreamChunk(({ requestId: rid, chunk }) => {
        if (rid !== requestId) return
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            let content = ''

            if (isAnthropic) {
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
                content = parsed.delta.text
              }
            } else if (isResponses) {
              if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
                content = parsed.delta
              } else if (parsed.type === 'response.refusal.delta' && typeof parsed.delta === 'string') {
                content = parsed.delta
              }
            } else {
              content = parsed.choices?.[0]?.delta?.content || ''
            }

            if (content) {
              fullContent += content
              if (onToken) onToken(content)
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      })

      const result = await new Promise<string>((resolve, reject) => {
        offError = window.electronAPI.onAiStreamError(({ requestId: rid, message, aborted }) => {
          if (rid !== requestId) return
          cleanup()
          if (aborted) reject(new DOMException('Aborted', 'AbortError'))
          else reject(new Error(message))
        })

        offDone = window.electronAPI.onAiStreamDone(({ requestId: rid }) => {
          if (rid !== requestId) return
          cleanup()
          resolve(fullContent || 'AI 未能返回有效回答')
        })

        if (signal) {
          if (signal.aborted) {
            window.electronAPI.aiStreamAbort(requestId)
          } else {
            signal.addEventListener('abort', () => {
              window.electronAPI.aiStreamAbort(requestId)
            }, { once: true })
          }
        }

        window.electronAPI.aiStreamRequest({
          requestId,
          endpoint,
          apiKey: apiKeyValue,
          body: requestBody,
          headers: extraHeaders
        }).catch((err: any) => {
          cleanup()
          reject(err)
        })
      })

      return result
    } catch (error) {
      if ((error as any)?.name === 'AbortError' || signal?.aborted) {
        throw error
      }
      console.error('AI API Error:', error)
      return 'AI 服务暂时不可用: ' + (error as Error).message
    }
  }

  const setApiKey = (key: string) => {
    apiKey.value = key
    localStorage.setItem('doubao_api_key', key)
  }

  return {
    currentImage,
    apiKey,
    conversationId,
    favorites,
    setCurrentImage,
    setFavorites,
    sendToAI,
    setApiKey
  }
})

declare global {
  interface Window {
    electronAPI: {
      getScreenshot: (type: 'region' | 'fullscreen' | 'window') => Promise<string | null>
      sendToPanel: (data: any) => Promise<void>
      hidePanel: () => Promise<void>
      showPanel: () => Promise<void>
      minimizePanel: () => Promise<void>
      resizePanel: (width: number, height: number) => Promise<void>
      getSettings: () => Promise<any>
      saveSettings: (settings: any) => Promise<boolean>
      getAiProfiles: () => Promise<{ profiles: Array<{ id: string; title: string; apiKey: string; apiModel: string; apiBaseUrl: string }>; activeId: string }>
      saveAiProfiles: (payload: { profiles: Array<{ id: string; title: string; apiKey: string; apiModel: string; apiBaseUrl: string }>; activeId: string }) => Promise<{ success: boolean; error?: string }>
      getHistory: () => Promise<any[]>
      saveHistory: (history: any[]) => Promise<boolean>
      openSettings: () => Promise<void>
      closeSettings: () => Promise<void>
      closeScreenshot: () => Promise<void>
      screenshotCropped: (croppedImageData: string, customPrompt?: string) => Promise<void>
      movePanel: (x: number, y: number) => Promise<void>
      getPanelPosition: () => Promise<[number, number]>
      getApiKey: () => Promise<string>
      getPendingScreenshot: () => Promise<string>
      getVersion: () => Promise<string>
      checkForUpdates: () => Promise<{ updateAvailable: boolean; version: string; notes: string }>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      installUpdate: () => Promise<void>
      onUpdateAvailable: (callback: (info: { version: string }) => void) => void
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => void
      onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => void
      onUpdateError: (callback: (message: string) => void) => void
      getFavorites: () => Promise<any[]>
      saveFavorites: (favorites: any[]) => Promise<boolean>
      aiStreamRequest: (payload: { requestId: string; endpoint: string; apiKey: string; body: any; headers?: Record<string, string> }) => Promise<{ ok: boolean }>
      aiStreamAbort: (requestId: string) => Promise<void>
      onAiStreamChunk: (callback: (data: { requestId: string; chunk: string }) => void) => () => void
      onAiStreamError: (callback: (data: { requestId: string; message: string; aborted?: boolean }) => void) => () => void
      onAiStreamDone: (callback: (data: { requestId: string }) => void) => () => void
      onScreenshotTaken: (callback: (data: { type: string; dataUrl: string; customPrompt?: string }) => void) => void
      onAIResponse: (callback: (data: any) => void) => void
      onSettingsUpdated: (callback: (settings: any) => void) => void
      toggleFullscreen: () => Promise<void>
      openSettingsFromScreenshot: () => Promise<void>
      exitScreenshot: () => Promise<void>
      writeClipboardText: (text: string) => Promise<{ success: boolean; error?: string }>
      pinScreenshot: (imageData: string) => Promise<{ success: boolean; error?: string }>
      getPinnedImage: () => Promise<string>
      closePinnedWindow: () => Promise<void>
      resizePinnedWindow: (width: number, height: number) => Promise<void>
      movePinnedWindow: (x: number, y: number) => Promise<void>
      getPinnedBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      movePinnedBy: (dx: number, dy: number) => Promise<void>
      pinnedDragStart: () => Promise<void>
      pinnedDragEnd: () => Promise<void>
      setPinnedBounds: (x: number, y: number, width: number, height: number) => Promise<void>
    }
  }
}

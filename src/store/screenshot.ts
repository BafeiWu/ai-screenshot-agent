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
      const endpoint = apiBaseUrl.endsWith('/') ? apiBaseUrl + 'chat/completions' : apiBaseUrl + '/chat/completions'
      console.log('API Request:', {
        endpoint,
        apiKeyValue: apiKeyValue ? apiKeyValue.substring(0, 10) + '...' : 'empty',
        apiModel,
        imageLength: image ? image.length : 0
      })

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKeyValue}`
        },
        body: JSON.stringify({
          model: apiModel,
          messages: messages,
          stream: true
        }),
        signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('API Error Response:', response.status, errorText)
        throw new Error(`API request failed: ${response.status} - ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let fullContent = ''

      while (true) {
        if (signal?.aborted) {
          try { await reader.cancel() } catch {}
          throw new DOMException('Aborted', 'AbortError')
        }
        const { done, value } = await reader.read()
        if (done) break
        if (signal?.aborted) {
          try { await reader.cancel() } catch {}
          throw new DOMException('Aborted', 'AbortError')
        }

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                fullContent += content
                if (onToken) {
                  onToken(content)
                }
              }
            } catch (e) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      return fullContent || 'AI 未能返回有效回答'
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
      onScreenshotTaken: (callback: (data: { type: string; dataUrl: string; customPrompt?: string }) => void) => void
      onAIResponse: (callback: (data: any) => void) => void
      onSettingsUpdated: (callback: (settings: any) => void) => void
      toggleFullscreen: () => Promise<void>
      openSettingsFromScreenshot: () => Promise<void>
      exitScreenshot: () => Promise<void>
    }
  }
}

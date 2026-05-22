import { defineStore } from 'pinia'
import { ref } from 'vue'

interface Message {
  role: string
  content: string
}

export interface AgentToolEvent {
  toolName: string
  input?: any
  result?: any
  status: 'running' | 'done' | 'error'
}

export interface FavoriteMessage {
  role: string
  content: string
  image?: string
  toolEvents?: AgentToolEvent[]
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

  const AGENT_TOOLS = [
    {
      name: 'read_file',
      description: '读取一个文本文件的全部内容(限 2MB 内,UTF-8)。',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件绝对路径' } },
        required: ['path']
      }
    },
    {
      name: 'list_dir',
      description: '列出目录下直接子项的名字与类型(file/dir)。',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录绝对路径' } },
        required: ['path']
      }
    },
    {
      name: 'search_files',
      description: '在目录下递归搜索文件,可按文件名 glob 或正文内容(正则) 匹配。',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '搜索起点目录' },
          pattern: { type: 'string', description: '文件名 glob,例如 "*.md"。空则不按名匹配。' },
          contentMatch: { type: 'string', description: '可选:正文中匹配的正则。' }
        },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: '创建或覆盖文件,自动建上层目录。',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'move_file',
      description: '重命名或移动文件/目录。',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['from', 'to']
      }
    },
    {
      name: 'delete_file',
      description: '把文件/目录移到回收站(可恢复)。',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  ]

  interface AgentEvent {
    type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error'
    text?: string
    toolName?: string
    toolInput?: any
    toolResult?: any
    message?: string
  }

  const executeAgentTool = async (name: string, input: any): Promise<any> => {
    try {
      switch (name) {
        case 'read_file':
          return await window.electronAPI.agentReadFile({ path: String(input?.path || '') })
        case 'list_dir':
          return await window.electronAPI.agentListDir({ path: String(input?.path || '') })
        case 'search_files':
          return await window.electronAPI.agentSearchFiles({
            path: String(input?.path || ''),
            pattern: String(input?.pattern || ''),
            contentMatch: input?.contentMatch ? String(input.contentMatch) : undefined
          })
        case 'write_file':
          return await window.electronAPI.agentWriteFile({
            path: String(input?.path || ''),
            content: String(input?.content || '')
          })
        case 'move_file':
          return await window.electronAPI.agentMoveFile({
            from: String(input?.from || ''),
            to: String(input?.to || '')
          })
        case 'delete_file':
          return await window.electronAPI.agentDeleteFile({ path: String(input?.path || '') })
        default:
          return { error: `未知工具: ${name}` }
      }
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  }

  const runAgentTask = async (
    userMessage: string,
    history: Array<{ role: string; content: any }> = [],
    imageData: string | undefined,
    onEvent: (e: AgentEvent) => void,
    signal?: AbortSignal
  ) => {
    const savedSettings = await window.electronAPI.getSettings()
    const apiKeyValue = savedSettings?.apiKey || ''
    const apiModel = savedSettings?.apiModel || 'claude-sonnet-4-6'
    const apiBaseUrl = savedSettings?.apiBaseUrl || ''

    if (!apiKeyValue || !apiBaseUrl) {
      onEvent({ type: 'error', message: '请先在设置中配置 API Key 和 API 地址' })
      return
    }
    const isAnthropic = apiBaseUrl.includes('cc.freemodel') || apiBaseUrl.includes('anthropic') || /\/v1\/messages\b/.test(apiBaseUrl)
    const isResponses = !isAnthropic && (apiBaseUrl.includes('freemodel') || apiBaseUrl.includes('codex'))
    if (isResponses) {
      onEvent({ type: 'error', message: 'Agent 模式当前不支持 OpenAI Responses 协议,请选择 Anthropic 或 Chat Completions 端点(如豆包/Kimi)' })
      return
    }
    const isOpenAI = !isAnthropic

    const endpoint = isAnthropic
      ? (apiBaseUrl.endsWith('/') ? apiBaseUrl + 'v1/messages' : apiBaseUrl + '/v1/messages')
      : (apiBaseUrl.endsWith('/') ? apiBaseUrl + 'chat/completions' : apiBaseUrl + '/chat/completions')

    const buildOpenAITools = () => AGENT_TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }))

    const buildInitialUserMessage = () => {
      if (isAnthropic) {
        const content: any[] = []
        if (imageData) {
          const m = imageData.match(/^data:(image\/\w+);base64,(.+)$/)
          if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })
        }
        content.push({ type: 'text', text: userMessage })
        return { role: 'user', content }
      }
      if (imageData) {
        return {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageData } },
            { type: 'text', text: userMessage }
          ]
        }
      }
      return { role: 'user', content: userMessage }
    }

    const messages: Array<any> = [...history, buildInitialUserMessage()]

    for (let turn = 0; turn < 25; turn++) {
      if (signal?.aborted) {
        onEvent({ type: 'error', message: 'Aborted' })
        return
      }

      const requestBody: any = isAnthropic ? {
        model: apiModel,
        max_tokens: 4096,
        tools: AGENT_TOOLS,
        messages,
        stream: true
      } : {
        model: apiModel,
        tools: buildOpenAITools(),
        messages,
        stream: true
      }

      const requestId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      let buffer = ''
      const assistantBlocks: any[] = []
      let currentBlock: any = null
      let currentJson = ''
      let stopReason = ''

      const openaiAssistantText = { value: '' }
      const openaiToolCalls: Array<{ id: string; name: string; argsBuf: string }> = []

      const turnPromise = new Promise<void>((resolve, reject) => {
        const offChunk = window.electronAPI.onAiStreamChunk(({ requestId: rid, chunk }) => {
          if (rid !== requestId) return
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (!data || data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (isAnthropic) {
                if (parsed.type === 'content_block_start') {
                  currentBlock = { ...parsed.content_block }
                  if (currentBlock.type === 'text') currentBlock.text = ''
                  if (currentBlock.type === 'tool_use') currentJson = ''
                } else if (parsed.type === 'content_block_delta') {
                  if (parsed.delta?.type === 'text_delta' && currentBlock?.type === 'text') {
                    currentBlock.text += parsed.delta.text
                    onEvent({ type: 'text', text: parsed.delta.text })
                  } else if (parsed.delta?.type === 'input_json_delta' && currentBlock?.type === 'tool_use') {
                    currentJson += parsed.delta.partial_json || ''
                  }
                } else if (parsed.type === 'content_block_stop') {
                  if (currentBlock?.type === 'tool_use') {
                    try { currentBlock.input = currentJson ? JSON.parse(currentJson) : {} } catch { currentBlock.input = {} }
                  }
                  if (currentBlock) assistantBlocks.push(currentBlock)
                  currentBlock = null
                  currentJson = ''
                } else if (parsed.type === 'message_delta') {
                  if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason
                }
              } else {
                const choice = parsed.choices?.[0]
                if (!choice) continue
                const delta = choice.delta || {}
                if (typeof delta.content === 'string' && delta.content) {
                  openaiAssistantText.value += delta.content
                  onEvent({ type: 'text', text: delta.content })
                }
                if (Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = typeof tc.index === 'number' ? tc.index : openaiToolCalls.length
                    if (!openaiToolCalls[idx]) openaiToolCalls[idx] = { id: '', name: '', argsBuf: '' }
                    if (tc.id) openaiToolCalls[idx].id = tc.id
                    if (tc.function?.name) openaiToolCalls[idx].name = tc.function.name
                    if (typeof tc.function?.arguments === 'string') openaiToolCalls[idx].argsBuf += tc.function.arguments
                  }
                }
                if (choice.finish_reason) stopReason = choice.finish_reason
              }
            } catch {}
          }
        })
        const offError = window.electronAPI.onAiStreamError(({ requestId: rid, message, aborted }) => {
          if (rid !== requestId) return
          offChunk(); offError(); offDone()
          if (aborted) reject(new DOMException('Aborted', 'AbortError'))
          else reject(new Error(message))
        })
        const offDone = window.electronAPI.onAiStreamDone(({ requestId: rid }) => {
          if (rid !== requestId) return
          offChunk(); offError(); offDone()
          resolve()
        })

        if (signal) {
          if (signal.aborted) window.electronAPI.aiStreamAbort(requestId)
          else signal.addEventListener('abort', () => window.electronAPI.aiStreamAbort(requestId), { once: true })
        }

        window.electronAPI.aiStreamRequest({
          requestId,
          endpoint,
          apiKey: apiKeyValue,
          body: requestBody,
          headers: isAnthropic ? {
            'x-api-key': apiKeyValue,
            'anthropic-version': '2023-06-01'
          } : undefined
        }).catch(reject)
      })

      try {
        await turnPromise
      } catch (err: any) {
        if (err?.name === 'AbortError') onEvent({ type: 'error', message: 'Aborted' })
        else onEvent({ type: 'error', message: err?.message || String(err) })
        return
      }

      if (isAnthropic) {
        messages.push({ role: 'assistant', content: assistantBlocks })
        const toolUses = assistantBlocks.filter(b => b.type === 'tool_use')
        if (toolUses.length === 0 || stopReason !== 'tool_use') {
          onEvent({ type: 'done' })
          return
        }

        const toolResults: any[] = []
        for (const tu of toolUses) {
          if (signal?.aborted) {
            onEvent({ type: 'error', message: 'Aborted' })
            return
          }
          onEvent({ type: 'tool_call', toolName: tu.name, toolInput: tu.input })
          const result = await executeAgentTool(tu.name, tu.input)
          onEvent({ type: 'tool_result', toolName: tu.name, toolResult: result })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
            is_error: !!result?.error
          })
        }
        messages.push({ role: 'user', content: toolResults })
      } else {
        const validToolCalls = openaiToolCalls.filter(t => t && t.name)
        if (validToolCalls.length === 0 || stopReason !== 'tool_calls') {
          messages.push({ role: 'assistant', content: openaiAssistantText.value })
          onEvent({ type: 'done' })
          return
        }
        messages.push({
          role: 'assistant',
          content: openaiAssistantText.value || null,
          tool_calls: validToolCalls.map(t => ({
            id: t.id,
            type: 'function',
            function: { name: t.name, arguments: t.argsBuf || '{}' }
          }))
        })
        for (const tc of validToolCalls) {
          if (signal?.aborted) {
            onEvent({ type: 'error', message: 'Aborted' })
            return
          }
          let parsedInput: any = {}
          try { parsedInput = tc.argsBuf ? JSON.parse(tc.argsBuf) : {} } catch {}
          onEvent({ type: 'tool_call', toolName: tc.name, toolInput: parsedInput })
          const result = await executeAgentTool(tc.name, parsedInput)
          onEvent({ type: 'tool_result', toolName: tc.name, toolResult: result })
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          })
        }
      }
    }

    onEvent({ type: 'error', message: '达到 25 轮上限,任务未完成' })
  }

  return {
    currentImage,
    apiKey,
    conversationId,
    favorites,
    setCurrentImage,
    setFavorites,
    sendToAI,
    runAgentTask,
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
      agentGetAllowedDirs: () => Promise<string[]>
      agentSetAllowedDirs: (dirs: string[]) => Promise<{ success: boolean; dirs: string[] }>
      agentPickDirectory: () => Promise<{ canceled: boolean; path?: string }>
      agentReadFile: (args: { path: string }) => Promise<{ content?: string; error?: string }>
      agentListDir: (args: { path: string }) => Promise<{ items?: Array<{ name: string; type: string }>; truncated?: boolean; error?: string }>
      agentSearchFiles: (args: { path: string; pattern: string; contentMatch?: string }) => Promise<{ results?: Array<{ path: string; type: string }>; truncated?: boolean; error?: string }>
      agentWriteFile: (args: { path: string; content: string }) => Promise<{ success?: boolean; path?: string; error?: string }>
      agentMoveFile: (args: { from: string; to: string }) => Promise<{ success?: boolean; from?: string; to?: string; error?: string }>
      agentDeleteFile: (args: { path: string }) => Promise<{ success?: boolean; path?: string; error?: string }>
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

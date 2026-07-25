import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult, AuthStatus, ChatClosedEvent, ChatEventEnvelope, CustosChat, PmEvent } from '../shared/types'

const custos = {
  getConfig: (): Promise<AuthStatus> => ipcRenderer.invoke('config:get'),
  setBaseUrl: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('config:setBaseUrl', url),

  login: (password: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:login', password),
  logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:logout'),
  authStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),

  api: <T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> =>
    ipcRenderer.invoke('admin:api', method, path, body),

  getEmbedUrl: (): Promise<string | null> => ipcRenderer.invoke('admin:embedUrl'),
  getAutofillPassword: (): Promise<string | null> => ipcRenderer.invoke('admin:getAutofillPassword'),

  openChat: (chat: CustosChat): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('chat:open', chat),
  sendMessage: (chatId: string, text: string): void => ipcRenderer.send('chat:send', chatId, text),
  sendApproval: (chatId: string, id: string, decision: 'allow' | 'deny'): void =>
    ipcRenderer.send('chat:approve', chatId, id, decision),
  closeChat: (chatId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('chat:close', chatId),

  onChatEvent: (cb: (envelope: ChatEventEnvelope) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, envelope: ChatEventEnvelope) => cb(envelope)
    ipcRenderer.on('chat:event', listener)
    return () => ipcRenderer.removeListener('chat:event', listener)
  },
  onChatClosed: (cb: (event: ChatClosedEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: ChatClosedEvent) => cb(event)
    ipcRenderer.on('chat:closed', listener)
    return () => ipcRenderer.removeListener('chat:closed', listener)
  },

  watchProject: (projectId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('pm:watch', projectId),
  unwatchProject: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('pm:unwatch'),
  onPmEvent: (cb: (event: PmEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: PmEvent) => cb(event)
    ipcRenderer.on('pm:event', listener)
    return () => ipcRenderer.removeListener('pm:event', listener)
  }
}

export type CustosApi = typeof custos

contextBridge.exposeInMainWorld('custos', custos)

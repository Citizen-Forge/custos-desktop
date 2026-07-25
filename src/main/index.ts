import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { custosClient } from './custos-client'
import type { CustosChat } from '../shared/types'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Every webview (the embedded Settings/admin panel) shares one
  // persistent partition so its own browser-native login survives restarts,
  // independent of the main-process-managed session used for the sidebar.
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpc(mainWindow)
}

function registerIpc(window: BrowserWindow): void {
  ipcMain.handle('config:get', async () => {
    const config = await custosClient.loadConfig()
    return { baseUrl: config.baseUrl, loggedIn: custosClient.isLoggedIn() }
  })

  ipcMain.handle('config:setBaseUrl', async (_e, url: string) => {
    await custosClient.setBaseUrl(url)
    return { ok: true }
  })

  ipcMain.handle('auth:login', async (_e, password: string) => custosClient.login(password))

  ipcMain.handle('auth:logout', () => {
    custosClient.logout()
    return { ok: true }
  })

  ipcMain.handle('auth:status', () => ({
    baseUrl: custosClient.getBaseUrl(),
    loggedIn: custosClient.isLoggedIn()
  }))

  ipcMain.handle('admin:api', async (_e, method: string, path: string, body?: unknown) =>
    custosClient.api(method, path, body)
  )

  ipcMain.handle('admin:embedUrl', () => {
    const baseUrl = custosClient.getBaseUrl()
    return baseUrl ? `${baseUrl}/admin` : null
  })

  ipcMain.handle('admin:getAutofillPassword', () => custosClient.getPasswordForWebviewAutofill())

  ipcMain.handle('chat:open', (_e, chat: CustosChat) => {
    if (!chat.connectUrl) return { ok: false, error: 'chat has no live connect URL' }
    custosClient.openChatSocket(chat.id, chat.connectUrl, window)
    return { ok: true }
  })

  ipcMain.on('chat:send', (_e, chatId: string, text: string) => custosClient.sendUserMessage(chatId, text))
  ipcMain.on('chat:approve', (_e, chatId: string, id: string, decision: 'allow' | 'deny') =>
    custosClient.sendApproval(chatId, id, decision)
  )
  ipcMain.handle('chat:close', (_e, chatId: string) => {
    custosClient.closeChatSocket(chatId)
    return { ok: true }
  })

  ipcMain.handle('pm:watch', (_e, projectId: string) => {
    custosClient.openPmSocket(projectId, window)
    return { ok: true }
  })
  ipcMain.handle('pm:unwatch', () => {
    custosClient.closePmSocket()
    return { ok: true }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.citizenforge.custos-desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

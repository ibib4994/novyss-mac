'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

  // Fenêtre
  close: () => ipcRenderer.send('win-close'),
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),

  // Onglets
  tabCreate:   (a) => ipcRenderer.invoke('tab-create', a),
  tabNavigate: (a) => ipcRenderer.invoke('tab-navigate', a),
  tabShow:     (a) => ipcRenderer.invoke('tab-show', a),
  tabHide:     (a) => ipcRenderer.invoke('tab-hide', a),
  tabClose:    (a) => ipcRenderer.invoke('tab-close', a),
  tabReload:   (a) => ipcRenderer.invoke('tab-reload', a),
  tabBack:     (a) => ipcRenderer.invoke('tab-back', a),
  tabForward:  (a) => ipcRenderer.invoke('tab-forward', a),
  tabCanGo:    (a) => ipcRenderer.invoke('tab-can-go', a),
  tabSuspend:  (a) => ipcRenderer.invoke('tab-suspend', a),
  tabResume:   (a) => ipcRenderer.invoke('tab-resume', a),

  // ouverture navigateur externe
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // événements venant du main
  onViewEvent:  (cb) => ipcRenderer.on('view-event', (_, d) => cb(d)),
  onOpenNewTab: (cb) => ipcRenderer.on('open-new-tab', (_, u) => cb(u)),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_, v) => cb(v)),

  // adblock
  adblockToggle: () => ipcRenderer.invoke('adblock-toggle'),
  adblockState:  () => ipcRenderer.invoke('adblock-state'),
  adblockStats:  () => ipcRenderer.invoke('adblock-stats'),

  // coffre-fort
  vaultExists:    () => ipcRenderer.invoke('vault-exists'),
  vaultCreate:    (p) => ipcRenderer.invoke('vault-create', p),
  vaultOpen:      (p) => ipcRenderer.invoke('vault-open', p),
  vaultSave:      (a) => ipcRenderer.invoke('vault-save', a),
  vaultChangePwd: (a) => ipcRenderer.invoke('vault-change-pwd', a),

  // dimensions UI
  sendUIDims:  (a) => ipcRenderer.send('ui-dims', a),
  panelOpen:   (a) => ipcRenderer.send('panel-open', a),
  panelClose:  ()  => ipcRenderer.send('panel-close'),

  // menu contextuel natif
  showTabCtxMenu: (a) => ipcRenderer.invoke('show-tab-ctx-menu', a),

  // wallpaper persistant
  wpSaveFile:   (a) => ipcRenderer.invoke('wp-save-file', a),
  wpLoadFile:   (a) => ipcRenderer.invoke('wp-load-file', a),
  wpDeleteFile: (a) => ipcRenderer.invoke('wp-delete-file', a),

  // icône dynamique
  setAppIcon: (a) => ipcRenderer.invoke('set-app-icon', a),

  // overlay menu ctx
  onCtxMenuOpened: (cb) => ipcRenderer.on('ctx-menu-opened', cb),
  onCtxMenuClosed: (cb) => ipcRenderer.on('ctx-menu-closed', cb),

  // mises à jour
  checkUpdate:       ()   => ipcRenderer.invoke('check-update'),
  downloadUpdate:    (a)  => ipcRenderer.invoke('download-update', a),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available',    (_, d) => cb(d)),
  onUpdateDlProgress:(cb) => ipcRenderer.on('update-dl-progress',  (_, d) => cb(d)),

  // téléchargements
  onDlStarted:  (cb) => ipcRenderer.on('dl-started',  (_, d) => cb(d)),
  onDlProgress: (cb) => ipcRenderer.on('dl-progress', (_, d) => cb(d)),
  onDlDone:     (cb) => ipcRenderer.on('dl-done',     (_, d) => cb(d)),
  dlOpenFolder: (a)  => ipcRenderer.invoke('dl-open-folder', a),
  dlOpenFile:   (a)  => ipcRenderer.invoke('dl-open-file', a),
  vtScan:       (a)  => ipcRenderer.invoke('vt-scan', a),
  initDownloads: ()  => ipcRenderer.send('init-downloads'),

  // sites spéciaux
  setExtSites:    (sites) => ipcRenderer.send('set-ext-sites', sites),
  onAskExtSite:   (cb)    => ipcRenderer.on('ask-ext-site', (_, d) => cb(d)),
  detectBrowsers: ()      => ipcRenderer.invoke('detect-browsers'),
  openInBrowser:  (a)     => ipcRenderer.invoke('open-in-browser', a),

  // webview hide/show (panels overlay)
  webviewHide: ()   => ipcRenderer.send('webview-hide'),
  webviewShow: ()   => ipcRenderer.send('webview-show'),
  onWebviewScreenshot: (cb) => ipcRenderer.on('webview-screenshot', (_, d) => cb(d)),

  // détection mots de passe
  pwdSaveEntry:  (a) => ipcRenderer.invoke('pwd-detect-save-entry', a),
  pwdGetForSite: (a) => ipcRenderer.invoke('pwd-get-for-site', a),

  // plateforme
  onPlatform: (cb) => ipcRenderer.on('platform', (_, p) => cb(p)),
  platform:   () => process.platform,
});
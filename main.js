'use strict';

const { app, BrowserWindow, ipcMain, WebContentsView, session, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');

// ── Flags video ───────────────────────────────────────────────────
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// ── État ──────────────────────────────────────────────────────────
const APP_VERSION  = '1.0.0';
// URL du version.json hébergé sur GitHub (branche main)
const UPDATE_URL   = 'https://raw.githubusercontent.com/ibib4994/novyss/main/version.json';
let win;
let menuView    = null;
let _menuResolve = null;
let _menuReady   = false;
let _mouseDown   = false;
const views        = new Map();
let adblockEnabled = true;
let blockedCount   = 0;

let SB_W = 220;
let TB_H = 52;
let PANEL_W = 0; // 370 quand un panneau est ouvert, 0 sinon

function getViewBounds() {
  const [w, h] = win.getContentSize();
  return {
    x:      SB_W,
    y:      TB_H,
    width:  Math.max(w - SB_W - PANEL_W, 100),
    height: Math.max(h - TB_H, 100),
  };
}

ipcMain.on('ui-dims', (_, { sbW, tbH }) => {
  if (sbW !== undefined) SB_W = sbW;
  if (tbH !== undefined) TB_H = tbH;
  for (const [, v] of views) {
    if (v._visible) v.setBounds(getViewBounds());
  }
});

// Quand un panneau s'ouvre : réduire la WebView pour ne pas la cacher
ipcMain.on('panel-open', (_, { panelW }) => {
  PANEL_W = panelW || 370;
  for (const [, v] of views) {
    if (v._visible) v.setBounds(getViewBounds());
  }
});

// Quand le panneau se ferme : restaurer la WebView
ipcMain.on('panel-close', () => {
  PANEL_W = 0;
  for (const [, v] of views) {
    if (v._visible) v.setBounds(getViewBounds());
  }
});


// ═════════════════════════════════════════════════════════════════
// SYSTÈME DE MISE À JOUR
// ═════════════════════════════════════════════════════════════════
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdates(silent = false) {
  return new Promise(resolve => {
    const https = require('https');
    // Ajouter timestamp pour éviter le cache GitHub
    const url = UPDATE_URL + '?t=' + Date.now();
    const req = https.get(url, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          // info = { version, notes, date, url, url_mac }
          // Utiliser l'URL selon la plateforme
          if (process.platform === 'darwin' && info.url_mac) {
            info.url = info.url_mac;
          }
          const hasUpdate = compareVersions(info.version, APP_VERSION) > 0;
          resolve({ hasUpdate, info, currentVersion: APP_VERSION });
        } catch { resolve({ hasUpdate: false, error: 'Parse error' }); }
      });
    });
    req.on('error', () => resolve({ hasUpdate: false, error: 'Serveur non disponible' }));
    req.on('timeout', () => { req.destroy(); resolve({ hasUpdate: false, error: 'Timeout' }); });
  });
}

ipcMain.handle('check-update', async () => {
  return await checkForUpdates(true);
});

ipcMain.handle('download-update', async (_, { url, version }) => {
  const https   = require('https');
  const http    = require('http');
  const fs      = require('fs');
  const os      = require('os');
  const path    = require('path');

  const isMacDl  = process.platform === 'darwin';
  const filename = isMacDl ? ('Novyss-' + version + '.dmg') : ('Novyss.Setup.' + version + '.exe');
  const dest     = path.join(os.tmpdir(), filename);

  return new Promise(resolve => {
    const proto = url.startsWith('https') ? https : http;

    const doDownload = (dlUrl) => {
      proto.get(dlUrl, { timeout: 30000 }, res => {
        // Suivre les redirections
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doDownload(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ ok: false, error: 'HTTP ' + res.statusCode });
          return;
        }

        const total  = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out    = fs.createWriteStream(dest);

        res.on('data', chunk => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.round((received / total) * 100);
            win.webContents.send('update-dl-progress', { pct, received, total });
          }
        });

        res.pipe(out);
        out.on('finish', () => {
          out.close();
          win.webContents.send('update-dl-progress', { pct: 100, done: true });
          // Lancer l'installateur
          const { exec } = require('child_process');
          const cmd = process.platform === 'darwin'
            ? 'open "' + dest + '"'          // ouvre le .dmg sur macOS
            : '"' + dest + '"';              // lance le .exe sur Windows
          exec(cmd, err => {
            if (err) resolve({ ok: false, error: err.message });
            else resolve({ ok: true, path: dest });
          });
        });
        out.on('error', e => resolve({ ok: false, error: e.message }));
        res.on('error',  e => resolve({ ok: false, error: e.message }));
      }).on('error', e => resolve({ ok: false, error: e.message }));
    };

    doDownload(url);
  });
});

// Vérification automatique au démarrage (après 3 secondes)
app.whenReady().then(() => {
  setTimeout(async () => {
    if (!win) return;
    const result = await checkForUpdates(true);
    if (result.hasUpdate) {
      win.webContents.send('update-available', result);
    }
  }, 3000);
});


// ── Icône dynamique ────────────────────────────────────────────
ipcMain.handle('set-app-icon', async (_, { svg, accent }) => {
  try {
    // Convertir le SVG base64 en NativeImage
    const base64 = svg.replace('data:image/svg+xml;base64,', '');
    const buf    = Buffer.from(base64, 'base64');
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(buf, { scaleFactor: 2 });
    if (!img.isEmpty()) {
      win.setIcon(img);
      app.dock && app.dock.setIcon(img); // macOS
    }
  } catch (e) { /* ignore */ }
  return { ok: true };
});


// ═════════════════════════════════════════════════════════════════
// STATS — Ping Discord au démarrage
// ═════════════════════════════════════════════════════════════════
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1479952264620671148/BAopfl2-Iw8sH_-cIrRmEZ5ApYDnHIoK0KOefAcBI8Ut8_Z1uhuVtW80HPEtuuTPM8xe';

function pingDiscord() {
  try {
    const https    = require('https');
    const os       = require('os');
    const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    const now      = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const hostname = os.hostname();

    const body = JSON.stringify({
      username: 'Novyss Stats',
      avatar_url: 'https://raw.githubusercontent.com/ibib4994/novyss/main/icon.png',
      embeds: [{
        title: '🟢 Nouvel utilisateur connecté',
        color: 0x7c3aed,
        fields: [
          { name: '💻 Machine',    value: hostname,  inline: true },
          { name: '🖥️ Système',   value: platform,  inline: true },
          { name: '🕐 Heure',      value: now,        inline: false }
        ],
        footer: { text: 'Novyss v' + APP_VERSION }
      }]
    });

    const url  = new URL(DISCORD_WEBHOOK);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const req = https.request(opts);
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
}

// Ping 5 secondes après le démarrage
app.whenReady().then(() => {
  setTimeout(pingDiscord, 5000);
});


// ── Wallpaper — sauvegarde sur disque ─────────────────────────────
ipcMain.handle('wp-save-file', async (_, { dataUrl, filename }) => {
  try {
    const { app } = require('electron');
    const path    = require('path');
    const fs      = require('fs');
    const dir     = path.join(app.getPath('userData'), 'wallpapers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // On garde tous les fichiers (galerie multi-fonds)

    const filepath = path.join(dir, filename);
    const base64   = dataUrl.replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
    return { ok: true, filepath: 'file://' + filepath.replace(/\\/g, '/') };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('wp-load-file', async (_, { filename }) => {
  try {
    const { app } = require('electron');
    const path    = require('path');
    const fs      = require('fs');
    const filepath = path.join(app.getPath('userData'), 'wallpapers', filename);
    if (!fs.existsSync(filepath)) return { ok: false };
    const data    = fs.readFileSync(filepath);
    const ext     = filename.split('.').pop().toLowerCase();
    const mime    = ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : 'image/' + ext;
    const dataUrl = 'data:' + mime + ';base64,' + data.toString('base64');
    return { ok: true, dataUrl };
  } catch { return { ok: false }; }
});

ipcMain.handle('wp-delete-file', async (_, { filename }) => {
  try {
    const { app } = require('electron');
    const path    = require('path');
    const fs      = require('fs');
    const filepath = path.join(app.getPath('userData'), 'wallpapers', filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    return { ok: true };
  } catch { return { ok: false }; }
});

// ── Adblock ───────────────────────────────────────────────────────
const BLOCKED_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adnxs.com',
  'rubiconproject.com',
  'openx.net'
];

function isAd(url) {
  try {
    const host = new URL(url).hostname;

    // Autoriser les domaines nécessaires à YouTube
    if (
      host.includes('youtube.com') ||
      host.includes('google.com') ||
      host.includes('gstatic.com') ||
      host.includes('ytimg.com') ||
      host.includes('googlevideo.com')
    ) {
      return false;
    }

    // Vérifier si c'est un domaine de pub
    return BLOCKED_DOMAINS.some(d => host.includes(d));

  } catch (e) {
    return false;
  }
}

const ADBLOCK_CSS = `
iframe[src*="ads"],
iframe[src*="doubleclick"],
iframe[src*="googlesyndication"],
[id*="ad-"],
[class*="ad-"],
[id*="ads"],
[class*="ads"]{
display:none!important;
visibility:hidden!important;
pointer-events:none!important;
}
`;
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// ── Optimisations performances ────────────────────────────────────
// GPU & rendu
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
// Un seul enable-features pour eviter les conflits
app.commandLine.appendSwitch('enable-features',
  'MediaSource,MediaSourceExperimental,VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization,UseSkiaRenderer'
);
// Réseau
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-tcp-fast-open');
// Mémoire
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512 --optimize-for-size');

// ── Démarrage ─────────────────────────────────────────────────────
app.whenReady().then(() => {

  const browserSess = session.fromPartition('persist:browser');

  // Injecter UA Chrome sur toutes les requetes reseau
  browserSess.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    delete details.requestHeaders['X-Requested-With'];
    cb({ requestHeaders: details.requestHeaders });
  });

  // Supprimer headers qui bloquent les ressources
  browserSess.webRequest.onHeadersReceived((details, cb) => {
    const h = Object.assign({}, details.responseHeaders);
    delete h['x-frame-options']; delete h['X-Frame-Options'];
    delete h['content-security-policy']; delete h['Content-Security-Policy'];
    cb({ responseHeaders: h });
  });

browserSess.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {

  if (!adblockEnabled) return cb({ cancel: false });

  const type = details.resourceType;

  // IMPORTANT : ne jamais bloquer les vidéos / audio
  if (
    type === "media" ||
    type === "video" ||
    type === "audio"
  ) {
    return cb({ cancel: false });
  }

  // Autoriser les domaines nécessaires à YouTube
  const safeDomains = [
    "youtube.com",
    "googlevideo.com",
    "ytimg.com",
    "google.com",
    "gstatic.com"
  ];

  if (safeDomains.some(d => details.url.includes(d))) {
    return cb({ cancel: false });
  }

  const blocked = BLOCKED_DOMAINS.some(d => details.url.includes(d));

  if (blocked) blockedCount++;

  cb({ cancel: blocked });

});

  const isMac = process.platform === 'darwin';

  win = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 900, minHeight: 600,
    // Sur macOS : titlebar natif transparent avec boutons trafic-light
    // Sur Windows : frame: false avec nos propres boutons
    frame:          isMac ? true : false,
    titleBarStyle:  isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 16 } : undefined,
    backgroundColor: '#0d0d1a',
    title: 'Novyss',
    webPreferences: {
      preload:                  path.join(__dirname, 'preload.js'),
      contextIsolation:         true,
      nodeIntegration:          false,
      partition:                'persist:browser',
      webSecurity:              true,
      autoplayPolicy:           'no-user-gesture-required',
      backgroundThrottling:     false,
      enableBlinkFeatures:      'CSSColorSchemeUARendering',
      disableHtmlFullscreenWindowResize: false,
    },
  });

  // Envoyer la plateforme au renderer pour adapter l'UI
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('platform', process.platform);
  });

  win.setMaxListeners(50);
  win.loadFile(path.join(__dirname, 'index.html'));

  // Initialiser le menu contextuel
  initMenuView();

  // Clic dans la sidebar/topbar → fermer le menu
  win.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'mouseDown') { _mouseDown = true; hideMenuView(); }
    if (input.type === 'mouseUp')   { _mouseDown = false; }
  });

  win.on('resize', () => {
    for (const [, v] of views) {
      if (v._visible) v.setBounds(getViewBounds());
    }
  });

  setupDownloads(win);

}); // fin whenReady

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Contrôles fenêtre ─────────────────────────────────────────────
ipcMain.on('win-close',    () => {
  if (process.platform === 'darwin') win?.hide();
  else win?.close();
});
ipcMain.on('win-minimize', () => win?.minimize());
ipcMain.on('win-maximize', () => {
  if (!win) return;
  if (process.platform === 'darwin') {
    win.isFullScreen() ? win.setFullScreen(false) : win.setFullScreen(true);
  } else {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  }
});

// macOS : recréer la fenêtre si on clique sur le dock
app.on('activate', () => {
  if (win) win.show();
});

// ═════════════════════════════════════════════════════════════════
// ONGLETS
// ═════════════════════════════════════════════════════════════════
ipcMain.handle('tab-create', (_, { tabId, url }) => {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation:         false,
      nodeIntegration:          false,
      partition:                'persist:browser',
      webSecurity:              false,
      backgroundThrottling:     false,
      autoplayPolicy:           'no-user-gesture-required',
      enableBlinkFeatures:      'CSSColorSchemeUARendering',
      v8CacheOptions:           'code',
    },
  })
  // Priorité CPU maximale pour cet onglet
  try { view.webContents.setFrameRate(144); } catch {}
  view._tabId   = tabId;
  view._visible = false;

  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  view.webContents.setUserAgent(CHROME_UA);

view.webContents.on('dom-ready', () => {

  view.webContents.insertCSS(ADBLOCK_CSS).catch(() => {});

  view.webContents.executeJavaScript(`
    document.querySelectorAll("a[target='_blank']").forEach(a=>{
      a.removeAttribute("target");
    });
  `);

});

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAd(url)) return { action: 'deny' };
    win.webContents.send('open-new-tab', url);
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (e, url) => {
    if (isAd(url)) { e.preventDefault(); blockedCount++; return; }
    // Vérifier les sites spéciaux — liste stockée en mémoire, mise à jour via IPC
    try {
      const host = new URL(url).hostname.replace('www.', '');
      const sites = extSitesList || ['youtube.com', 'netflix.com'];
      const match = sites.some(s => host === s.replace('www.','') || host.endsWith('.'+s.replace('www.','')));
      if (match) {
        e.preventDefault();
        win.webContents.send('ask-ext-site', { url });
      }
    } catch {}
  });

  view.webContents.on('enter-html-full-screen', () => {
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width: w, height: h });
    win.webContents.send('fullscreen', true);
  });
  view.webContents.on('leave-html-full-screen', () => {
    if (view._visible) view.setBounds(getViewBounds());
    win.webContents.send('fullscreen', false);
  });

  view.webContents.on('page-title-updated',   (_, t)    => win.webContents.send('view-event', { tabId, type: 'title',   value: t }));
  view.webContents.on('page-favicon-updated', (_, favs) => win.webContents.send('view-event', { tabId, type: 'favicon', value: favs[0] || null }));
  view.webContents.on('did-start-loading',    ()        => win.webContents.send('view-event', { tabId, type: 'loading', value: true }));
  view.webContents.on('did-stop-loading',     ()        => {
    win.webContents.send('view-event', { tabId, type: 'loading', value: false });
    win.webContents.send('view-event', { tabId, type: 'url',     value: view.webContents.getURL() });
  });
  view.webContents.on('did-navigate',         (_, u)    => win.webContents.send('view-event', { tabId, type: 'url', value: u }));
  view.webContents.on('did-navigate-in-page', (_, u)    => win.webContents.send('view-event', { tabId, type: 'url', value: u }));

  // Fermer le menu contextuel si on clique dans la WebView
  view.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'mouseDown') { _mouseDown = true; hideMenuView(); }
    if (input.type === 'mouseUp')   { _mouseDown = false; }
  });

  views.set(tabId, view);
  if (url) view.webContents.loadURL(url);
  return { ok: true };
});

ipcMain.handle('tab-navigate', (_, { tabId, url }) => {
  const v = views.get(tabId);
  if (!v) return { ok: false };
  v.webContents.loadURL(url);
  return { ok: true };
});

ipcMain.handle('tab-show', (_, { tabId }) => {
  for (const [id, v] of views) {
    if (id === tabId) {
      v.setBounds(getViewBounds());
      v._visible = true;
      win.contentView.addChildView(v);
    } else {
      v.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      v._visible = false;
    }
  }
  return { ok: true };
});

// Masquer la WebView active (pour panels/popups HTML au premier plan)
ipcMain.on('webview-hide', async () => {
  for (const [, v] of views) {
    if (v._visible) {
      try {
        const img = await v.webContents.capturePage();
        const dataUrl = 'data:image/png;base64,' + img.toPNG().toString('base64');
        win.webContents.send('webview-screenshot', dataUrl);
      } catch {}
      win.contentView.removeChildView(v);
      v._hidden_for_panel = true;
    }
  }
});

// Remettre la WebView
ipcMain.on('webview-show', () => {
  for (const [, v] of views) {
    if (v._hidden_for_panel) {
      v.setBounds(getViewBounds());
      win.contentView.addChildView(v);
      v._hidden_for_panel = false;
    }
  }
  win.webContents.send('webview-show-done');
});


ipcMain.handle('tab-hide', (_, { tabId }) => {
  const v = views.get(tabId);
  if (v) { v.setBounds({ x: 0, y: 0, width: 0, height: 0 }); v._visible = false; }
  return { ok: true };
});

ipcMain.handle('tab-close', (_, { tabId }) => {
  const v = views.get(tabId);
  if (v) {
    win.contentView.removeChildView(v);
    v.webContents.destroy();
    views.delete(tabId);
  }
  return { ok: true };
});

ipcMain.handle('tab-reload',  (_, { tabId }) => { const v = views.get(tabId); if (v) v.webContents.reload(); return { ok: true }; });
ipcMain.handle('tab-back',    (_, { tabId }) => { const v = views.get(tabId); if (v && v.webContents.navigationHistory.canGoBack())    v.webContents.navigationHistory.goBack();    return { ok: true }; });
ipcMain.handle('tab-forward', (_, { tabId }) => { const v = views.get(tabId); if (v && v.webContents.navigationHistory.canGoForward()) v.webContents.navigationHistory.goForward(); return { ok: true }; });
ipcMain.handle('tab-can-go',  (_, { tabId }) => {
  const v = views.get(tabId);
  if (!v) return { back: false, forward: false };
  return { back: v.webContents.navigationHistory.canGoBack(), forward: v.webContents.navigationHistory.canGoForward() };
});
ipcMain.handle('tab-suspend', (_, { tabId }) => {
  const v = views.get(tabId);
  if (!v) return { ok: false };
  const url = v.webContents.getURL();
  v.webContents.loadURL('about:blank');
  return { ok: true, url };
});
ipcMain.handle('tab-resume', (_, { tabId, url }) => {
  const v = views.get(tabId);
  if (v && url) v.webContents.loadURL(url);
  return { ok: true };
});


// ── Menu contextuel stylisé ──────────────────────────────────────
const MENU_W = 222, MENU_H = 260;

function initMenuView() {
  menuView = new WebContentsView({
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  menuView.setBackgroundColor('#00000000');
  menuView.webContents.loadFile(path.join(__dirname, 'ctx-menu.html'));
  menuView.webContents.once('did-finish-load', () => { _menuReady = true; });

  // Fermer si menuView perd le focus (clic en dehors)
  menuView.webContents.on('blur', () => {
    setTimeout(() => hideMenuView(), 50);
  });

  // Listener unique : résoudre la Promise avec l'action choisie
  ipcMain.on('ctx-menu-action', (_, action) => {
    const r = _menuResolve;
    _menuResolve = null;
    try { win.contentView.removeChildView(menuView); } catch {}
    menuView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    if (r) r({ action });
  });
}

ipcMain.handle('show-tab-ctx-menu', (_, { x, y, hasUrl, tabCount, theme }) => {
  // Fermer proprement un menu déjà ouvert
  if (_menuResolve) { const r = _menuResolve; _menuResolve = null; r({ action: null }); }

  return new Promise(resolve => {
    _menuResolve = resolve;

    const [winW, winH] = win.getContentSize();
    const mx = Math.min(x, winW - MENU_W - 4);
    const my = Math.min(y, winH - MENU_H - 4);

    try { win.contentView.removeChildView(menuView); } catch {}
    win.contentView.addChildView(menuView);
    menuView.setBounds({ x: mx, y: my, width: MENU_W, height: MENU_H });

    const sendInit = () => {
      menuView.webContents.send('ctx-init', { theme, hasUrl, tabCount });
      // Donner le focus à menuView pour que blur fonctionne
      menuView.webContents.focus();
    };
    if (_menuReady) { sendInit(); }
    else { menuView.webContents.once('did-finish-load', () => { _menuReady = true; sendInit(); }); }
    // Activer l'overlay dans le renderer
    if (win) try { win.webContents.send('ctx-menu-opened'); } catch {}

    // Polling souris : fermer si clic en dehors de menuView bounds
    const checkInterval = setInterval(() => {
      if (!_menuResolve) { clearInterval(checkInterval); return; }
      const { screen } = require('electron');
      const pos = screen.getCursorScreenPoint();
      const wb  = win.getBounds();
      const mb  = menuView.getBounds();
      // Coordonnées relatives à la fenêtre
      const rx  = pos.x - wb.x;
      const ry  = pos.y - wb.y;
      const inMenu = rx >= mb.x && rx <= mb.x + mb.width && ry >= mb.y && ry <= mb.y + mb.height;
      if (!inMenu) {
        // Vérifier si le bouton souris est pressé (via before-input ou flag global)
        if (_mouseDown) { clearInterval(checkInterval); hideMenuView(); }
      }
    }, 16);
  });
});

function hideMenuView() {
  if (!menuView) return;
  if (!_menuResolve) return; // déjà fermé
  const r = _menuResolve;
  _menuResolve = null;
  try { win.contentView.removeChildView(menuView); } catch {}
  menuView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  if (win) try { win.webContents.send('ctx-menu-closed'); } catch {}
  if (r) r({ action: null });
}




// ── Icône dynamique ────────────────────────────────────────────



// ── Wallpaper — sauvegarde sur disque ─────────────────────────────
// ── Adblock ───────────────────────────────────────────────────────
ipcMain.handle('adblock-toggle', () => { adblockEnabled = !adblockEnabled; return adblockEnabled; });
ipcMain.handle('adblock-state',  () => adblockEnabled);
ipcMain.handle('adblock-stats',  () => blockedCount);
ipcMain.handle('open-external',  (_, url) => { shell.openExternal(url); });

// ── Détection des navigateurs installés ──────────────────────────
ipcMain.handle('detect-browsers', async () => {
  const { execFile } = require('child_process');
  const fs2 = require('fs');
  const browsers = [];

  if (process.platform === 'win32') {
    const candidates = [
      { name: 'Google Chrome',         exe: 'chrome.exe',   paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'] },
      { name: 'Mozilla Firefox',       exe: 'firefox.exe',  paths: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe','C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'] },
      { name: 'Microsoft Edge',        exe: 'msedge.exe',   paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'] },
      { name: 'Brave',                 exe: 'brave.exe',    paths: ['C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe','C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'] },
      { name: 'Opera',                 exe: 'opera.exe',    paths: ['C:\\Program Files\\Opera\\opera.exe','C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Opera\\opera.exe'] },
      { name: 'Vivaldi',               exe: 'vivaldi.exe',  paths: ['C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe'] },
    ];
    for (const b of candidates) {
      const found = b.paths.find(p => fs2.existsSync(p));
      if (found) browsers.push({ name: b.name, path: found });
    }
  } else if (process.platform === 'darwin') {
    const candidates = [
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Firefox',       path: '/Applications/Firefox.app/Contents/MacOS/firefox' },
      { name: 'Safari',        path: '/Applications/Safari.app/Contents/MacOS/Safari' },
      { name: 'Brave',         path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      { name: 'Opera',         path: '/Applications/Opera.app/Contents/MacOS/Opera' },
    ];
    for (const b of candidates) {
      if (fs2.existsSync(b.path)) browsers.push({ name: b.name, path: b.path });
    }
  } else {
    // Linux
    const { execSync } = require('child_process');
    const cmds = ['google-chrome','chromium-browser','chromium','firefox','brave-browser','opera','vivaldi'];
    for (const cmd of cmds) {
      try {
        const p = execSync(`which ${cmd} 2>/dev/null`).toString().trim();
        if (p) browsers.push({ name: cmd.charAt(0).toUpperCase() + cmd.slice(1).replace(/-/g,' '), path: p });
      } catch {}
    }
  }
  return browsers;
});

ipcMain.handle('open-in-browser', (_, { browserPath, url }) => {
  const { spawn } = require('child_process');
  try {
    if (process.platform === 'darwin' && browserPath.endsWith('.app/Contents/MacOS/' + browserPath.split('/').pop())) {
      spawn('open', ['-a', browserPath.split('/Contents/')[0], url], { detached: true }).unref();
    } else {
      spawn(browserPath, [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ═════════════════════════════════════════════════════════════════
// COFFRE-FORT AES-256-GCM
// ═════════════════════════════════════════════════════════════════
const VAULT_PATH  = () => path.join(os.homedir(), '.novyss_vault');
const SALT_LEN = 32, IV_LEN = 16, TAG_LEN = 16, ITERATIONS = 210000, KEY_LEN = 32;

function deriveKey(pwd, salt) { return crypto.pbkdf2Sync(pwd, salt, ITERATIONS, KEY_LEN, 'sha256'); }

function encryptVault(data, pwd) {
  const salt = crypto.randomBytes(SALT_LEN), iv = crypto.randomBytes(IV_LEN);
  const c    = crypto.createCipheriv('aes-256-gcm', deriveKey(pwd, salt), iv);
  const ct   = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return Buffer.concat([salt, iv, c.getAuthTag(), ct]).toString('base64');
}

function decryptVault(b64, pwd) {
  const buf  = Buffer.from(b64, 'base64');
  const salt = buf.slice(0, SALT_LEN);
  const iv   = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const tag  = buf.slice(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ct   = buf.slice(SALT_LEN + IV_LEN + TAG_LEN);
  const d    = crypto.createDecipheriv('aes-256-gcm', deriveKey(pwd, salt), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}

ipcMain.handle('vault-exists',     ()                   => fs.existsSync(VAULT_PATH()));
ipcMain.handle('vault-create',     (_, pwd)             => { try { fs.writeFileSync(VAULT_PATH(), encryptVault({ entries: [], createdAt: Date.now() }, pwd)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('vault-open',       (_, pwd)             => { try { return { ok: true, data: decryptVault(fs.readFileSync(VAULT_PATH(), 'utf8'), pwd) }; } catch { return { ok: false, error: 'Mot de passe incorrect' }; } });
ipcMain.handle('vault-save',       (_, { pwd, data })   => { try { fs.writeFileSync(VAULT_PATH(), encryptVault(data, pwd)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('vault-change-pwd', (_, { oldPwd, newPwd }) => {
  try {
    const data = decryptVault(fs.readFileSync(VAULT_PATH(), 'utf8'), oldPwd);
    fs.writeFileSync(VAULT_PATH(), encryptVault(data, newPwd));
    return { ok: true };
  } catch { return { ok: false, error: 'Mot de passe actuel incorrect' }; }
});

// ── Sites spéciaux (liste synchronisée depuis le renderer) ────────
let extSitesList = ['youtube.com', 'netflix.com'];
ipcMain.on('set-ext-sites', (_, sites) => { extSitesList = sites || []; });

// ── Téléchargements ───────────────────────────────────────────────
const crypto2 = require('crypto');

function setupDownloads(win) {
  session.defaultSession.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const savePath = path.join(app.getPath('downloads'), filename);
    item.setSavePath(savePath);
    const dlId = Date.now().toString();
    win.webContents.send('dl-started', { id: dlId, filename, savePath });

    item.on('updated', (_, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total    = item.getTotalBytes();
        const pct      = total > 0 ? Math.round(received / total * 100) : -1;
        win.webContents.send('dl-progress', { id: dlId, pct, received, total });
      }
    });

    item.once('done', async (_, state) => {
      if (state === 'completed') {
        // Calcul hash SHA256
        try {
          const data = fs.readFileSync(savePath);
          const hash = crypto2.createHash('sha256').update(data).digest('hex');
          win.webContents.send('dl-done', { id: dlId, filename, savePath, hash, ok: true });
          // Scan VirusTotal si clé configurée
          // (l'API key doit être ajoutée dans settings)
        } catch {
          win.webContents.send('dl-done', { id: dlId, filename, savePath, hash: null, ok: false });
        }
      } else {
        win.webContents.send('dl-done', { id: dlId, filename, savePath: null, ok: false, cancelled: true });
      }
    });
  });
}

ipcMain.handle('dl-open-folder', (_, { savePath }) => {
  if (savePath) shell.showItemInFolder(savePath);
});
ipcMain.handle('dl-open-file',   (_, { savePath }) => {
  if (savePath) shell.openPath(savePath);
});
ipcMain.handle('vt-scan', async (_, { hash, apiKey }) => {
  if (!apiKey || !hash) return { ok: false };
  try {
    const https = require('https');
    const result = await new Promise((res, rej) => {
      const req = https.get({
        hostname: 'www.virustotal.com',
        path: `/api/v3/files/${hash}`,
        headers: { 'x-apikey': apiKey }
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      });
      req.on('error', rej);
      setTimeout(() => rej(new Error('timeout')), 8000);
    });
    const stats = result?.data?.attributes?.last_analysis_stats;
    if (!stats) return { ok: false };
    return { ok: true, malicious: stats.malicious || 0, suspicious: stats.suspicious || 0, undetected: stats.undetected || 0 };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Enregistrement du download handler lors de la création de la fenêtre est fait dans whenReady
// mais on l'expose aussi via ipc pour init tardive
ipcMain.on('init-downloads', () => { if (win) setupDownloads(win); });

// ── Détection mots de passe ───────────────────────────────────────
ipcMain.handle('pwd-detect-save-entry', (_, { site, username, password, masterPwd }) => {
  try {
    let data = { entries: [] };
    if (fs.existsSync(VAULT_PATH())) {
      data = decryptVault(fs.readFileSync(VAULT_PATH(), 'utf8'), masterPwd);
    }
    const existing = data.entries.findIndex(e => e.site === site && e.login === username);
    if (existing >= 0) {
      data.entries[existing] = { ...data.entries[existing], password, updatedAt: Date.now() };
    } else {
      data.entries.unshift({ site, login: username, password, createdAt: Date.now() });
    }
    fs.writeFileSync(VAULT_PATH(), encryptVault(data, masterPwd));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('pwd-get-for-site', (_, { site, masterPwd }) => {
  try {
    if (!fs.existsSync(VAULT_PATH())) return { ok: true, entries: [] };
    const data = decryptVault(fs.readFileSync(VAULT_PATH(), 'utf8'), masterPwd);
    const host = (() => { try { return new URL(site.startsWith('http') ? site : 'https://'+site).hostname; } catch { return site; } })();
    const entries = (data.entries || []).filter(e => {
      try { return new URL(e.site.startsWith('http') ? e.site : 'https://'+e.site).hostname.includes(host) || host.includes(new URL(e.site.startsWith('http') ? e.site : 'https://'+e.site).hostname); } catch { return e.site.includes(host); }
    });
    return { ok: true, entries };
  } catch { return { ok: false, entries: [] }; }
});
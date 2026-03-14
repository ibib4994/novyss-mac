'use strict';

/* ═══════════════════════════════════════════════
   NOVYSS — app.js
   ═══════════════════════════════════════════════ */

// ── État global ──────────────────────────────────
let tabs     = [];
let activeId = null;

let history_ = JSON.parse(localStorage.getItem('h') || '[]');
let settings = JSON.parse(localStorage.getItem('s') || '{}');

// Appliquer on-home immédiatement (avant tout rendu)
document.body.classList.add('on-home');

// Détection plateforme — adapter l'UI
const _isMac = window.api.platform?.() === 'darwin';
if (_isMac) {
  document.body.classList.add('platform-mac');
  // Sur macOS, les boutons trafic-light sont natifs — cacher nos boutons custom
  const wc = document.getElementById('win-controls');
  if (wc) wc.style.display = 'none';
  // Ajouter padding-left à la topbar pour ne pas empiéter sur les boutons natifs
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.style.paddingLeft = '80px';
}
window.api.onPlatform?.(p => {
  if (p === 'darwin') {
    document.body.classList.add('platform-mac');
  }
});
let sidebarHidden = settings.sidebarHidden || false;

let vaultData    = null;
let masterPwd    = null;
let vaultEditIdx = null;

// ── DOM helpers ──────────────────────────────────
const $ = id => document.getElementById(id);

const tabsList = $('tabs-list');
const urlInput = $('url-input');
const homeEl   = $('home');
const overlay  = $('overlay');

// ── Utils ─────────────────────────────────────────
function saveSettings() {
  localStorage.setItem('s', JSON.stringify(settings));
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildURL(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[^\s]{2,}$/.test(s)) return 'https://' + s;
  return (settings.se || 'https://www.google.com/search?q=') + encodeURIComponent(s);
}

function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function genPwd() {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  return Array.from({ length: 18 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}


// ── Panneaux ──────────────────────────────────────
// Les WebContentsView (YouTube etc.) sont natives et passent TOUJOURS
// au-dessus du HTML. On les masque a l'ouverture du panneau.
function openPanel(id) {
  document.querySelectorAll('.side-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.settings-overlay').forEach(p => p.classList.add('hidden'));
  overlay.classList.remove('hidden');
  const p = $(id);
  if (p) p.classList.remove('hidden');
  // Les paramètres sont en plein écran, pas besoin de réduire la WebView
  if (id !== 'panel-settings') window.api.panelOpen({ panelW: 370 });
}

function closeAllPanels() {
  document.querySelectorAll('.side-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.settings-overlay').forEach(p => p.classList.add('hidden'));
  overlay.classList.add('hidden');
  window.api.panelClose();
}

overlay.addEventListener('click', closeAllPanels);

// ── Thème ─────────────────────────────────────────
function applyTheme(name) {
  document.body.className = document.body.className
    .split(' ').filter(c => !c.startsWith('theme-')).join(' ').trim();
  if (name && name !== 'dark') document.body.classList.add('theme-' + name);
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === name)
  );
  settings.theme = name;
  saveSettings();
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  // Marquer le swatch preset actif, ou le swatch custom si couleur libre
  const presets = [...document.querySelectorAll('.swatch[data-color]')];
  const isPreset = presets.some(b => b.dataset.color === color);
  presets.forEach(b => b.classList.toggle('active', b.dataset.color === color));
  const customLabel = $('swatch-custom-label');
  if (customLabel) customLabel.classList.toggle('active', !isPreset);
  const customInput = $('accent-custom');
  if (customInput) customInput.value = color;
  settings.accent = color;
  saveSettings();
}

function applyGlass(val) {
  document.documentElement.style.setProperty('--glass-opacity', val / 100);
  const gv = $('glass-value');
  if (gv) gv.textContent = val + '%';
  settings.glass = val;
  saveSettings();
}

// ── Horloge ───────────────────────────────────────
function updateClock() {
  const tz      = settings.timezone;
  const showSec = settings.clockSeconds !== false; // true par défaut
  const now     = new Date();
  const tOpts   = showSec
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', hour12: false };
  const dOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const tEl   = $('home-time');
  const dEl   = $('home-date');
  try {
    if (tEl) tEl.textContent = tz && tz !== 'local'
      ? now.toLocaleTimeString('fr-FR', { ...tOpts, timeZone: tz })
      : now.toLocaleTimeString('fr-FR', tOpts);
    if (dEl) dEl.textContent = tz && tz !== 'local'
      ? now.toLocaleDateString('fr-FR', { ...dOpts, timeZone: tz })
      : now.toLocaleDateString('fr-FR', dOpts);
  } catch (e) {
    if (tEl) tEl.textContent = now.toLocaleTimeString('fr-FR', tOpts);
    if (dEl) dEl.textContent = now.toLocaleDateString('fr-FR', dOpts);
  }
}
setInterval(updateClock, 1000);
updateClock();

// ── Onglets ───────────────────────────────────────
function tabByID(id) { return tabs.find(t => t.id === id); }
function activeTab() { return tabByID(activeId); }

function renderTabs() {
  tabsList.innerHTML = '';
  tabs.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeId ? ' active' : '');
    el.dataset.id = t.id;
    let favHtml;
    if (t.loading) {
      favHtml = '<span class="tab-fav" style="opacity:.5">↻</span>';
    } else if (t.favicon) {
      favHtml = '<span class="tab-fav"><img src="' + esc(t.favicon) + '" /></span>';
    } else if (t.url) {
      favHtml = '<span class="tab-fav">🌐</span>';
    } else {
      favHtml = '<span class="tab-fav">✦</span>';
    }
    el.innerHTML = favHtml +
      '<span class="tab-title">' + esc(t.title || 'Nouvel onglet') + '</span>' +
      '<button class="tab-close">✕</button>';
    el.addEventListener('click', () => switchTab(t.id));
    el.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      closeTab(t.id);
    });
    el.addEventListener('contextmenu', async e => {
      e.preventDefault();
      const tab = tabByID(t.id);
      const result = await window.api.showTabCtxMenu({
        x:        e.clientX,
        y:        e.clientY,
        hasUrl:   !!(tab && tab.url),
        tabCount: tabs.length,
        theme:    settings.theme || 'dark',
      });
      if (!result || !result.action) return;
      await handleTabCtxAction(result.action, t.id);
    });
    tabsList.appendChild(el);
  });
}

async function createTab(url) {
  const id = 'tab-' + Date.now();
  tabs.push({ id, url: url || null, title: 'Nouvel onglet' });
  await window.api.tabCreate({ tabId: id, url: url || null });
  switchTab(id);
}

async function switchTab(id) {
  const t = tabByID(id);
  if (!t) return;
  // Sauvegarder la recherche en cours sur l'onglet actif si c'est un onglet vide
  if (activeId && activeId !== id) {
    const prev = tabByID(activeId);
    if (prev && !prev.url) {
      const hs = $('home-search-input');
      if (hs) prev.homeSearch = hs.value;
    }
    await window.api.tabHide({ tabId: activeId });
  }
  activeId = id;

  // Si l'onglet était suspendu, le relancer
  if (t.suspended && t.suspendedUrl) {
    t.suspended = false;
    t.url = t.suspendedUrl;
    t.suspendedUrl = null;
    homeEl.style.display = 'none';
    document.body.classList.remove('on-home');
    await window.api.tabNavigate({ tabId: id, url: t.url });
    await window.api.tabShow({ tabId: id });
  } else if (t.url) {
    homeEl.style.display = 'none';
    await window.api.tabShow({ tabId: id });
  } else {
    homeEl.style.display = 'flex';
    document.body.classList.add('on-home');
    // Restaurer la recherche sauvegardée pour cet onglet
    const hs = $('home-search-input');
    if (hs) {
      hs.value = t.homeSearch || '';
      if (t.homeSearch) setTimeout(() => hs.focus(), 50);
    }
  }
  updateBar();
  renderTabs();
}

async function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;
  await window.api.tabClose({ tabId: id });
  tabs.splice(index, 1);
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) switchTab(tabs[Math.max(0, index - 1)].id);
  else renderTabs();
}

async function navigate(url) {
  // Vérifier si le site demande une confirmation de navigateur
  if (typeof shouldAskExternal === 'function' && shouldAskExternal(url)) {
    showExtPopup(url);
    return;
  }
  const t = activeTab();
  if (!t) { createTab(url); return; }
  t.url = url;
  homeEl.style.display = 'none';
  await window.api.tabNavigate({ tabId: t.id, url });
  await window.api.tabShow({ tabId: t.id });
  addHistory(url, t.title || '');
}

function addHistory(url, title) {
  history_.unshift({ url, title, ts: Date.now() });
  if (history_.length > 500) history_.length = 500;
  localStorage.setItem('h', JSON.stringify(history_));
}

function updateBar() {
  const t = activeTab();
  urlInput.value = (t && t.url) ? t.url : '';
  updateNavBtns();
}

async function updateNavBtns() {
  const t = activeTab();
  if (!t) {
    $('btn-back').disabled = true;
    $('btn-forward').disabled = true;
    return;
  }
  const { back, forward } = await window.api.tabCanGo({ tabId: t.id });
  $('btn-back').disabled    = !back;
  $('btn-forward').disabled = !forward;
}

// ── Événements main ───────────────────────────────
window.api.onViewEvent(({ tabId, type, value }) => {
  const t = tabByID(tabId);
  if (!t) return;
  if (type === 'title')   { t.title = value; renderTabs(); }
  if (type === 'favicon') { t.favicon = value; renderTabs(); }
  if (type === 'url')     { t.url   = value; if (tabId === activeId) { updateBar(); updateBookmarkBtn(); } }
  if (type === 'loading') {
    t.loading = !!value;
    renderTabs();
    if (!value && tabId === activeId && t.url) addHistory(t.url, t.title || '');
  }
});

window.api.onOpenNewTab(url => createTab(url));

// ── Boutons fenêtre ───────────────────────────────
$('btn-close').addEventListener('click', () => window.api.close());
$('btn-min').addEventListener('click',   () => window.api.minimize());
$('btn-max').addEventListener('click',   () => window.api.maximize());

// ── Sidebar toggle ────────────────────────────────
function applySidebar() {
  document.body.classList.toggle('sb-hidden', sidebarHidden);
  sendDims();
}

$('btn-sidebar-toggle').addEventListener('click', () => {
  sidebarHidden = !sidebarHidden;
  settings.sidebarHidden = sidebarHidden;
  saveSettings();
  applySidebar();
});

// ── Navigation ────────────────────────────────────
$('btn-back').addEventListener('click', () => {
  const t = activeTab(); if (t) window.api.tabBack({ tabId: t.id });
});
$('btn-forward').addEventListener('click', () => {
  const t = activeTab(); if (t) window.api.tabForward({ tabId: t.id });
});
$('btn-reload').addEventListener('click', () => {
  const t = activeTab(); if (t) window.api.tabReload({ tabId: t.id });
});

// ── URL input ─────────────────────────────────────
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const u = buildURL(urlInput.value);
    if (u) navigate(u);
    urlInput.blur();
  }
});

// ── Bouton adblock topbar ─────────────────────────
$('btn-adblock').addEventListener('click', async () => {
  const on = await window.api.adblockToggle();
  toast('Adblock ' + (on ? 'activé ✓' : 'désactivé'));
  $('btn-adblock').style.opacity = on ? '1' : '0.4';
  const chk = $('adblock-toggle');
  if (chk) chk.checked = on;
});

// ── Bouton traduire ───────────────────────────────
$('btn-translate').addEventListener('click', () => {
  const t = activeTab();
  if (t && t.url) navigate('https://translate.google.com/translate?sl=auto&tl=fr&u=' + encodeURIComponent(t.url));
});

// ── Nouvel onglet ─────────────────────────────────
$('btn-new-tab').addEventListener('click', () => createTab());

// ── Quick links dynamiques ─────────────────────────────────────────
const DEFAULT_QL = [
  { id:'ql-google',  name:'Google',  url:'https://google.com',  icon:'G',  color:'' },
  { id:'ql-yt',      name:'YouTube', url:'https://youtube.com', icon:'▶',  color:'#ff4444' },
  { id:'ql-github',  name:'GitHub',  url:'https://github.com',  icon:'⌥',  color:'' },
  { id:'ql-reddit',  name:'Reddit',  url:'https://reddit.com',  icon:'r/', color:'#ff4500' },
  { id:'ql-twitch',  name:'Twitch',  url:'https://twitch.tv',   icon:'▮',  color:'#9147ff' },
  { id:'ql-twitter', name:'Twitter', url:'https://twitter.com', icon:'𝕏',  color:'' },
  { id:'ql-netflix', name:'Netflix', url:'https://netflix.com', icon:'N',  color:'#e50914' },
  { id:'ql-discord', name:'Discord', url:'https://discord.com', icon:'💬', color:'#5865f2' },
];

function getQL() {
  return settings.quickLinks || DEFAULT_QL;
}
function saveQL(list) {
  settings.quickLinks = list;
  saveSettings();
}

let _qlEditId   = null; // null = ajout, string = édition
let _qlEditMode = 'add'; // 'add' | 'edit'

function renderQL() {
  const container = $('quick-links');
  if (!container) return;
  const list = getQL();
  container.innerHTML = '';

  list.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'ql';
    btn.dataset.url = item.url;
    btn.innerHTML = `
      <div class="ql-icon" style="${item.color ? 'color:'+item.color : ''}">${item.icon}</div>
      <span>${item.name}</span>
    `;

    // Clic normal → naviguer avec vérification site spécial
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ql-del') || e.target.closest('.ql-edit-btn')) return;
      const url = item.url;
      if (window._qlNavigateExt) window._qlNavigateExt(url);
      else navigate(url);
    });

    // Clic droit → éditer
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      openQLEdit('edit', item);
    });

    // Hover : afficher boutons éditer/supprimer
    const actions = document.createElement('div');
    actions.style.cssText = 'position:absolute;top:3px;right:3px;display:flex;gap:3px;opacity:0;transition:opacity .15s;';

    const editBtn = document.createElement('button');
    editBtn.className = 'ql-edit-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Modifier';
    editBtn.style.cssText = 'font-size:10px;padding:2px 4px;border-radius:5px;background:rgba(0,0,0,.6);border:none;cursor:pointer;';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openQLEdit('edit', item); });

    const delBtn = document.createElement('button');
    delBtn.className = 'ql-del';
    delBtn.textContent = '✕';
    delBtn.title = 'Supprimer';
    delBtn.style.cssText = 'font-size:10px;padding:2px 4px;border-radius:5px;background:rgba(200,50,50,.7);color:#fff;border:none;cursor:pointer;';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      const list = getQL();
      saveQL(list.filter(q => q.id !== item.id));
      renderQL();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    btn.style.position = 'relative';
    btn.appendChild(actions);
    btn.addEventListener('mouseenter', () => actions.style.opacity = '1');
    btn.addEventListener('mouseleave', () => actions.style.opacity = '0');

    container.appendChild(btn);
  });

  // Bouton "+" pour ajouter
  const addBtn = document.createElement('button');
  addBtn.className = 'ql';
  addBtn.style.opacity = '.5';
  addBtn.innerHTML = '<div class="ql-icon">＋</div><span>Ajouter</span>';
  addBtn.addEventListener('click', () => openQLEdit('add', null));
  container.appendChild(addBtn);
}

function openQLEdit(mode, item) {
  _qlEditMode = mode;
  _qlEditId   = item?.id || null;
  const popup = $('ql-edit-popup');
  const title = $('ql-edit-title');
  if (!popup) return;
  $('ql-edit-name').value = item?.name  || '';
  $('ql-edit-url').value  = item?.url   || 'https://';
  $('ql-edit-icon').value = item?.icon  || '';
  if (title) title.textContent = mode === 'edit' ? 'Modifier le raccourci' : 'Ajouter un raccourci';
  popup.style.display = 'flex';
  $('ql-edit-name').focus();
}

function closeQLEdit() {
  const popup = $('ql-edit-popup');
  if (popup) popup.style.display = 'none';
}

$('ql-edit-cancel').addEventListener('click', closeQLEdit);
$('ql-edit-popup').addEventListener('click', e => { if (e.target === $('ql-edit-popup')) closeQLEdit(); });

$('ql-edit-save').addEventListener('click', () => {
  const name = $('ql-edit-name').value.trim();
  let   url  = $('ql-edit-url').value.trim();
  const icon = $('ql-edit-icon').value.trim() || name.charAt(0).toUpperCase();
  if (!name || !url) { toast('Nom et URL requis'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const list = getQL();
  if (_qlEditMode === 'edit' && _qlEditId) {
    const idx = list.findIndex(q => q.id === _qlEditId);
    if (idx !== -1) list[idx] = { ...list[idx], name, url, icon };
  } else {
    list.push({ id: 'ql-' + Date.now(), name, url, icon, color: '' });
  }
  saveQL(list);
  renderQL();
  closeQLEdit();
  toast(_qlEditMode === 'edit' ? '✓ Raccourci modifié' : '✓ Raccourci ajouté');
});

// Touche Entrée dans le popup
[$('ql-edit-name'), $('ql-edit-url'), $('ql-edit-icon')].forEach(el => {
  el?.addEventListener('keydown', e => { if (e.key === 'Enter') $('ql-edit-save').click(); });
});

renderQL();


// ── Home search ───────────────────────────────────
$('home-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const u = buildURL($('home-search-input').value);
    if (u) navigate(u);
  }
});
$('home-search-btn').addEventListener('click', () => {
  const u = buildURL($('home-search-input').value);
  if (u) navigate(u);
});

// ══════════════════════════════════════════════════
// HISTORIQUE
// ══════════════════════════════════════════════════
$('btn-history').addEventListener('click', () => {
  renderHistory();
  openPanel('panel-history');
});

$('close-history').addEventListener('click', closeAllPanels);

function renderHistory(filter) {
  const list = $('history-list');
  if (!list) return;
  const items = filter
    ? history_.filter(h => (h.url || '').includes(filter) || (h.title || '').toLowerCase().includes(filter.toLowerCase()))
    : history_;
  if (!items.length) {
    list.innerHTML = '<p class="empty-state">Aucun historique</p>';
    return;
  }
  list.innerHTML = items.map((h, i) => `
    <div class="h-item" data-i="${i}">
      <div class="h-info">
        <div class="h-title">${esc(h.title || h.url)}</div>
        <div class="h-url">${esc(h.url)}</div>
      </div>
      <div class="h-time">${new Date(h.ts).toLocaleString('fr-FR')}</div>
    </div>
  `).join('');
  list.querySelectorAll('.h-item').forEach(el => {
    el.addEventListener('click', () => {
      navigate(items[+el.dataset.i].url);
      closeAllPanels();
    });
  });
}

$('history-search').addEventListener('input', e => renderHistory(e.target.value));

$('btn-clear-history').addEventListener('click', () => {
  history_ = [];
  localStorage.setItem('h', '[]');
  renderHistory();
  toast('Historique effacé');
});

// ══════════════════════════════════════════════════
// PARAMÈTRES
// ══════════════════════════════════════════════════
$('btn-settings').addEventListener('click', () => {
  const se = $('search-engine');
  if (se) se.value = settings.se || 'https://www.google.com/search?q=';
  const hp = $('homepage-input');
  if (hp) hp.value = settings.homepage || '';
  const gs = $('glass-slider');
  if (gs) { gs.value = settings.glass ?? 60; $('glass-value').textContent = gs.value + '%'; }
  const st = $('settings-timezone');
  if (st) st.value = settings.timezone || 'local';
  openPanel('panel-settings');
});

$('close-settings').addEventListener('click', closeAllPanels);

// ── Navigation onglets paramètres ─────────────────────────────
document.querySelectorAll('.snav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.snav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tabEl = $('stab-' + tab);
    if (tabEl) tabEl.classList.add('active');
    // Remettre le scroll en haut
    const content = document.querySelector('.settings-content');
    if (content) content.scrollTop = 0;
  });
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

document.querySelectorAll('.swatch[data-color]').forEach(btn => {
  btn.addEventListener('click', () => applyAccent(btn.dataset.color));
});

// Color picker couleur libre
$('accent-custom')?.addEventListener('input', e => applyAccent(e.target.value));
$('swatch-custom-label')?.addEventListener('click', () => $('accent-custom')?.click());

$('glass-slider').addEventListener('input', e => applyGlass(+e.target.value));

$('settings-timezone').addEventListener('change', e => {
  settings.timezone = e.target.value;
  saveSettings();
  const tz = $('timezone-select');
  if (tz) tz.value = e.target.value;
});

$('clock-seconds').addEventListener('change', e => {
  settings.clockSeconds = e.target.checked;
  saveSettings();
  updateClock();
});

$('search-engine').addEventListener('change', e => {
  settings.se = e.target.value;
  saveSettings();
});

$('homepage-input').addEventListener('change', e => {
  settings.homepage = e.target.value.trim();
  saveSettings();
});

$('adblock-toggle').addEventListener('change', async () => {
  const on = await window.api.adblockToggle();
  $('btn-adblock').style.opacity = on ? '1' : '0.4';
});

function applyWcStyle(style) {
  const wc    = $('win-controls');
  const sbTop = $('sb-top');
  if (!wc) return;
  wc.dataset.style = style;

  const close = $('btn-close');
  const min   = $('btn-min');
  const max   = $('btn-max');
  if (!close || !min || !max) return;

  if (style === 'windows') {
    document.body.classList.add('wc-windows');
    const main = document.querySelector('main') || document.body;
    if (wc.parentElement !== main) main.appendChild(wc);
    // Ordre Windows : ─ □ ✕
    wc.appendChild(min);
    wc.appendChild(max);
    wc.appendChild(close);
  } else {
    document.body.classList.remove('wc-windows');
    if (sbTop && wc.parentElement !== sbTop) sbTop.prepend(wc);
    // Ordre Mac : ✕ ─ □
    wc.appendChild(close);
    wc.appendChild(min);
    wc.appendChild(max);
  }
}

document.querySelectorAll('.wc-style-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const style = btn.dataset.wc;
    applyWcStyle(style);
    document.querySelectorAll('.wc-style-btn').forEach(b =>
      b.classList.toggle('active', b === btn)
    );
    settings.wcStyle = style;
    saveSettings();
  });
});

// ══════════════════════════════════════════════════
// COFFRE-FORT
// ══════════════════════════════════════════════════
$('btn-vault').addEventListener('click', () => openVaultPanel());
$('close-vault').addEventListener('click', closeAllPanels);

async function openVaultPanel() {
  const exists = await window.api.vaultExists();
  if (vaultData) {
    $('vault-lock').style.display = 'none';
    $('vault-form').style.display = 'none';
    $('vault-main').style.display = 'flex';
    renderVaultList();
  } else {
    $('vault-lock').style.display = 'flex';
    $('vault-main').style.display = 'none';
    $('vault-form').style.display = 'none';
    $('vl-sub').textContent = exists ? 'Entrez votre mot de passe maître' : 'Créez votre mot de passe maître';
    $('btn-vault-unlock').textContent = exists ? '🔓 Déverrouiller' : '🔐 Créer le coffre';
    $('master-input').value = '';
    $('vl-error').textContent = '';
  }
  openPanel('panel-vault');
}

$('btn-vault-unlock').addEventListener('click', async () => {
  const pwd = $('master-input').value;
  if (!pwd) return;
  const exists = await window.api.vaultExists();
  if (!exists) {
    const r = await window.api.vaultCreate(pwd);
    if (!r.ok) { $('vl-error').textContent = r.error; return; }
  }
  const r = await window.api.vaultOpen(pwd);
  if (!r.ok) {
    $('vl-error').textContent = r.error;
    setTimeout(() => { $('vl-error').textContent = ''; }, 3000);
    return;
  }
  masterPwd = pwd;
  vaultData = r.data;
  $('vault-lock').style.display = 'none';
  $('vault-main').style.display = 'flex';
  $('vault-form').style.display = 'none';
  renderVaultList();
});

$('master-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btn-vault-unlock').click();
});

function renderVaultList(filter) {
  const list = $('vault-list');
  if (!list || !vaultData) return;
  const entries = vaultData.entries || [];
  const items = filter
    ? entries.filter(e => (e.site || '').toLowerCase().includes(filter) || (e.user || '').toLowerCase().includes(filter))
    : entries;
  if (!items.length) {
    list.innerHTML = '<p class="empty-state">Aucune entrée</p>';
    return;
  }
  list.innerHTML = items.map((e, i) => `
    <div class="ve" data-i="${i}">
      <div class="ve-info">
        <div class="ve-site">${esc(e.site || '—')}</div>
        <div class="ve-user">${esc(e.user || '—')}</div>
      </div>
      <div class="ve-actions">
        <button title="Copier le MDP">📋</button>
        <button title="Modifier">✏️</button>
        <button title="Supprimer">🗑</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.ve').forEach(el => {
    const i     = +el.dataset.i;
    const entry = items[i];
    const realI = entries.indexOf(entry);
    const [btnCopy, btnEdit, btnDel] = el.querySelectorAll('button');
    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(entry.pwd || '');
      toast('Mot de passe copié');
    });
    btnEdit.addEventListener('click', () => openVaultForm(realI));
    btnDel.addEventListener('click', async () => {
      entries.splice(realI, 1);
      await saveVault();
      renderVaultList(filter);
    });
    el.querySelector('.ve-site').addEventListener('click', () => {
      if (entry.url) { navigate(entry.url); closeAllPanels(); }
    });
  });
}

$('vault-search').addEventListener('input', e => renderVaultList(e.target.value.toLowerCase()));
$('btn-vault-add').addEventListener('click', () => openVaultForm(null));

function openVaultForm(idx) {
  vaultEditIdx = idx;
  const entry  = (idx !== null && idx >= 0) ? (vaultData.entries[idx] || {}) : {};
  $('vf-title').textContent = (idx !== null) ? "Modifier l'entrée" : 'Nouvelle entrée';
  $('vf-site').value = entry.site || '';
  $('vf-user').value = entry.user || '';
  $('vf-pwd').value  = entry.pwd  || '';
  $('vf-url').value  = entry.url  || '';
  $('vault-lock').style.display = 'none';
  $('vault-main').style.display = 'none';
  $('vault-form').style.display = 'flex';
}

$('close-vault-form').addEventListener('click', showVaultMain);
$('btn-vf-cancel').addEventListener('click',    showVaultMain);

function showVaultMain() {
  $('vault-lock').style.display = 'none';
  $('vault-main').style.display = 'flex';
  $('vault-form').style.display = 'none';
  renderVaultList();
}

$('btn-toggle-pwd').addEventListener('click', () => {
  const inp = $('vf-pwd');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('btn-gen-pwd').addEventListener('click', () => {
  $('vf-pwd').value = genPwd();
  $('vf-pwd').type  = 'text';
});

$('btn-vf-save').addEventListener('click', async () => {
  const entry = {
    site: $('vf-site').value.trim(),
    user: $('vf-user').value.trim(),
    pwd:  $('vf-pwd').value,
    url:  $('vf-url').value.trim(),
  };
  if (!entry.site && !entry.user) { toast("Renseignez le site ou l'identifiant"); return; }
  if (vaultEditIdx !== null && vaultEditIdx >= 0) {
    vaultData.entries[vaultEditIdx] = entry;
  } else {
    vaultData.entries.unshift(entry);
  }
  await saveVault();
  showVaultMain();
  toast('Entrée enregistrée');
});

async function saveVault() {
  await window.api.vaultSave({ pwd: masterPwd, data: vaultData });
}

$('btn-vault-lock').addEventListener('click', () => {
  vaultData = null;
  masterPwd = null;
  openVaultPanel();
});

$('btn-change-master').addEventListener('click', async () => {
  const np = prompt('Nouveau mot de passe maître :');
  if (!np) return;
  const r = await window.api.vaultChangePwd({ oldPwd: masterPwd, newPwd: np });
  if (r.ok) { masterPwd = np; toast('Mot de passe maître changé'); }
  else toast('Erreur : ' + r.error);
});

// ══════════════════════════════════════════════════
// MENU CONTEXTUEL ONGLETS
// ══════════════════════════════════════════════════
// Menu contextuel natif — actions
async function handleTabCtxAction(action, id) {
  const t = tabByID(id);
  switch (action) {
    case 'new-tab':
      createTab();
      break;
    case 'duplicate':
      if (t && t.url) createTab(t.url);
      break;
    case 'reload':
      if (t) window.api.tabReload({ tabId: id });
      break;
    case 'suspend':
      if (t && t.url) {
        t.suspended = true;
        t.suspendedUrl = t.url;
        await window.api.tabSuspend({ tabId: id });
        toast('Onglet suspendu 💤');
        renderTabs();
      }
      break;
    case 'close':
      closeTab(id);
      break;
    case 'close-others': {
      const toClose = tabs.filter(x => x.id !== id).map(x => x.id);
      if (activeId !== id) await switchTab(id);
      for (const tid of toClose) {
        const idx = tabs.findIndex(x => x.id === tid);
        if (idx === -1) continue;
        await window.api.tabClose({ tabId: tid });
        tabs.splice(idx, 1);
      }
      renderTabs();
      updateBar();
      toast('Autres onglets fermés');
      break;
    }
  }
}

// ══════════════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════════════
applyTheme(settings.theme   || 'dark');
applyAccent(settings.accent || '#a78bfa');
applyGlass(settings.glass   ?? 60);

if (settings.wcStyle) {
  applyWcStyle(settings.wcStyle);
  document.querySelectorAll('.wc-style-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.wc === settings.wcStyle)
  );
}
if (settings.se) {
  const se = $('search-engine'); if (se) se.value = settings.se;
}
if (settings.homepage) {
  const hp = $('homepage-input'); if (hp) hp.value = settings.homepage;
}
if (settings.timezone) {
  const tz1 = $('timezone-select');  if (tz1) tz1.value = settings.timezone;
  const tz2 = $('settings-timezone'); if (tz2) tz2.value = settings.timezone;
}
const clockSecChk = $('clock-seconds');
if (clockSecChk) clockSecChk.checked = settings.clockSeconds !== false;


// ═════════════════════════════════════════════════════════════════
// FAVORIS
// ═════════════════════════════════════════════════════════════════
let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');

function saveBookmarks() {
  localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
}

function bmFavicon(url) {
  try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=32'; }
  catch { return null; }
}

function bmLetter(name) { return (name || '?')[0].toUpperCase(); }

// ── Barre épinglés sur la page d'accueil ─────────────────────────
function renderBookmarksBar() {
  const bar   = $('bookmarks-bar');
  const inner = $('bookmarks-bar-inner');
  const pinned = bookmarks.filter(b => b.pinned);
  if (!pinned.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  inner.innerHTML = '';
  pinned.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'bm-pin';
    btn.title = b.url;
    const fav = bmFavicon(b.url);
    const iconEl = document.createElement(fav ? 'img' : 'span');
    if (fav) { iconEl.src = fav; iconEl.onerror = () => { iconEl.style.display='none'; }; }
    else { iconEl.className = 'bm-pin-letter'; iconEl.textContent = bmLetter(b.name); }
    btn.appendChild(iconEl);
    btn.appendChild(document.createTextNode(' ' + b.name));
    btn.addEventListener('click', () => navigate(b.url));
    inner.appendChild(btn);
  });
}

// ── Liste du panel favoris ────────────────────────────────────────
function renderBookmarkList(filter) {
  const list = $('bookmark-list');
  list.innerHTML = '';
  let items = bookmarks;
  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter(b => b.name.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
  }
  if (!items.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text2);font-size:13px">Aucun favori</div>';
    return;
  }
  items.forEach(b => {
    const row = document.createElement('div');
    row.className = 'bm-item';

    // Icône
    const fav = bmFavicon(b.url);
    let iconEl;
    if (fav) {
      iconEl = document.createElement('img');
      iconEl.src = fav;
      iconEl.onerror = () => {
        const sp = document.createElement('span');
        sp.className = 'bm-item-icon';
        sp.textContent = bmLetter(b.name);
        iconEl.replaceWith(sp);
      };
    } else {
      iconEl = document.createElement('span');
      iconEl.className = 'bm-item-icon';
      iconEl.textContent = bmLetter(b.name);
    }
    row.appendChild(iconEl);

    // Info
    const info = document.createElement('div');
    info.className = 'bm-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'bm-item-name';
    nameEl.textContent = b.name;
    const urlEl = document.createElement('div');
    urlEl.className = 'bm-item-url';
    urlEl.textContent = b.url;
    info.appendChild(nameEl);
    info.appendChild(urlEl);
    row.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'bm-item-actions';

    const pinBtn = document.createElement('button');
    pinBtn.className = 'bm-item-pin' + (b.pinned ? ' pinned' : '');
    pinBtn.title = b.pinned ? 'Désépingler' : 'Épingler';
    pinBtn.textContent = '📌';
    pinBtn.addEventListener('click', e => {
      e.stopPropagation();
      b.pinned = !b.pinned;
      saveBookmarks();
      renderBookmarkList($('bookmark-search').value);
      renderBookmarksBar();
      updateBookmarkBtn();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'bm-item-edit';
    editBtn.title = 'Modifier';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      openBookmarkForm(b);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'bm-item-del';
    delBtn.title = 'Supprimer';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      bookmarks = bookmarks.filter(x => x.id !== b.id);
      saveBookmarks();
      renderBookmarkList($('bookmark-search').value);
      renderBookmarksBar();
      updateBookmarkBtn();
    });

    actions.appendChild(pinBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);

    // Clic ligne → naviguer
    row.addEventListener('click', e => {
      if (e.target.closest('.bm-item-actions')) return;
      navigate(b.url);
      closeAllPanels();
    });

    list.appendChild(row);
  });
}

// ── Formulaire ajout/édition ──────────────────────────────────────
let _bmEditing = null;

function openBookmarkForm(bm, prefillUrl, prefillName) {
  _bmEditing = bm ? bm.id : null;
  $('bookmark-form-title').textContent = bm ? 'Modifier le favori' : 'Ajouter un favori';
  $('bm-name').value    = bm ? bm.name : (prefillName || activeTab()?.title || '');
  $('bm-url').value     = bm ? bm.url  : (prefillUrl  || activeTab()?.url  || '');
  $('bm-pinned').checked = bm ? !!bm.pinned : false;
  $('panel-bookmarks').classList.add('hidden');
  $('panel-bookmark-form').classList.remove('hidden');
  if (!$('panel-bookmark-form').classList.contains('hidden') && $('overlay').classList.contains('hidden')) {
    openPanel('panel-bookmark-form');
  }
}

$('close-bookmark-form').addEventListener('click', () => {
  $('panel-bookmark-form').classList.add('hidden');
  $('panel-bookmarks').classList.remove('hidden');
});

$('btn-bm-cancel').addEventListener('click', () => {
  $('panel-bookmark-form').classList.add('hidden');
  $('panel-bookmarks').classList.remove('hidden');
});

$('btn-bm-save').addEventListener('click', () => {
  const name   = $('bm-name').value.trim();
  const url    = $('bm-url').value.trim();
  const pinned = $('bm-pinned').checked;
  if (!name || !url) return;
  const fullUrl = /^https?:\/\//.test(url) ? url : 'https://' + url;
  if (_bmEditing) {
    const bm = bookmarks.find(b => b.id === _bmEditing);
    if (bm) { bm.name = name; bm.url = fullUrl; bm.pinned = pinned; }
  } else {
    bookmarks.unshift({ id: Date.now().toString(), name, url: fullUrl, pinned });
  }
  saveBookmarks();
  renderBookmarkList();
  renderBookmarksBar();
  updateBookmarkBtn();
  $('panel-bookmark-form').classList.add('hidden');
  $('panel-bookmarks').classList.remove('hidden');
  toast((_bmEditing ? 'Favori modifié' : 'Favori ajouté') + ' ✓');
});

// ── Bouton ⭐ dans la topbar ──────────────────────────────────────
function updateBookmarkBtn() {
  const t = activeTab();
  const btn = $('btn-bookmark');
  if (!btn) return;
  const marked = !!(t && t.url && bookmarks.some(b => b.url === t.url));
  btn.textContent = marked ? '★' : '☆';
  btn.classList.toggle('active', marked);
  btn.title = marked ? 'Retirer des favoris' : 'Ajouter aux favoris';
}

$('btn-bookmark').addEventListener('click', () => {
  const t = activeTab();
  if (!t || !t.url) return;
  const existing = bookmarks.find(b => b.url === t.url);
  if (existing) {
    bookmarks = bookmarks.filter(b => b.url !== t.url);
    saveBookmarks();
    renderBookmarksBar();
    updateBookmarkBtn();
    toast('Favori retiré');
  } else {
    openBookmarkForm(null, t.url, t.title || t.url);
  }
});

// ── Bouton sidebar ────────────────────────────────────────────────
$('btn-bookmarks').addEventListener('click', () => {
  renderBookmarkList();
  openPanel('panel-bookmarks');
});
$('close-bookmarks').addEventListener('click', closeAllPanels);
$('btn-bookmark-add').addEventListener('click', () => {
  openBookmarkForm(null);
});
$('bookmark-search').addEventListener('input', e => {
  renderBookmarkList(e.target.value);
});

// Init
renderBookmarksBar();
updateBookmarkBtn();


applySidebar();

// Mesurer les dimensions réelles et les envoyer au main
// pour que la WebView se positionne exactement sous la topbar
function sendDims() {
  // Valeurs fixes cohérentes avec main.js et style.css
  const sbW = sidebarHidden ? 0 : 220;
  const tbH = 52;
  window.api.sendUIDims({ sbW, tbH });
}
sendDims();

window.api.adblockState().then(on => {
  $('btn-adblock').style.opacity = on ? '1' : '0.4';
  const chk = $('adblock-toggle'); if (chk) chk.checked = on;
});

// ═════════════════════════════════════════════════════════════════
// ICÔNE DYNAMIQUE — change avec la couleur d'accent
// ═════════════════════════════════════════════════════════════════
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return { r, g, b };
}

function lightenColor(hex, factor) {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.min(255, Math.round(r + (255 - r) * factor));
  const lg = Math.min(255, Math.round(g + (255 - g) * factor));
  const lb = Math.min(255, Math.round(b + (255 - b) * factor));
  return '#' + [lr, lg, lb].map(v => v.toString(16).padStart(2,'0')).join('');
}

function updateAppIcon(accentColor) {
  const light = lightenColor(accentColor, 0.4);
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="starGrad" x1="30%" y1="0%" x2="70%" y2="100%">
      <stop offset="0%" stop-color="${lightenColor(accentColor, 0.3)}"/>
      <stop offset="100%" stop-color="${accentColor}"/>
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${accentColor}" stop-opacity="0.15"/>
      <stop offset="45%"  stop-color="${accentColor}"/>
      <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.1"/>
    </linearGradient>
    <mask id="backMask">
      <rect width="100" height="100" fill="white"/>
      <ellipse cx="50" cy="52" rx="18" ry="23" fill="black"/>
    </mask>
    <mask id="frontMask">
      <rect width="100" height="100" fill="black"/>
      <rect x="0" y="55" width="100" height="45" fill="white"/>
    </mask>
  </defs>
  <ellipse cx="50" cy="60" rx="40" ry="10"
    fill="none" stroke="${accentColor}" stroke-width="2.5" stroke-opacity="0.2"
    transform="rotate(-12 50 60)" mask="url(#backMask)"/>
  <path d="M50 8 C50 8 52 34 62 46 C72 58 94 59 94 59 C94 59 72 60 62 72 C52 84 50 104 50 104 C50 104 48 84 38 72 C28 60 6 59 6 59 C6 59 28 58 38 46 C48 34 50 8 50 8Z"
    fill="url(#starGrad)"/>
  <ellipse cx="50" cy="60" rx="40" ry="10"
    fill="none" stroke="url(#ringGrad)" stroke-width="2.8"
    transform="rotate(-12 50 60)" mask="url(#frontMask)"/>
</svg>`;
  const b64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
  window.api.setAppIcon({ svg: b64, accent: accentColor });

  // Mettre à jour aussi le favicon de la fenêtre (visible dans la barre des tâches)
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = b64;
}


// ═════════════════════════════════════════════════════════════════
// FOND D'ÉCRAN HOMEPAGE
// ═════════════════════════════════════════════════════════════════
const GRADIENTS = {
  gradient1: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',
  gradient2: 'linear-gradient(135deg,#0d324d,#7f5a83)',
  gradient3: 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)',
  gradient4: 'linear-gradient(135deg,#0a3d0a,#1a5c1a,#0d2b0d)',
  gradient5: 'linear-gradient(135deg,#0c1a4a,#1a3a6a,#0a2a5a)',
  gradient6: 'linear-gradient(135deg,#1a0533,#6b1a3a,#c0392b)',
  gradient7: 'linear-gradient(135deg,#1a1000,#3d2b00,#7d5a00)',
};

// ═════════════════════════════════════════════════════════════════
// FOND D'ÉCRAN — système galerie multi-fonds
// ═════════════════════════════════════════════════════════════════

// --- Lecture / écriture galerie ---
// Galerie stockée dans settings.wpGallery = [{id, type, filename, thumb}]
// Les dataUrl sont rechargés depuis le disque à chaque démarrage (pas stockés)
function getWpGallery() { return settings.wpGallery || []; }

function saveWpGallery(gallery) {
  // Ne sauvegarder QUE les métadonnées (jamais les dataUrl — trop lourds)
  settings.wpGallery = gallery.map(({ id, type, filename, thumb }) => ({ id, type, filename, thumb }));
  saveSettings();
}

// Cache runtime des dataUrl (chargés depuis disque, non persistés)
const _wpUrlCache = {};

function applyWallpaper(wp, dim, customUrl, videoUrl) {
  const wallEl  = $('home-wallpaper');
  const dimEl   = $('home-dim');
  const videoEl = $('home-video-bg');

  if (videoEl) { videoEl.style.display = 'none'; videoEl.src = ''; }
  if (wallEl)  { wallEl.style.backgroundImage = ''; }
  if (dimEl)   { dimEl.style.opacity = '0'; }
  document.body.style.backgroundImage = '';
  document.documentElement.style.setProperty('--wp-image', 'none');
  document.documentElement.style.setProperty('--wp-dim', '0');

  const hasWp = wp && wp !== 'none';
  document.body.classList.toggle('has-wallpaper', !!hasWp);
  if (!wp || wp === 'none') return;

  const dimVal = ((dim || 0) / 100).toFixed(2);
  document.documentElement.style.setProperty('--wp-dim', dimVal);

  if (wp === 'video' && videoUrl) {
    if (videoEl) { videoEl.style.display = 'block'; if (videoEl.src !== videoUrl) videoEl.src = videoUrl; videoEl.play().catch(() => {}); }
    if (dimEl) dimEl.style.opacity = dimVal;
    document.body.style.background = '#000';
  } else if (GRADIENTS[wp]) {
    document.body.style.backgroundImage = GRADIENTS[wp];
    document.documentElement.style.setProperty('--wp-image', GRADIENTS[wp]);
    if (wallEl) wallEl.style.backgroundImage = GRADIENTS[wp];
    if (dimEl)  dimEl.style.opacity = dimVal;
  } else if (customUrl) {
    document.body.style.backgroundImage = 'url(' + customUrl + ')';
    document.body.style.backgroundSize  = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.documentElement.style.setProperty('--wp-image', 'url(' + customUrl + ')');
    if (wallEl) wallEl.style.backgroundImage = 'url(' + customUrl + ')';
    if (dimEl)  dimEl.style.opacity = dimVal;
  }
}

// Applique le fond depuis la galerie (par id)
function applyGalleryItem(item) {
  const url = _wpUrlCache[item.id];
  if (!url) { toast('❌ Fichier introuvable'); return; }
  settings.wallpaper = item.id;
  if (item.type === 'video') {
    settings.wpVideoUrl = url; settings.wpCustomUrl = null;
    applyWallpaper('video', settings.wpDim, null, url);
  } else {
    settings.wpCustomUrl = url; settings.wpVideoUrl = null;
    applyWallpaper('custom', settings.wpDim, url, null);
  }
  saveSettings();
  renderWpGallery();
  document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
}

// --- Rendu de la galerie ---
function renderWpGallery() {
  const grid = $('wp-gallery-grid');
  if (!grid) return;
  const gallery = getWpGallery();
  grid.innerHTML = '';

  if (!gallery.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;font-size:11px;color:var(--text2);text-align:center;padding:12px 0">Aucun fond ajouté</div>';
    return;
  }

  gallery.forEach(item => {
    const isActive = settings.wallpaper === item.id;
    const url = _wpUrlCache[item.id];
    const card = document.createElement('div');
    card.className = 'wp-card' + (isActive ? ' wp-card-active' : '');
    card.title = item.type === 'video' ? '🎬 Vidéo' : '🖼 Image';

    if (item.type === 'video') {
      const vid = document.createElement('video');
      vid.src = url || ''; vid.muted = true; vid.loop = true;
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;pointer-events:none';
      card.appendChild(vid);
      card.addEventListener('mouseenter', () => vid.play().catch(()=>{}));
      card.addEventListener('mouseleave', () => vid.pause());
      const badge = document.createElement('div');
      badge.className = 'wp-card-badge'; badge.textContent = '🎬';
      card.appendChild(badge);
    } else {
      const thumb = item.thumb || url || '';
      card.style.backgroundImage = `url('${thumb}')`;
      card.style.backgroundSize  = 'cover';
      card.style.backgroundPosition = 'center';
    }

    if (isActive) {
      const check = document.createElement('div');
      check.className = 'wp-card-check'; check.textContent = '✓';
      card.appendChild(check);
    }

    const del = document.createElement('button');
    del.className = 'wp-card-del'; del.textContent = '✕'; del.title = 'Supprimer';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      const g = getWpGallery();
      const idx = g.findIndex(x => x.id === item.id);
      if (idx === -1) return;
      try { await window.api.wpDeleteFile({ filename: item.filename }); } catch {}
      delete _wpUrlCache[item.id];
      g.splice(idx, 1);
      saveWpGallery(g);
      if (settings.wallpaper === item.id) {
        settings.wallpaper = 'none'; settings.wpCustomUrl = null; settings.wpVideoUrl = null;
        applyWallpaper('none', 0, null, null);
        saveSettings();
      }
      renderWpGallery();
      toast('🗑 Supprimé');
    });
    card.appendChild(del);

    card.addEventListener('click', () => applyGalleryItem(item));
    grid.appendChild(card);
  });
}

// --- Ajout image ---
async function addWpImage(file) {
  toast('⏳ Ajout en cours...');
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = ev => res(ev.target.result);
    r.onerror = () => rej();
    r.readAsDataURL(file);
  });
  const ext      = file.name.split('.').pop().toLowerCase();
  const filename = 'wp-' + Date.now() + '.' + ext;
  const result   = await window.api.wpSaveFile({ dataUrl, filename });
  if (!result.ok) { toast('❌ Erreur sauvegarde'); return; }

  // Miniature 200×120
  const thumb = await makeThumbnail(dataUrl, 200, 120);
  const id    = 'img-' + Date.now();
  _wpUrlCache[id] = dataUrl;

  const g = getWpGallery();
  g.push({ id, type: 'image', filename, thumb });
  saveWpGallery(g);
  applyGalleryItem({ id, type: 'image', filename });
  toast('🖼 Image ajoutée !');
}

// --- Ajout vidéo ---
async function addWpVideo(file) {
  toast('⏳ Sauvegarde vidéo...');
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = ev => res(ev.target.result);
    r.onerror = () => rej();
    r.readAsDataURL(file);
  });
  const ext      = file.name.split('.').pop().toLowerCase();
  const filename = 'wp-' + Date.now() + '.' + ext;
  const result   = await window.api.wpSaveFile({ dataUrl, filename });
  if (!result.ok) { toast('❌ Erreur sauvegarde'); return; }

  const id = 'vid-' + Date.now();
  _wpUrlCache[id] = dataUrl;

  const g = getWpGallery();
  g.push({ id, type: 'video', filename, thumb: null });
  saveWpGallery(g);
  applyGalleryItem({ id, type: 'video', filename });
  toast('🎬 Vidéo ajoutée !');
}

// Génère une miniature canvas
function makeThumbnail(dataUrl, w, h) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const scale = Math.max(w / img.width, h / img.height);
      const sw = img.width * scale, sh = img.height * scale;
      ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
      res(c.toDataURL('image/jpeg', 0.5));
    };
    img.onerror = () => res(dataUrl); // fallback
    img.src = dataUrl;
  });
}

// --- Init : recharger les fichiers depuis le disque ---
async function initWallpaper() {
  const gallery = getWpGallery();

  // Recharger les dataUrl depuis le disque
  for (const item of gallery) {
    if (!item.filename) continue;
    try {
      const r = await window.api.wpLoadFile({ filename: item.filename });
      if (r.ok) _wpUrlCache[item.id] = r.dataUrl;
    } catch {}
  }

  // Appliquer le fond actif
  const activeId = settings.wallpaper;
  if (activeId && !GRADIENTS[activeId] && activeId !== 'none') {
    const item = gallery.find(g => g.id === activeId);
    if (item && _wpUrlCache[item.id]) {
      if (item.type === 'video') {
        settings.wpVideoUrl = _wpUrlCache[item.id];
        applyWallpaper('video', settings.wpDim, null, _wpUrlCache[item.id]);
      } else {
        settings.wpCustomUrl = _wpUrlCache[item.id];
        applyWallpaper('custom', settings.wpDim, _wpUrlCache[item.id], null);
      }
    } else {
      applyWallpaper('none', 0, null, null);
    }
  } else {
    applyWallpaper(activeId || 'none', settings.wpDim, settings.wpCustomUrl, settings.wpVideoUrl);
  }

  renderWpGallery();
  // Sync slider dim
  const slider = $('wp-dim');
  if (slider && settings.wpDim !== undefined) slider.value = settings.wpDim;
  document.querySelectorAll('.wp-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.wp === (settings.wallpaper || 'none'))
  );
}
initWallpaper();

// --- Boutons preset dégradé ---
document.querySelectorAll('.wp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const wp = btn.dataset.wp;
    if (wp === 'add-image') { $('wp-file-input').click(); return; }
    if (wp === 'add-video') { $('wp-video-input').click(); return; }
    document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.wallpaper = wp;
    settings.wpCustomUrl = null; settings.wpVideoUrl = null;
    applyWallpaper(wp, settings.wpDim, null, null);
    saveSettings();
    renderWpGallery();
  });
});

// --- Upload fichiers ---
$('wp-file-input').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  files.forEach(f => addWpImage(f));
});
$('wp-video-input').addEventListener('change', e => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  files.forEach(f => addWpVideo(f));
});

// Bouton ajouter (ouvre choix image ou vidéo)
$('btn-wp-add-image')?.addEventListener('click', () => $('wp-file-input').click());
$('btn-wp-add-video')?.addEventListener('click', () => $('wp-video-input').click());

// --- Slider assombrissement ---
let wpDimRaf = null;
$('wp-dim').addEventListener('input', e => {
  settings.wpDim = parseInt(e.target.value);
  if (wpDimRaf) cancelAnimationFrame(wpDimRaf);
  wpDimRaf = requestAnimationFrame(() => {
    applyWallpaper(settings.wallpaper, settings.wpDim, settings.wpCustomUrl, settings.wpVideoUrl);
    saveSettings(); wpDimRaf = null;
  });
});


// Toggle topbar transparente
// Appliquer état topbar transparent au démarrage
if (settings.topbarTransparent) document.body.classList.add('topbar-clear');

const topbarToggle = $('topbar-transparent-toggle');
if (topbarToggle) {
  topbarToggle.checked = !!settings.topbarTransparent;
  topbarToggle.addEventListener('change', e => {
    settings.topbarTransparent = e.target.checked;
    document.body.classList.toggle('topbar-clear', e.target.checked);
    saveSettings();
  });
}


// ═════════════════════════════════════════════════════════════════
// COULEUR SIDEBAR
// ═════════════════════════════════════════════════════════════════
function applySbColor(color, opacity) {
  const sidebar = $('sidebar');
  if (!sidebar) return;
  if (!color || color === 'default') {
    sidebar.style.removeProperty('background');
    sidebar.style.removeProperty('backdropFilter');
    sidebar.style.removeProperty('webkitBackdropFilter');
    document.body.classList.remove('has-sb-color');
    return;
  }
  // Marquer le body pour surpasser on-home !important
  document.body.classList.add('has-sb-color');
  if (color === 'transparent') {
    sidebar.style.setProperty('background', 'transparent', 'important');
    sidebar.style.backdropFilter = 'none';
    sidebar.style.webkitBackdropFilter = 'none';
  } else {
    const op = opacity !== undefined ? opacity / 100 : 1;
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    sidebar.style.setProperty('background', `rgba(${r},${g},${b},${op})`, 'important');
    sidebar.style.backdropFilter = op < 1 ? 'blur(12px)' : 'none';
    sidebar.style.webkitBackdropFilter = op < 1 ? 'blur(12px)' : 'none';
  }
}

// Init
applySbColor(settings.sbColor, settings.sbOpacity);
const sbOpacitySlider = $('sb-opacity');
if (sbOpacitySlider && settings.sbOpacity !== undefined) sbOpacitySlider.value = settings.sbOpacity;

// Marquer le bouton actif
document.querySelectorAll('.sb-color-btn').forEach(b =>
  b.classList.toggle('active', b.dataset.sbc === (settings.sbColor || 'default'))
);
if (settings.sbColor && !['default','transparent','#0d0d1a','#1a0533','#0a1628','#0a2a0a','#1a0a0a','#ffffff'].includes(settings.sbColor)) {
  const customInput = $('sb-color-custom');
  if (customInput) customInput.value = settings.sbColor;
}

// Clic preset
document.querySelectorAll('.sb-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = btn.dataset.sbc;
    document.querySelectorAll('.sb-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.sbColor = c;
    if (c !== 'transparent' && c !== 'default') {
      const customInput = $('sb-color-custom');
      if (customInput) customInput.value = c;
    }
    applySbColor(c, settings.sbOpacity);
    saveSettings();
  });
});

// Couleur custom
$('sb-color-custom').addEventListener('input', e => {
  const col = e.target.value;
  settings.sbColor = col;
  document.querySelectorAll('.sb-color-btn').forEach(b => b.classList.remove('active'));
  applySbColor(col, settings.sbOpacity);
  saveSettings();
});

// Opacité sidebar
let sbOpRaf = null;
$('sb-opacity').addEventListener('input', e => {
  settings.sbOpacity = parseInt(e.target.value);
  if (sbOpRaf) cancelAnimationFrame(sbOpRaf);
  sbOpRaf = requestAnimationFrame(() => {
    applySbColor(settings.sbColor, settings.sbOpacity);
    saveSettings();
    sbOpRaf = null;
  });
});


// ═════════════════════════════════════════════════════════════════
// MODE PERFORMANCE (Gaming / Bureautique)
// ═════════════════════════════════════════════════════════════════
function applyGamingMode(enabled) {
  document.body.classList.toggle('gaming-mode', enabled);
  if (enabled) {
    // Suspendre tous les onglets non actifs immédiatement
    tabs.forEach(t => {
      if (t.id !== activeId && !t.suspended && t.url) {
        t.suspended    = true;
        t.suspendedUrl = t.url;
        window.api.tabSuspend({ tabId: t.id });
      }
    });
    // Libérer la RAM
    window.api.tabReload && null; // pas de reload
    toast('🎮 Mode Gaming activé — onglets suspendus, animations coupées');
  } else {
    toast('Mode Gaming désactivé');
  }
}

function applyOfficeMode(enabled) {
  document.body.classList.toggle('office-mode', enabled);
  if (enabled) toast('📄 Mode Bureautique activé — navigation optimisée');
  else toast('Mode Bureautique désactivé');
}

// Initialiser
const gamingToggle = $('gaming-mode-toggle');
const officeToggle = $('office-mode-toggle');
const gamingDesc   = $('gaming-mode-desc');
const officeDesc   = $('office-mode-desc');

if (gamingToggle) {
  gamingToggle.checked = !!settings.gamingMode;
  if (settings.gamingMode) { document.body.classList.add('gaming-mode'); gamingDesc.style.display = 'block'; }

  gamingToggle.addEventListener('change', e => {
    settings.gamingMode = e.target.checked;
    gamingDesc.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
      // Désactiver mode bureautique si actif
      settings.officeMode = false;
      if (officeToggle) officeToggle.checked = false;
      if (officeDesc)   officeDesc.style.display = 'none';
      document.body.classList.remove('office-mode');
    }
    applyGamingMode(e.target.checked);
    saveSettings();
  });
}

if (officeToggle) {
  officeToggle.checked = !!settings.officeMode;
  if (settings.officeMode) { document.body.classList.add('office-mode'); officeDesc.style.display = 'block'; }

  officeToggle.addEventListener('change', e => {
    settings.officeMode = e.target.checked;
    officeDesc.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
      // Désactiver gaming si actif
      settings.gamingMode = false;
      if (gamingToggle) gamingToggle.checked = false;
      if (gamingDesc)   gamingDesc.style.display = 'none';
      document.body.classList.remove('gaming-mode');
    }
    applyOfficeMode(e.target.checked);
    saveSettings();
  });
}


// ═════════════════════════════════════════════════════════════════
// SYSTÈME DE MISE À JOUR
// ═════════════════════════════════════════════════════════════════
let _updateInfo = null;

function showUpdateAvailable(data, fromAutoCheck = false) {
  _updateInfo = data.info;
  const version = data.info.version;
  const dismissedKey = 'update-dismissed-' + version;

  // Bannière dans les paramètres — toujours visible tant que pas ignorée
  const banner    = $('update-banner');
  const bannerVer = $('update-banner-version');
  const bannerTxt = $('update-banner-text');
  const okMsg     = $('update-ok-msg');
  if (okMsg) okMsg.style.display = 'none';
  if (banner && !localStorage.getItem(dismissedKey)) {
    if (bannerVer) bannerVer.textContent = '🎉 Novyss v' + version + ' disponible !';
    if (bannerTxt) bannerTxt.textContent = data.info.notes || '';
    banner.classList.remove('hidden');
  }

  // Toast en bas — seulement si pas encore vu pour cette version
  const toastKey = 'update-toast-seen-' + version;
  if (!localStorage.getItem(toastKey)) {
    const notif    = $('update-notif');
    const notifTxt = $('update-notif-text');
    if (notif && notifTxt) {
      notifTxt.textContent = '🎉 Novyss v' + version + ' est disponible !';
      notif.classList.remove('hidden');
      // Marquer comme vu
      localStorage.setItem(toastKey, '1');
    }
  }
}

// Notification automatique du main process
window.api.onUpdateAvailable(data => showUpdateAvailable(data));

// Progression du téléchargement
window.api.onUpdateDlProgress?.(({ pct, done }) => {
  const wrap = $('update-progress-wrap');
  const bar  = $('update-progress-bar');
  const pctEl = $('update-progress-pct');
  const btn  = $('btn-download-update');
  if (wrap) wrap.style.display = 'block';
  if (bar)  bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (done) {
    if (btn) btn.textContent = '✅ Installation lancée…';
    if (btn) btn.disabled = true;
    toast(_isMac ? '✅ DMG ouvert — glisse Novyss dans Applications !' : '✅ Installateur lancé — Novyss va se fermer');
  }
});

// Bouton vérifier manuellement
$('btn-check-update').addEventListener('click', async () => {
  const btn = $('btn-check-update');
  const okMsg = $('update-ok-msg');
  btn.textContent = '⏳ Vérification…';
  btn.disabled = true;
  if (okMsg) okMsg.style.display = 'none';

  const result = await window.api.checkUpdate();

  btn.textContent = '🔍 Vérifier les mises à jour';
  btn.disabled = false;

  if (result.hasUpdate) {
    showUpdateAvailable(result);
    toast('🎉 Mise à jour disponible : v' + result.info.version);
  } else if (result.error) {
    toast('❌ ' + result.error);
  } else {
    if (okMsg) okMsg.style.display = 'block';
    toast('✓ Novyss est à jour !');
  }
});

// Bouton télécharger et installer directement
$('btn-download-update').addEventListener('click', async () => {
  if (!_updateInfo?.url) return;
  const btn = $('btn-download-update');
  btn.textContent = '⏳ Téléchargement…';
  btn.disabled = true;
  const result = await window.api.downloadUpdate({ url: _updateInfo.url, version: _updateInfo.version });
  if (!result.ok) {
    btn.textContent = '⬇️ Télécharger et installer';
    btn.disabled = false;
    toast('❌ Erreur : ' + (result.error || 'inconnue'));
  }
});

// Bouton "Voir" dans le toast
$('btn-update-notif').addEventListener('click', () => {
  $('update-notif').classList.add('hidden');
  openPanel('panel-settings');
  setTimeout(() => {
    const sg = $('sg-update');
    if (sg) sg.scrollIntoView({ behavior: 'smooth' });
  }, 200);
});

// Fermer le toast
$('btn-update-notif-close').addEventListener('click', () => {
  $('update-notif').classList.add('hidden');
});

// Ignorer la bannière dans les paramètres (ne plus afficher pour cette version)
$('btn-dismiss-update')?.addEventListener('click', () => {
  const banner = $('update-banner');
  if (banner) banner.classList.add('hidden');
  if (_updateInfo?.version) {
    localStorage.setItem('update-dismissed-' + _updateInfo.version, '1');
  }
});

// Lien Discord
$('link-discord')?.addEventListener('click', e => {
  e.preventDefault();
  window.api.openExternal('https://discord.gg/Novyss');
});


// ── Overlay pour fermer le menu contextuel sur clic dehors ───────
const ctxOverlay = $('ctx-overlay');
if (ctxOverlay) {
  ctxOverlay.addEventListener('mousedown', () => {
    ctxOverlay.classList.remove('active');
    // Le clic sur l'overlay = clic dehors du menu → le main process ferme via before-input-event
  });
}

window.api.onCtxMenuOpened(() => {
  if (ctxOverlay) ctxOverlay.classList.add('active');
});
window.api.onCtxMenuClosed(() => {
  if (ctxOverlay) ctxOverlay.classList.remove('active');
});


createTab(settings.homepage || null);

console.log('Novyss UI chargé ✓');

// ═══════════════════════════════════════════════════════════════════
// RACCOURCIS NAVIGATION RAPIDE (homepage)
// ═══════════════════════════════════════════════════════════════════
const homeShortcuts = {
  'sc-history':   () => openPanel('panel-history'),
  'sc-bookmarks': () => openPanel('panel-bookmarks'),
  'sc-vault':     () => openPanel('panel-vault'),
  'sc-settings':  () => openPanel('panel-settings'),
};
Object.entries(homeShortcuts).forEach(([id, fn]) => {
  const btn = $(id);
  if (btn) btn.addEventListener('click', fn);
});

// Raccourcis clavier globaux
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); openPanel('panel-history'); }
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); openPanel('panel-bookmarks'); }
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); openPanel('panel-vault'); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); openPanel('panel-settings'); }
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); $('btn-sidebar-toggle')?.click(); }
  }
});


// ═══════════════════════════════════════════════════════════════════
// SONS DE TOUCHE CLAVIER
// ═══════════════════════════════════════════════════════════════════
let _audioCtx = null;
let _keySoundEnabled = settings.keySoundEnabled || false;
let _keySoundStyle   = settings.keySoundStyle || 'creamy';
let _keySoundVolume  = settings.keySoundVolume !== undefined ? settings.keySoundVolume / 100 : 0.4;

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playKeySound(type = 'key') {
  if (!_keySoundEnabled) return;
  try {
    const ctx   = getAudioCtx();
    const gain  = ctx.createGain();
    const osc   = ctx.createOscillator();
    const now   = ctx.currentTime;

    gain.connect(ctx.destination);
    osc.connect(gain);

    if (_keySoundStyle === 'creamy') {
      // Son doux et grave, comme un clavier foam
      osc.type      = 'sine';
      osc.frequency.setValueAtTime(type === 'enter' ? 200 : type === 'space' ? 160 : 300, now);
      osc.frequency.exponentialRampToValueAtTime(type === 'enter' ? 80 : 60, now + 0.08);
      gain.gain.setValueAtTime(_keySoundVolume * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now); osc.stop(now + 0.12);
    } else if (_keySoundStyle === 'mechanical') {
      osc.type      = 'square';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.03);
      gain.gain.setValueAtTime(_keySoundVolume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now); osc.stop(now + 0.07);
    } else { // soft
      osc.type      = 'triangle';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
      gain.gain.setValueAtTime(_keySoundVolume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now); osc.stop(now + 0.09);
    }
  } catch {}
}

document.addEventListener('keydown', e => {
  if (!_keySoundEnabled) return;
  // Ne pas jouer dans les champs de saisie déjà gérés
  if (e.key === 'Enter') playKeySound('enter');
  else if (e.key === ' ')  playKeySound('space');
  else if (e.key.length === 1) playKeySound('key');
});

// Init toggle son dans settings
const ksTgl = $('keysound-toggle');
const ksOpts = $('keysound-options');
if (ksTgl) {
  ksTgl.checked = _keySoundEnabled;
  if (ksOpts) ksOpts.style.display = _keySoundEnabled ? 'flex' : 'none';
  ksTgl.addEventListener('change', e => {
    _keySoundEnabled = e.target.checked;
    settings.keySoundEnabled = _keySoundEnabled;
    saveSettings();
    if (ksOpts) ksOpts.style.display = _keySoundEnabled ? 'flex' : 'none';
    if (_keySoundEnabled) playKeySound('key');
  });
}
const ksStyle = $('keysound-style');
if (ksStyle) {
  ksStyle.value = _keySoundStyle;
  ksStyle.addEventListener('change', e => {
    _keySoundStyle = e.target.value;
    settings.keySoundStyle = _keySoundStyle;
    saveSettings();
    playKeySound('key');
  });
}
const ksVol = $('keysound-volume');
if (ksVol) {
  ksVol.value = (_keySoundVolume * 100).toString();
  ksVol.addEventListener('input', e => {
    _keySoundVolume = parseInt(e.target.value) / 100;
    settings.keySoundVolume = parseInt(e.target.value);
    saveSettings();
  });
}
$('keysound-test')?.addEventListener('click', () => {
  const prev = _keySoundEnabled; _keySoundEnabled = true;
  playKeySound('key'); setTimeout(() => playKeySound('enter'), 120);
  _keySoundEnabled = prev;
});


// ═══════════════════════════════════════════════════════════════════
// POLICES D'ÉCRITURE
// ═══════════════════════════════════════════════════════════════════
const GOOGLE_FONTS = ['Inter','Roboto','Poppins','Nunito','Raleway','Fira Sans','JetBrains Mono','Source Code Pro'];
let _fontLoaded = {};

function applyFont(fontName) {
  if (!fontName) {
    document.documentElement.style.removeProperty('--app-font');
    document.body.style.fontFamily = '';
    return;
  }
  if (!_fontLoaded[fontName]) {
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600&display=swap`;
    document.head.appendChild(link);
    _fontLoaded[fontName] = true;
  }
  document.documentElement.style.setProperty('--app-font', `"${fontName}", system-ui, sans-serif`);
  document.body.style.fontFamily = `var(--app-font)`;
  const preview = $('font-preview');
  if (preview) preview.style.fontFamily = `"${fontName}", sans-serif`;
}

const fontSelect = $('font-select');
if (fontSelect) {
  fontSelect.value = settings.appFont || '';
  fontSelect.addEventListener('change', e => {
    settings.appFont = e.target.value;
    saveSettings();
    applyFont(e.target.value);
  });
}
// Appliquer au démarrage
if (settings.appFont) applyFont(settings.appFont);



// ═══════════════════════════════════════════════════════════════════
// SITES SPÉCIAUX — redirection navigateur externe
// ═══════════════════════════════════════════════════════════════════
const DEFAULT_EXT_SITES = ['youtube.com', 'netflix.com'];
let _detectedBrowsers = [];

// Détecter les navigateurs au démarrage
(async () => {
  try { _detectedBrowsers = await window.api.detectBrowsers?.() || []; } catch {}
})();

const BROWSER_ICONS = {
  'Google Chrome':'🟡','Chrome':'🟡','Mozilla Firefox':'🦊','Firefox':'🦊',
  'Microsoft Edge':'🔵','Edge':'🔵','Brave':'🦁','Opera':'🔴','Vivaldi':'🎵','Safari':'🧭',
};

function getExtSites() {
  return settings.extSites !== undefined ? settings.extSites : DEFAULT_EXT_SITES;
}
function syncExtSitesToMain() { window.api.setExtSites?.(getExtSites()); }

function shouldAskExternal(url) {
  try {
    const host = new URL(url).hostname.replace('www.','');
    return getExtSites().some(s => host === s.replace('www.','') || host.endsWith('.'+s.replace('www.','')));
  } catch { return false; }
}

// Écouter les navigations bloquées par main.js
window.api.onAskExtSite?.(({ url }) => {
  window.api.webviewHide?.();
  _pendingExtUrl = url;
  _showExtPopupOnScreenshot = true;
});

// Screenshot → fond flouté
let _showExtPopupOnScreenshot = false;
let _screenshotEl = null;
window.api.onWebviewScreenshot?.((dataUrl) => {
  if (!_screenshotEl) {
    _screenshotEl = document.createElement('div');
    _screenshotEl.id = 'webview-screenshot-bg';
    _screenshotEl.style.cssText = 'position:fixed;top:52px;right:0;bottom:0;z-index:8998;pointer-events:none;background-size:cover;background-position:top left;';
    document.body.appendChild(_screenshotEl);
  }
  const sbW = sidebarHidden ? 0 : 220;
  _screenshotEl.style.left = sbW + 'px';
  _screenshotEl.style.backgroundImage = `url(${dataUrl})`;
  _screenshotEl.style.filter = 'blur(4px) brightness(0.45)';
  _screenshotEl.style.display = 'block';
  if (_showExtPopupOnScreenshot) { _showExtPopupOnScreenshot = false; showExtPopup(_pendingExtUrl); }
});
function hideScreenshotBg() { if (_screenshotEl) _screenshotEl.style.display = 'none'; }

// Popup
let _pendingExtUrl = null;
function showExtPopup(url) {
  _pendingExtUrl = url;
  const popup   = $('ext-browser-popup');
  const titleEl = $('ext-popup-title');
  const urlEl   = $('ext-popup-url');
  const listEl  = $('ext-browser-list');
  if (!popup) return false;
  try {
    const host = new URL(url).hostname.replace('www.','');
    if (titleEl) titleEl.textContent = `Ouvrir ${host} dans quel navigateur ?`;
  } catch {}
  if (urlEl) urlEl.textContent = url.length > 55 ? url.slice(0,55)+'…' : url;
  if (listEl) {
    listEl.innerHTML = '';
    if (!_detectedBrowsers.length) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--text2);text-align:center;padding:8px">Aucun navigateur détecté</div>';
    } else {
      _detectedBrowsers.forEach(b => {
        const icon = BROWSER_ICONS[b.name] || '🌐';
        const btn = document.createElement('button');
        btn.className = 'primary-btn';
        btn.style.cssText = 'width:100%;text-align:left;display:flex;align-items:center;gap:10px;font-size:13px;padding:10px 14px;';
        btn.innerHTML = `<span style="font-size:18px">${icon}</span><span>${b.name}</span>`;
        btn.addEventListener('click', async () => {
          const u = _pendingExtUrl;
          closeExtPopup();
          await window.api.openInBrowser({ browserPath: b.path, url: u });
        });
        listEl.appendChild(btn);
      });
    }
  }
  popup.style.display = 'flex';
  return true;
}

function closeExtPopup() {
  const popup = $('ext-browser-popup');
  if (popup) popup.style.display = 'none';
  hideScreenshotBg();
  window.api.webviewShow?.();
  _pendingExtUrl = null;
}

// Render ext sites list in settings
function renderExtSites() {
  const list = $('ext-sites-list');
  if (!list) return;
  const sites = getExtSites();
  list.innerHTML = '';
  sites.forEach((site, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';
    row.innerHTML = `<span style="flex:1;font-size:12px;padding:5px 8px;background:var(--bg);border-radius:7px;border:1px solid var(--border)">${site}</span><button style="font-size:11px;padding:3px 8px;border-radius:6px;" class="ghost-btn">✕</button>`;
    row.querySelector('button').addEventListener('click', () => {
      const s = getExtSites(); s.splice(i,1);
      settings.extSites = s; saveSettings(); renderExtSites(); syncExtSitesToMain();
    });
    list.appendChild(row);
  });
}
renderExtSites();
syncExtSitesToMain();

$('btn-add-ext-site')?.addEventListener('click', () => {
  const site = prompt('Domaine à ajouter (ex: twitch.tv)');
  if (!site) return;
  const s = getExtSites();
  const clean = site.replace('https://','').replace('http://','').split('/')[0];
  if (!s.includes(clean)) s.push(clean);
  settings.extSites = s; saveSettings(); renderExtSites(); syncExtSitesToMain();
  toast('✓ Site ajouté');
});

$('ext-popup-novyss')?.addEventListener('click', () => {
  const url = _pendingExtUrl;
  const popup = $('ext-browser-popup');
  if (popup) popup.style.display = 'none';
  hideScreenshotBg();
  _pendingExtUrl = null;
  if (url) navigateDirect(url);
});
$('ext-popup-cancel')?.addEventListener('click', () => closeExtPopup());
$('ext-popup-remember')?.addEventListener('change', e => {
  if (e.target.checked && _pendingExtUrl) {
    try {
      const host = new URL(_pendingExtUrl).hostname.replace('www.','');
      const s = getExtSites().filter(x => x !== host && !host.endsWith('.'+x));
      settings.extSites = s; saveSettings(); renderExtSites(); syncExtSitesToMain();
      toast('✓ Ce site sera ouvert directement dans Novyss');
    } catch {}
  }
});

// Intercepter navigation vers sites spéciaux
// Intercepter navigation vers sites spéciaux
function navigateWithCheck(url) {
  if (shouldAskExternal(url)) {
    showExtPopup(url);
    return;
  }
  navigate(url);
}

// Quand on choisit "Ouvrir dans Novyss" → bypass le check
function navigateDirect(url) {
  const t = activeTab();
  if (!t) { createTab(url); return; }
  t.url = url;
  homeEl.style.display = 'none';
  window.api.tabNavigate({ tabId: t.id, url });
  window.api.tabShow({ tabId: t.id });
  addHistory(url, t.title || '');
}


// ═══════════════════════════════════════════════════════════════════
// TÉLÉCHARGEMENTS
// ═══════════════════════════════════════════════════════════════════
window.api.initDownloads?.();

const _downloads = new Map(); // id → { filename, savePath, pct, status }

function renderDownloads() {
  const list = $('download-list');
  const bar  = $('download-bar');
  if (!list) return;
  if (_downloads.size === 0) { bar?.classList.add('hidden'); return; }
  bar?.classList.remove('hidden');
  list.innerHTML = '';
  _downloads.forEach((dl, id) => {
    const item = document.createElement('div');
    item.className = 'dl-item';
    const ext = (dl.filename || '').split('.').pop().toLowerCase();
    const icon = ['mp4','mkv','avi','webm'].includes(ext) ? '🎬' : ['mp3','flac','wav'].includes(ext) ? '🎵' : ['zip','rar','7z'].includes(ext) ? '📦' : ['exe','msi'].includes(ext) ? '⚙️' : '📄';
    let statusHtml = '';
    if (dl.status === 'done') {
      statusHtml = `<span class="dl-status ok">✓</span>`;
    } else if (dl.status === 'virus') {
      statusHtml = `<span class="dl-status warn" title="Menace détectée !">⚠️ ${dl.vtMalicious} menace(s)</span>`;
    } else if (dl.status === 'scanning') {
      statusHtml = `<span class="dl-status">🔍</span>`;
    } else if (dl.status === 'cancelled') {
      statusHtml = `<span class="dl-status err">✕</span>`;
    }
    item.innerHTML = `
      <span style="font-size:16px">${icon}</span>
      <span class="dl-item-name" title="${dl.filename}">${dl.filename}</span>
      ${dl.pct >= 0 && dl.pct < 100 ? `<div class="dl-progress-wrap"><div class="dl-progress-bar" style="width:${dl.pct}%"></div></div>` : ''}
      <span class="dl-status" id="dl-pct-${id}">${dl.pct >= 0 && dl.pct < 100 ? dl.pct+'%' : ''}</span>
      ${statusHtml}
      ${dl.savePath ? `<button class="ghost-btn dl-open-btn" data-path="${dl.savePath}">📂</button>` : ''}
    `;
    item.querySelector('.dl-open-btn')?.addEventListener('click', e => {
      window.api.dlOpenFolder({ savePath: e.target.dataset.path });
    });
    list.appendChild(item);
  });
}

window.api.onDlStarted(d => {
  _downloads.set(d.id, { filename: d.filename, savePath: d.savePath, pct: 0, status: 'downloading' });
  renderDownloads();
});
window.api.onDlProgress(d => {
  const dl = _downloads.get(d.id);
  if (dl) { dl.pct = d.pct; renderDownloads(); }
});
window.api.onDlDone(async d => {
  const dl = _downloads.get(d.id);
  if (!dl) return;
  if (!d.ok) { dl.status = 'cancelled'; renderDownloads(); return; }
  dl.savePath = d.savePath;
  dl.pct = 100;

  // Scan VirusTotal si clé API configurée
  if (settings.vtApiKey && d.hash) {
    dl.status = 'scanning';
    renderDownloads();
    const vt = await window.api.vtScan({ hash: d.hash, apiKey: settings.vtApiKey });
    if (vt.ok && vt.malicious > 0) {
      dl.status = 'virus';
      dl.vtMalicious = vt.malicious;
      toast(`⚠️ Fichier suspect : ${vt.malicious} menace(s) détectée(s) !`);
    } else {
      dl.status = 'done';
    }
  } else {
    dl.status = 'done';
    toast(`✓ Téléchargé : ${dl.filename}`);
  }
  renderDownloads();
});

$('download-bar-close')?.addEventListener('click', () => {
  $('download-bar')?.classList.add('hidden');
});


// ═══════════════════════════════════════════════════════════════════
// RECONNAISSANCE MOTS DE PASSE
// ═══════════════════════════════════════════════════════════════════
let _pwdDetectData = null;
let masterPwdForDetect = null; // mis à jour quand vault est ouvert

// Script injecté dans chaque page pour détecter les formulaires login
const PWD_DETECT_SCRIPT = `
(function() {
  if (window.__novyssPwdWatcher) return;
  window.__novyssPwdWatcher = true;
  function findLoginForm() {
    const pwdFields = document.querySelectorAll('input[type="password"]');
    for (const pwd of pwdFields) {
      const form = pwd.closest('form') || pwd.parentElement;
      const userField = form ? (
        form.querySelector('input[type="email"]') ||
        form.querySelector('input[type="text"]') ||
        form.querySelector('input[name*="user"]') ||
        form.querySelector('input[name*="login"]') ||
        form.querySelector('input[name*="email"]') ||
        form.querySelector('input[id*="user"]') ||
        form.querySelector('input[id*="email"]')
      ) : null;
      if (pwd && userField) return { pwdEl: pwd, userEl: userField };
    }
    return null;
  }

  function sendDetect(username, password) {
    window.postMessage({ __novyss: 'pwd-submit', username, password, url: location.href }, '*');
  }

  document.addEventListener('submit', () => {
    const f = findLoginForm();
    if (f && f.pwdEl.value) sendDetect(f.userEl.value || '', f.pwdEl.value);
  }, true);

  // Aussi sur clic de bouton submit
  document.addEventListener('click', e => {
    const btn = e.target.closest('button[type="submit"], input[type="submit"], button');
    if (!btn) return;
    setTimeout(() => {
      const f = findLoginForm();
      if (f && f.pwdEl.value) sendDetect(f.userEl.value || '', f.pwdEl.value);
    }, 300);
  }, true);
})();
`;

// Injecter dans chaque onglet au chargement
window.api.onViewEvent(e => {
  if (e.type === 'loading' && e.value === false) {
    // On ne peut pas directement injecter JS dans WebContentsView depuis le renderer
    // Cette détection se fait via postMessage relayé depuis le contexte isolé
    // Le script est injecté via main.js executeJavaScript — voir intégration
  }
});

// Popup afficher/sauvegarder mot de passe
function closePwdDetectPopup() {
  const popup = $('pwd-detect-popup');
  if (popup) popup.style.display = 'none';
  _pwdDetectData = null;
}

function showPwdDetectPopup(data) {
  _pwdDetectData = data;
  const popup   = $('pwd-detect-popup');
  const siteEl  = $('pwd-detect-site');
  const userEl  = $('pwd-detect-user');
  if (!popup) return;
  try { if (siteEl) siteEl.textContent = '🌐 ' + new URL(data.url).hostname; } catch {}
  if (userEl) userEl.textContent = data.username ? '👤 ' + data.username : '👤 (anonyme)';
  popup.style.display = 'flex';
  if (_pwdAutoHide) clearTimeout(_pwdAutoHide);
  _pwdAutoHide = setTimeout(() => closePwdDetectPopup(), 12000);
}
let _pwdAutoHide = null;

$('pwd-detect-ignore')?.addEventListener('click', () => {
  closePwdDetectPopup();
});

$('pwd-detect-save')?.addEventListener('click', async () => {
  if (!_pwdDetectData) return;
  // Demander le mot de passe master si vault pas ouvert
  if (!masterPwdForDetect) {
    const pwd = prompt('Entrez votre mot de passe Vault pour sauvegarder :');
    if (!pwd) return;
    masterPwdForDetect = pwd;
  }
  const result = await window.api.pwdSaveEntry({
    site: _pwdDetectData.url,
    username: _pwdDetectData.username,
    password: _pwdDetectData.password,
    masterPwd: masterPwdForDetect
  });
  if (result.ok) { toast('✓ Identifiants sauvegardés dans le Vault'); }
  else { toast('❌ Erreur : ' + (result.error || 'mot de passe vault incorrect')); masterPwdForDetect = null; }
  closePwdDetectPopup();
});

$('pwd-detect-fill')?.addEventListener('click', async () => {
  if (!_pwdDetectData) return;
  // Auto-remplissage : chercher entrées correspondantes dans vault
  if (!masterPwdForDetect) {
    const pwd = prompt('Entrez votre mot de passe Vault pour remplir :');
    if (!pwd) return;
    masterPwdForDetect = pwd;
  }
  const result = await window.api.pwdGetForSite({ site: _pwdDetectData.url, masterPwd: masterPwdForDetect });
  if (result.ok && result.entries.length > 0) {
    const entry = result.entries[0];
    toast(`✓ Identifiants de "${entry.login}" prêts — ouvrez le Vault pour remplir`);
  } else {
    toast('Aucun identifiant trouvé pour ce site');
  }
  closePwdDetectPopup();
});

// Mémoriser le master pwd quand vault est ouvert (pour éviter de le redemander)
const _origVaultOpen = window.api.vaultOpen;
window._lastMasterPwd = null;
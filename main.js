const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, screen, protocol, net, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Recur = require('./src/common/recur.js');
const Sanitize = require('./src/common/sanitize.js');
// 主进程清洗用 DOM 单例：linkedom 只解析一次，避免每次 upsert 重复 parseHTML
const LIDOM = require('linkedom').parseHTML('<html><body></body></html>').document;
// 应用自身页面根（URL 形式，供导航白名单使用；__dirname 是反斜杠路径，需规范化）
const APP_ROOT_URL = require('url').pathToFileURL(__dirname).href.replace(/\/$/, '');

const DATA_FILE = () => path.join(app.getPath('userData'), 'data.json');
const ATT_DIR = () => path.join(app.getPath('userData'), 'attachments');
const TRASH_DIR = () => path.join(ATT_DIR(), '.trash');

// attach:// 自定义协议：以 userData/attachments 为根引用图片，迁移数据目录不断链
protocol.registerSchemesAsPrivileged([
  { scheme: 'attach', privileges: { standard: false, secure: false, supportFetchAPI: true, stream: true } }
]);

/* ---------------- 数据层 ---------------- */
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function nextWeekday(wd) { // wd: 1=周一 ... 7=周日
  const d = new Date();
  const cur = d.getDay() === 0 ? 7 : d.getDay();
  const diff = (wd - cur + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return ymd(d);
}

function defaultState() {
  return {
    categories: [
      { id: 'c_note', name: '便签', kind: 'note', order: 0 },
      { id: 'c_todo', name: '待办', kind: 'todo', order: 1 },
      { id: 'c_gouwu', name: '购物', kind: 'todo', order: 2 }
    ],
    items: [
      {
        id: 'n1', type: 'note', categoryId: 'c_note', color: 'blue',
        html: '欢迎使用 C便签 ✨<br>双击可打开大编辑器，右键有更多操作',
        reminder: { date: nextWeekday(1), time: '10:00', repeat: 'none', important: false },
        done: false, attachments: [], createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000
      },
      {
        id: 'n2', type: 'note', categoryId: 'c_note', color: 'default',
        html: '示例便签<br>工具栏可以切换清单模式，逐行打勾',
        reminder: null, done: false, attachments: [], createdAt: Date.now() - 3600e3, updatedAt: Date.now() - 3600e3
      },
      {
        id: 'n3', type: 'note', categoryId: 'c_note', color: 'default',
        html: '试试日历：右上角 📅 打开月视图，双击日期就能记录',
        reminder: null, done: false, attachments: [], createdAt: Date.now() - 90 * 86400e3, updatedAt: Date.now() - 90 * 86400e3
      },
      { id: 't1', type: 'todo', categoryId: 'c_gouwu', text: '示例物品（双击可填价格和渠道）', reminder: null, done: true, order: 0, createdAt: Date.now() },
      { id: 't2', type: 'todo', categoryId: 'c_gouwu', text: '示例物品 2', reminder: null, done: false, order: 1, createdAt: Date.now() }
    ],
    settings: {
      nickname: 'C签用户', theme: 'dark', transparency: 95, showLunar: true, weekStart: 1,
      confirmDelete: true, autostart: false, tips: true, colorMode: 'dark', freeSort: true,
      alwaysOnTop: false
    },
    trash: [],
    lastCheck: Date.now(),
    fired: {}
  };
}

let state = null;
let lastPersistTs = 0;

function tryLoadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function loadState() {
  const f = DATA_FILE();
  let loaded = tryLoadJson(f);
  if (!loaded) {
    // 主文件损坏 → 尝试上一份备份
    loaded = tryLoadJson(f + '.bak');
    if (loaded) {
      try { fs.copyFileSync(f, f + '.corrupt-' + Date.now()); } catch (e) {}
      try {
        new Notification({
          title: 'C便签',
          body: '数据文件损坏，已自动从备份恢复'
        }).show();
      } catch (e) {}
    } else {
      loaded = defaultState();
    }
    state = loaded;
    state.trash = state.trash || [];
    persist();
  } else {
    state = loaded;
    if (!Array.isArray(state.trash)) state.trash = [];
    if (!state.lastCheck) state.lastCheck = Date.now();
    if (!state.settings) state.settings = {};
    if (typeof state.settings.confirmDelete !== 'boolean') state.settings.confirmDelete = true;
  }
}

function persist() {
  try {
    const f = DATA_FILE();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // 原子写：先写临时文件再 rename；写前轮换一份 .bak
    if (fs.existsSync(f)) {
      try { fs.copyFileSync(f, f + '.bak'); } catch (e) {}
    }
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, f);
  } catch (e) { console.error('persist fail', e); }
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}
function sync() { persist(); broadcast('state', state); }

/* ---------------- 附件安全辅助 ---------------- */
function attPathByName(name) {
  if (!name || /[\\/]/.test(name) || name.includes('..')) return null;
  const p = path.join(ATT_DIR(), name);
  if (!p.startsWith(ATT_DIR())) return null;
  if (fs.existsSync(p)) return p;
  // 旧数据兼容：条目里存原始文件名，磁盘名是 uuid_原名
  try {
    const hit = fs.readdirSync(ATT_DIR()).find(f => f.endsWith('_' + name));
    if (hit) return path.join(ATT_DIR(), hit);
  } catch (e) {}
  return null;
}
function moveToTrashFile(name) {
  const p = attPathByName(name);
  if (!p || !fs.existsSync(p)) return;
  fs.mkdirSync(TRASH_DIR(), { recursive: true });
  try { fs.renameSync(p, path.join(TRASH_DIR(), name)); } catch (e) {
    try { fs.copyFileSync(p, path.join(TRASH_DIR(), name)); fs.rmSync(p); } catch (e2) {}
  }
}
function restoreFromTrashFile(name) {
  const p = path.join(TRASH_DIR(), name);
  if (!fs.existsSync(p)) return;
  fs.mkdirSync(ATT_DIR(), { recursive: true });
  try { fs.renameSync(p, path.join(ATT_DIR(), name)); } catch (e) {
    try { fs.copyFileSync(p, path.join(ATT_DIR(), name)); fs.rmSync(p); } catch (e2) {}
  }
}
function purgeTrashFile(name) {
  const p = path.join(TRASH_DIR(), name);
  if (fs.existsSync(p)) { try { fs.rmSync(p); } catch (e) {} }
}
// 条目正文/附件清单里引用的附件名
function itemAttachmentNames(it) {
  const names = new Set((it.attachments || []).map(a => a.name).filter(Boolean));
  const html = String(it.html || '');
  for (const m of html.matchAll(/attach:\/\/([^"'\s>]+)/g)) {
    try { names.add(decodeURIComponent(m[1])); } catch (e) {}
  }
  return [...names];
}
/* 引用计数：name 是否被除 exceptId 之外的条目（含回收站内）引用
   「复制本条」会共享同一附件文件，删除/淘汰/清理前必须检查，否则复制品当场裂图 */
function referencedByOther(name, exceptId) {
  return state.items.some(it => it.id !== exceptId && itemAttachmentNames(it).includes(name)) ||
    state.trash.some(t => t.item.id !== exceptId && itemAttachmentNames(t.item).includes(name));
}

/* ---------------- 提醒（支持离线补发） ---------------- */
function checkReminders() {
  const now = Date.now();
  const last = state.lastCheck || now;
  // 补发窗口：上次检查至今，最长回溯 24 小时（更久的错过就错过，避免轰炸）
  const fromMs = Math.max(now - 24 * 3600e3, last - 60e3);
  const fromDate = ymd(new Date(fromMs - 24 * 3600e3)); // 展开区间再放宽一天防跨月
  const toDate = ymd(new Date(now + 60e3));
  let changed = false;
  for (const it of state.items) {
    const r = it.reminder; if (!r || !r.date || it.done) continue;
    for (const d of Recur.expand(r, fromDate, toDate)) {
      const dt = new Date(d + 'T' + (r.time || '09:00') + ':00').getTime();
      if (dt >= fromMs && dt <= now) {
        const key = it.id + '@' + d + 'T' + (r.time || '09:00');
        if (!state.fired[key]) {
          state.fired[key] = Date.now(); changed = true;
          fireNotification(it, dt, dt < Date.now() - 60e3);
        }
      }
    }
  }
  // 过期 fired 记录清理（保留 7 天）
  const week = now - 7 * 86400e3;
  for (const k of Object.keys(state.fired)) if (state.fired[k] < week) { delete state.fired[k]; changed = true; }
  state.lastCheck = now;
  if (changed) sync();
  else if (now - lastPersistTs > 10 * 60e3) { lastPersistTs = now; persist(); }
}
function fireNotification(it, dt, late) {
  const text = it.type === 'todo' ? it.text : String(it.html || '').replace(/<[^>]+>/g, ' ').trim();
  const rep = r => ({ none: '', day: '每天', week: '每周', month: '每月', year: '每年' }[r] || '');
  const lateTag = late ? '（补发）' : '';
  const n = new Notification({
    title: (it.reminder.important ? '⭐ 重要事项提醒' : 'C便签提醒') + ' ' + (dt.getHours() + ':' + pad(dt.getMinutes())),
    body: text.slice(0, 120) + (rep(it.reminder.repeat) ? '（' + rep(it.reminder.repeat) + '）' : '') + lateTag,
    icon: path.join(__dirname, 'tray.png'),
    silent: false
  });
  n.on('click', () => { showMain(); });
  n.show();
}

/* ---------------- 窗口管理 ---------------- */
const winMap = new Map();
const commonWeb = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true, nodeIntegration: false, spellcheck: false
};
function createWin(type, opts = {}) {
  const key = type === 'sticky' && !opts.id ? 'sticky:new' + Date.now() : type + (opts.id ? ':' + opts.id : '');
  if (winMap.has(key)) { const w = winMap.get(key); if (!w.isDestroyed()) { w.show(); w.focus(); return w; } winMap.delete(key); }
  let w;
  const base = { frame: false, transparent: true, backgroundColor: '#00000000', show: false, webPreferences: commonWeb };
  if (type === 'main') {
    w = new BrowserWindow({
      ...base, width: 354, height: 680, minWidth: 74, minHeight: 300,
      alwaysOnTop: !!state.settings.alwaysOnTop, x: opts.x, y: opts.y
    });
    w.loadFile('src/panel/index.html');
    enableSnap(w, { onlyCollapsed: true });
  } else if (type === 'sticky') {
    w = new BrowserWindow({ ...base, width: 280, height: 300, minWidth: 220, minHeight: 180, x: opts.x, y: opts.y, alwaysOnTop: !!opts.ontop, skipTaskbar: true });
    w.loadFile('src/sticky/index.html', { query: { id: opts.id || '' } });
    enableSnap(w);
  } else if (type === 'editor') {
    w = new BrowserWindow({ ...base, width: 502, height: 660, minWidth: 430, minHeight: 520, x: opts.x, y: opts.y });
    w.loadFile('src/editor/index.html', { query: { id: opts.id || '', categoryId: opts.categoryId || '', date: opts.date || '', time: opts.time || '', autoprem: opts.autoprem || '', autock: opts.autock || '' } });
  } else {
    // 防御：未知窗口类型直接报给调用方，不再落 undefined
    throw new Error('unknown window type: ' + type);
  }
  w.once('ready-to-show', () => {
    w.show();
    if (type === 'main' && state) w.setOpacity((state.settings.transparency ?? 95) / 100);
  });
  w.on('closed', () => { if (winMap.get(key) === w) winMap.delete(key); });
  winMap.set(key, w);
  return w;
}
function showMain() {
  const w = createWin('main');
  if (w) { w.show(); w.focus(); }
}
function showMainView(view) {
  showMain();
  const mw = winMap.get('main');
  if (!mw) return;
  const js = `typeof switchView === 'function' && switchView(${JSON.stringify(view)}); 1`;
  const run = () => { try { mw.webContents.executeJavaScript(js); } catch (e) {} };
  if (mw.webContents.isLoading()) mw.webContents.once('did-finish-load', run);
  else run();
}

/* 边缘吸附：拖到屏幕四边 26px 内自动吸贴合（仅折叠态主面板 / 便签小窗） */
function enableSnap(w, opts = {}) {
  let t = null;
  w.on('move', () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      if (w.isDestroyed()) return;
      const b = w.getBounds();
      if (opts.onlyCollapsed && b.width > 90) return;
      const wa = screen.getDisplayMatching(b).workArea;
      const T = 26;
      let x = b.x, y = b.y, hit = false;
      if (Math.abs(x - wa.x) < T) { x = wa.x; hit = true; }
      else if (Math.abs((b.x + b.width) - (wa.x + wa.width)) < T) { x = wa.x + wa.width - b.width; hit = true; }
      if (Math.abs(y - wa.y) < T) { y = wa.y; hit = true; }
      else if (Math.abs((b.y + b.height) - (wa.y + wa.height)) < T) { y = wa.y + wa.height - b.height; hit = true; }
      if (hit && (x !== b.x || y !== b.y)) w.setBounds({ x, y });
    }, 130);
  });
}

/* ---------------- IPC ---------------- */
ipcMain.handle('state:load', () => state);
ipcMain.handle('lunar:month', (e, { y, m }) => {
  const { Solar, Lunar } = require('lunar-javascript');
  const days = [];
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const solar = Solar.fromYmd(y, m, d);
    const lunar = Lunar.fromDate(new Date(y, m - 1, d));
    const fest = [...lunar.getFestivals(), ...solar.getFestivals()];
    const jq = lunar.getJieQi();
    days.push({
      d, ymd: y + '-' + pad(m) + '-' + pad(d),
      lunarDay: lunar.getDayInChinese(),
      monthTag: lunar.getDayInChinese() === '初一' ? lunar.getMonthInChinese() + '月' : '',
      jieqi: jq || '', fest: fest[0] || '', weekday: new Date(y, m - 1, d).getDay()
    });
  }
  return { days, lunarYearMonth: Lunar.fromDate(new Date(y, m - 1, 15)).getYearInGanZhi() + '年 ' + Lunar.fromDate(new Date(y, m - 1, 15)).getMonthInChinese() + '月' };
});
ipcMain.handle('item:upsert', (e, item) => {
  // 主进程兜底清洗：html 一律过白名单（linkedom 提供 DOM，与渲染层同一套规则）
  if (item.html != null) item.html = Sanitize.sanitizeHtml(item.html, LIDOM);
  const i = state.items.findIndex(x => x.id === item.id);
  item.updatedAt = Date.now();
  if (i >= 0) state.items[i] = { ...state.items[i], ...item };
  else { item.createdAt = Date.now(); state.items.push(item); }
  sync(); return item.id;
});
ipcMain.handle('item:patch', (e, { id, patch }) => {
  const it = state.items.find(x => x.id === id); if (!it) return false;
  if (patch && patch.html != null) patch.html = Sanitize.sanitizeHtml(patch.html, LIDOM);
  Object.assign(it, patch, { updatedAt: Date.now() });
  if (patch.reminder === null) {
    for (const k of Object.keys(state.fired)) if (k.startsWith(id + '@')) delete state.fired[k];
  }
  sync(); return true;
});
function deleteItemInternal(it) {
  // 进回收站（条目 + 附件文件移入 .trash，可整体恢复）；仍被其他条目引用的文件留在原地
  state.trash.push({ item: JSON.parse(JSON.stringify(it)), deletedAt: Date.now() });
  for (const n of itemAttachmentNames(it)) {
    if (!referencedByOther(n, it.id)) moveToTrashFile(n);
  }
  if (state.trash.length > 50) {
    const old = state.trash.shift();
    for (const n of itemAttachmentNames(old.item)) {
      if (!referencedByOther(n, old.item.id)) purgeTrashFile(n);
    }
  }
  state.items = state.items.filter(x => x.id !== it.id);
  for (const k of Object.keys(state.fired)) if (k.startsWith(it.id + '@')) delete state.fired[k];
}
ipcMain.handle('item:delete', (e, id) => {
  const it = state.items.find(x => x.id === id);
  if (it) deleteItemInternal(it);
  sync(); return true;
});
ipcMain.handle('item:duplicate', (e, id) => {
  const it = state.items.find(x => x.id === id); if (!it) return null;
  const copy = JSON.parse(JSON.stringify(it));
  copy.id = 'i' + crypto.randomBytes(5).toString('hex');
  copy.done = false; copy.createdAt = Date.now(); copy.updatedAt = Date.now();
  state.items.push(copy); sync(); return copy.id;
});
ipcMain.handle('todo:reorder', (e, { ids }) => {
  ids.forEach((id, idx) => { const it = state.items.find(x => x.id === id); if (it) it.order = idx; });
  sync(); return true;
});
ipcMain.handle('todo:clearDone', (e, categoryId) => {
  const done = state.items.filter(x => x.type === 'todo' && x.categoryId === categoryId && x.done);
  for (const it of done) deleteItemInternal(it); // 与单条删除一致，进回收站可恢复
  sync(); return true;
});
ipcMain.handle('category:add', (e, { name, kind }) => {
  const c = { id: 'c' + crypto.randomBytes(4).toString('hex'), name, kind };
  c.order = state.categories.reduce((m, x) => Math.max(m, x.order ?? -1), -1) + 1;
  state.categories.push(c); sync(); return c;
});
ipcMain.handle('category:reorder', (e, { ids }) => {
  const map = new Map(state.categories.map(c => [c.id, c]));
  const next = [];
  ids.forEach(id => { const c = map.get(id); if (c) { c.order = next.length; next.push(c); } });
  state.categories.forEach(c => { if (!ids.includes(c.id)) { c.order = next.length; next.push(c); } });
  state.categories = next;
  sync(); return true;
});
ipcMain.handle('category:rename', (e, { id, name }) => {
  const c = state.categories.find(x => x.id === id);
  if (c && name) { c.name = name; sync(); }
  return true;
});
ipcMain.handle('category:delete', (e, { id }) => {
  const c = state.categories.find(x => x.id === id);
  if (!c) return { error: '分类不存在' };
  const sameKind = state.categories.filter(x => x.kind === c.kind);
  if (sameKind.length <= 1) return { error: '至少保留一个' + (c.kind === 'todo' ? '待办' : '便签') + '分类' };
  const fallback = sameKind.find(x => x.id !== id);
  state.items.forEach(it => { if (it.categoryId === id) it.categoryId = fallback.id; });
  state.categories = state.categories.filter(x => x.id !== id);
  sync(); return { ok: true };
});
ipcMain.handle('settings:set', (e, patch) => {
  Object.assign(state.settings, patch);
  if ('autostart' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.autostart });
  if ('alwaysOnTop' in patch) {
    const mw = winMap.get('main');
    if (mw && !mw.isDestroyed()) mw.setAlwaysOnTop(!!patch.alwaysOnTop);
  }
  sync(); return true;
});
ipcMain.handle('attachment:add', (e, srcPath) => {
  try {
    fs.mkdirSync(ATT_DIR(), { recursive: true });
    const name = path.basename(srcPath);
    const dest = path.join(ATT_DIR(), crypto.randomBytes(4).toString('hex') + '_' + name);
    fs.copyFileSync(srcPath, dest);
    return { name: path.basename(dest), path: dest };
  } catch (err) { return { error: String(err) }; }
});
ipcMain.handle('attachment:addBuffer', (e, { name, buffer }) => {
  try {
    fs.mkdirSync(ATT_DIR(), { recursive: true });
    const rawExt = path.extname(name || '').toLowerCase() || '.png';
    const ext = /^\.(png|jpe?g|gif|webp|bmp)$/.test(rawExt) ? rawExt : '.png';
    const base = path.basename(name || 'image', rawExt).replace(/[^\w一-龥-]/g, '_').slice(0, 40) || 'image';
    const fname = crypto.randomBytes(4).toString('hex') + '_' + base + ext;
    const dest = path.join(ATT_DIR(), fname);
    fs.writeFileSync(dest, Buffer.from(buffer));
    return { name: fname, path: dest };
  } catch (err) { return { error: String(err) }; }
});
ipcMain.handle('attachment:delete', (e, { name, exceptId }) => {
  if (referencedByOther(name, exceptId)) return { ok: true, skipped: true }; // 仍被引用，只解除自身引用关系
  const p = attPathByName(name);
  if (!p || !fs.existsSync(p)) return { ok: true }; // 已不存在视为成功
  try { fs.rmSync(p); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; }
});
/* 回收站 */
ipcMain.handle('trash:restore', (e, deletedAt) => {
  const idx = state.trash.findIndex(x => x.deletedAt === deletedAt);
  if (idx < 0) return { error: '条目不存在' };
  const entry = state.trash[idx];
  const it = entry.item;
  // 原分类可能已被删除：缺失则落到同类型第一个分类
  if (!state.categories.some(c => c.id === it.categoryId)) {
    const fb = state.categories.find(c => c.kind === it.type) || state.categories[0];
    if (fb) it.categoryId = fb.id;
  }
  state.items.push(it);
  for (const n of itemAttachmentNames(it)) restoreFromTrashFile(n);
  state.trash.splice(idx, 1);
  sync(); return { ok: true };
});
ipcMain.handle('trash:purge', (e, deletedAt) => {
  const idx = state.trash.findIndex(x => x.deletedAt === deletedAt);
  if (idx < 0) return { error: '条目不存在' };
  const entry = state.trash[idx];
  for (const n of itemAttachmentNames(entry.item)) {
    if (!referencedByOther(n, entry.item.id)) purgeTrashFile(n);
  }
  state.trash.splice(idx, 1);
  sync(); return { ok: true };
});
ipcMain.handle('trash:clear', () => {
  // 先收集去重：回收站内多条可能引用同一文件，逐条判断会互相豁免导致永不删除
  const names = new Set();
  for (const entry of state.trash) for (const n of itemAttachmentNames(entry.item)) names.add(n);
  for (const n of names) {
    // 回收站将整体清空，只需确认活跃条目是否仍引用
    const liveUsed = state.items.some(it => itemAttachmentNames(it).includes(n));
    if (!liveUsed) purgeTrashFile(n);
  }
  state.trash = [];
  sync(); return { ok: true };
});
ipcMain.handle('window:open', (e, opts) => { try { createWin(opts.type, opts); return true; } catch (err) { return { error: String(err) }; } });
ipcMain.handle('window:close', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.hide(); return true; });
ipcMain.handle('window:reallyClose', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); return true; });
ipcMain.handle('window:minimize', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); return true; });
ipcMain.handle('window:resize', (e, { w, h }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setBounds({ width: w, height: h || win.getBounds().height });
  return true;
});
ipcMain.handle('window:setMinSize', (e, { w, h }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setMinimumSize(Math.round(w), Math.round(h));
  return true;
});
ipcMain.handle('window:ontop', (e, flag) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setAlwaysOnTop(!!flag); return true; });
ipcMain.handle('window:opacity', (e, v) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setOpacity(v / 100); return true; });
ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); });

/* ---------------- attach:// 图片协议 ---------------- */
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
function handleAttachRequest(request) {
  try {
    const u = request.url.slice('attach://'.length);
    const name = decodeURIComponent(u);
    const p = attPathByName(name);
    if (!p || !fs.existsSync(p)) return new Response(null, { status: 404 });
    const mime = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    return new Response(fs.readFileSync(p), { headers: { 'content-type': mime } });
  } catch (err) {
    return new Response(null, { status: 500 });
  }
}

/* ---------------- 应用生命周期 ---------------- */
let tray = null;
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('C便签');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主面板', click: showMain },
    { label: '日历月视图', click: () => showMainView('calendar') },
    { label: '设置', click: () => showMainView('settings') },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showMain);
}

// Windows：通知归属与任务栏分组依赖 AppUserModelId，必须在创建窗口前设置
if (process.platform === 'win32') app.setAppUserModelId('com.cbianqian.app');

/* 全局窗口与导航防护：外部内容永远不进入本应用窗口，window.api 不会暴露给远程页面 */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url); // 便签里的外链交给系统浏览器
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    // 只放行应用自身目录下的页面（含打包后的 app.asar 内路径）
    if (!url.startsWith(APP_ROOT_URL + '/')) e.preventDefault();
  });
  contents.on('will-attach-webview', e => e.preventDefault());
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', showMain);
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    try { protocol.handle('attach', handleAttachRequest); } catch (err) { console.error('attach protocol fail', err); }
    loadState();
    createTray();
    if (!process.env.FUSION_DEMO) createWin('main');
    setInterval(checkReminders, 15000);
    setTimeout(checkReminders, 5000);
    // FUSION_DEMO=1 时自动演示各视图（仅开发环境用于自动化验证，打包后永不激活）
    if (process.env.FUSION_DEMO && !app.isPackaged) {
      const run = js => {
        const mw = winMap.get('main');
        if (!mw) { console.log('DEMO ERR: no main window'); return; }
        mw.webContents.executeJavaScript(js).then(r => console.log('DEMO OK:', r)).catch(e => console.log('DEMO ERR:', String(e)));
      };
      setTimeout(() => createWin('main', { x: 430, y: 50 }), 800);
      setTimeout(() => run("switchView('list'); curCatId = 'c_gouwu'; render(); 'gouwu'"), 3000);
    }
    app.on('before-quit', () => { try { persist(); } catch (e) {} });
  });
  app.on('window-all-closed', e => { if (app.isQuitting) app.quit(); });
}

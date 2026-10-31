const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_FILE = () => path.join(app.getPath('userData'), 'data.json');
const ATT_DIR = () => path.join(app.getPath('userData'), 'attachments');

/* ---------------- 数据层 ---------------- */
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return ymd(new Date()); }
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
      { id: 'c_note', name: '便签', kind: 'note' },
      { id: 'c_todo', name: '待办', kind: 'todo' },
      { id: 'c_gouwu', name: '购物', kind: 'todo' }
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
      confirmDelete: false, autostart: false, tips: true, colorMode: 'dark', freeSort: true
    },
    fired: {}
  };
}

let state = null;
function loadState() {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8'));
  } catch (e) {
    state = defaultState();
    persist();
  }
}
function persist() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE()), { recursive: true });
    fs.writeFileSync(DATA_FILE(), JSON.stringify(state, null, 1));
  } catch (e) { console.error('persist fail', e); }
}
function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}
function sync() { persist(); broadcast('state', state); }

/* ---------------- 重复提醒展开 ---------------- */
function expand(r, ref, horizon = 95) {
  if (!r || !r.date) return [];
  const out = [];
  const start = new Date(r.date + 'T00:00:00');
  const end = new Date(ref); end.setDate(end.getDate() + horizon); end.setHours(23, 59, 59);
  const cap = r.endDate ? new Date(r.endDate + 'T23:59:59') : end;
  if (!r.repeat || r.repeat === 'none') { if (start <= cap) out.push(r.date); return out.sort(); }
  if (r.repeat === 'day') {
    for (let d = new Date(start); d <= end && d <= cap; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  } else if (r.repeat === 'week') {
    const wd = (r.repeatWeekdays && r.repeatWeekdays.length) ? r.repeatWeekdays : [start.getDay()];
    for (let d = new Date(start); d <= end && d <= cap; d.setDate(d.getDate() + 1)) if (wd.includes(d.getDay())) out.push(ymd(d));
  } else if (r.repeat === 'month') {
    const days = (r.repeatDays && r.repeatDays.length) ? r.repeatDays : [start.getDate()];
    const every = r.repeatEvery || 1;
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      for (const day of days) {
        const dt = new Date(cur.getFullYear(), cur.getMonth(), day);
        if (dt >= start && dt <= end && dt <= cap) out.push(ymd(dt));
      }
      cur.setMonth(cur.getMonth() + every);
    }
  } else if (r.repeat === 'year') {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      const dt = new Date(y, start.getMonth(), start.getDate());
      if (dt >= start && dt <= end && dt <= cap) out.push(ymd(dt));
    }
  }
  return [...new Set(out)].sort();
}

function checkReminders() {
  const now = new Date();
  let changed = false;
  for (const it of state.items) {
    const r = it.reminder; if (!r || !r.date) continue;
    for (const d of expand(r, now, 2)) {
      const dt = new Date(d + 'T' + (r.time || '09:00') + ':00');
      const delta = now - dt;
      if (delta >= 0 && delta < 10 * 60e3) {
        const key = it.id + '@' + d + 'T' + (r.time || '09:00');
        if (!state.fired[key]) {
          state.fired[key] = Date.now(); changed = true;
          fireNotification(it, dt, d);
        }
      }
    }
  }
  if (changed) {
    const week = Date.now() - 7 * 86400e3;
    for (const k of Object.keys(state.fired)) if (state.fired[k] < week) delete state.fired[k];
    sync();
  }
}
function fireNotification(it, dt, d) {
  const text = it.type === 'todo' ? it.text : String(it.html || '').replace(/<[^>]+>/g, ' ').trim();
  const rep = r => ({ none: '', day: '每天', week: '每周', month: '每月', year: '每年' }[r] || '');
  const n = new Notification({
    title: (it.reminder.important ? '⭐ 重要事项提醒' : 'C便签提醒') + ' ' + (dt.getHours() + ':' + pad(dt.getMinutes())),
    body: text.slice(0, 120) + (rep(it.reminder.repeat) ? '（' + rep(it.reminder.repeat) + '）' : ''),
    icon: path.join(__dirname, 'tray.png'),
    silent: false
  });
  n.on('click', () => { showMain(); });
  n.show();
}

/* ---------------- 窗口管理 ---------------- */
const winMap = new Map(); // key -> BrowserWindow
const commonWeb = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true, nodeIntegration: false, spellcheck: false
};
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

function createWin(type, opts = {}) {
  // 便签小窗：无 id（老入口）时用唯一 key，保证每次都开新窗
  const key = type === 'sticky' && !opts.id ? 'sticky:new' + Date.now() : type + (opts.id ? ':' + opts.id : '');
  if (winMap.has(key)) { const w = winMap.get(key); if (!w.isDestroyed()) { w.show(); w.focus(); return w; } winMap.delete(key); }
  let w;
  const base = { frame: false, transparent: true, backgroundColor: '#00000000', show: false, webPreferences: commonWeb };
  if (type === 'main') {
    w = new BrowserWindow({ ...base, width: 354, height: 680, minWidth: 74, minHeight: 300, alwaysOnTop: true, x: opts.x, y: opts.y });
    w.loadFile('src/panel/index.html');
    enableSnap(w, { onlyCollapsed: true });
  } else if (type === 'sticky') {
    w = new BrowserWindow({ ...base, width: 280, height: 300, minWidth: 220, minHeight: 180, x: opts.x, y: opts.y, alwaysOnTop: !!opts.ontop });
    w.loadFile('src/sticky/index.html', { query: { id: opts.id || '' } });
    enableSnap(w);
  } else if (type === 'editor') {
    w = new BrowserWindow({ ...base, width: 502, height: 660, minWidth: 430, minHeight: 520, x: opts.x, y: opts.y });
    w.loadFile('src/editor/index.html', { query: { id: opts.id || '', categoryId: opts.categoryId || '', date: opts.date || '', time: opts.time || '', autoprem: opts.autoprem || '', autock: opts.autock || '' } });
  }
  w.once('ready-to-show', () => {
    w.show();
    if (type === 'main' && state) w.setOpacity((state.settings.transparency ?? 95) / 100);
  });
  w.on('closed', () => { if (winMap.get(key) === w) winMap.delete(key); });
  winMap.set(key, w);
  return w;
}
function showMain() { createWin('main'); const w = winMap.get('main'); if (w) { w.show(); w.focus(); } }

function setEmbedDesktop(w, flag) {
  if (flag) {
    w.setSkipTaskbar(true);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setAlwaysOnTop(false, 'screen-saver');
    w.blur();
  } else {
    w.setAlwaysOnTop(false);
    w.setSkipTaskbar(false);
    w.show(); w.focus();
  }
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
  const i = state.items.findIndex(x => x.id === item.id);
  item.updatedAt = Date.now();
  if (i >= 0) state.items[i] = { ...state.items[i], ...item };
  else { item.createdAt = Date.now(); state.items.push(item); }
  sync(); return item.id;
});
ipcMain.handle('item:patch', (e, { id, patch }) => {
  const it = state.items.find(x => x.id === id); if (!it) return false;
  Object.assign(it, patch, { updatedAt: Date.now() });
  if (patch.reminder === null) { // 清除提醒时清理 fired
    for (const k of Object.keys(state.fired)) if (k.startsWith(id + '@')) delete state.fired[k];
  }
  sync(); return true;
});
ipcMain.handle('item:delete', (e, id) => {
  state.items = state.items.filter(x => x.id !== id);
  for (const k of Object.keys(state.fired)) if (k.startsWith(id + '@')) delete state.fired[k];
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
  state.items = state.items.filter(x => !(x.type === 'todo' && x.categoryId === categoryId && x.done));
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
  sync();
  return { ok: true };
});
ipcMain.handle('settings:set', (e, patch) => {
  Object.assign(state.settings, patch);
  if ('autostart' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.autostart });
  sync(); return true;
});
ipcMain.handle('attachment:add', (e, srcPath) => {
  try {
    fs.mkdirSync(ATT_DIR(), { recursive: true });
    const name = path.basename(srcPath);
    const dest = path.join(ATT_DIR(), crypto.randomBytes(4).toString('hex') + '_' + name);
    fs.copyFileSync(srcPath, dest);
    return { name, path: dest };
  } catch (err) { return { error: String(err) }; }
});
ipcMain.handle('window:open', (e, opts) => { createWin(opts.type, opts); return true; });
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
ipcMain.handle('window:embed', (e, flag) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) setEmbedDesktop(w, flag); return true; });
ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); });

/* ---------------- 应用生命周期 ---------------- */
let tray = null;
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('C便签');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主面板', click: showMain },
    { label: '日历月视图', click: () => createWin('calendar') },
    { label: '设置', click: () => createWin('settings') },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showMain);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', showMain);
  app.whenReady().then(() => {
    loadState();
    createTray();
    if (!process.env.FUSION_DEMO) createWin('main');
    setInterval(checkReminders, 15000);
    setTimeout(checkReminders, 5000);
    // FUSION_DEMO=1 时自动演示各视图（用于自动化验证）
    if (process.env.FUSION_DEMO) {
      const run = js => {
        const mw = winMap.get('main');
        if (!mw) { console.log('DEMO ERR: no main window'); return; }
        mw.webContents.executeJavaScript(js).then(r => console.log('DEMO OK:', js, '->', r)).catch(e => console.log('DEMO ERR:', js, String(e)));
      };
      setTimeout(() => createWin('main', { x: 430, y: 50 }), 800);
      // 打开带图便签的编辑器，验证图片块级排版
      setTimeout(() => {
        const it = state.items.find(i => (i.html || '').includes('<img'));
        if (it) createWin('editor', { id: it.id, x: 830, y: 60 });
      }, 3500);
      // 打开同一便签的小窗，验证小窗图片排版
      setTimeout(() => {
        const it = state.items.find(i => (i.html || '').includes('<img'));
        if (it) createWin('sticky', { id: it.id, x: 60, y: 80, ontop: true });
      }, 5000);
      setTimeout(() => run("switchView('list'); 'list'"), 8000);
      // 购物分类：填价格/类型/渠道 → 打开详情弹窗
      setTimeout(() => run("switchView('list'); curCatId = 'c_gouwu'; render(); 'gouwu'"), 9500);
      setTimeout(() => run("state.items.filter(i => i.type === 'todo' && i.categoryId === 'c_gouwu').forEach((t, i) => api.patchItem(t.id, { price: (i + 1) * 3.5, buyType: '生鲜', channel: '超市' })); 'priced'"), 11000);
      setTimeout(() => run("const t = state.items.find(i => i.type === 'todo' && i.categoryId === 'c_gouwu'); openTodoDetail(t.id); 'dlg'"), 12500);
      // 合成拖拽：把第二个分类拖到第一个位置，验证侧边栏排序
      setTimeout(() => run(`
        const bar = document.getElementById('sideBar');
        const items = [...bar.querySelectorAll('.side-item[data-cat]')].filter(el => !el.dataset.cat.startsWith('#'));
        const dt = new DataTransfer();
        items[1].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
        items[0].dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: items[0].getBoundingClientRect().top + 4 }));
        items[0].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        items[1].dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
        'dragged'
      `), 9500);
    }
  });
  app.on('window-all-closed', e => { if (app.isQuitting) app.quit(); });
}

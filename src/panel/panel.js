/* ================= C便签 主面板 ================= */
let state = null;
let curCatId = 'c_note';
let filterMode = 'all';
let searchKey = '';
let timelineMode = false;
let collapsed = false;
let qaReminder = null;
let curView = 'list';               // list | calendar | settings
let cal = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
let calMode = 'month';
let weekOffset = 0;
let calSort = '按提醒';

const $ = id => document.getElementById(id);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

async function init() {
  state = await api.load();
  api.setMinSize(320, 560);
  const savedCat = localStorage.getItem('curCat');
  if (savedCat && state.categories.some(c => c.id === savedCat)) curCatId = savedCat;
  render();
  fillSettings();
  api.onState(s => { state = s; if (curView === 'list') render(); if (curView === 'calendar') renderCalView(); });
}

function curCat() { return state.categories.find(c => c.id === curCatId) || state.categories[0]; }

/* ---------- 视图切换 ---------- */
function switchView(v) {
  if (curView === v && v !== 'list') v = 'list';
  curView = v;
  $('viewList').style.display = v === 'list' ? 'flex' : 'none';
  $('viewCalendar').style.display = v === 'calendar' ? 'flex' : 'none';
  $('viewSettings').style.display = v === 'settings' ? 'flex' : 'none';
  $('btnCal').classList.toggle('act', v === 'calendar');
  if (v === 'calendar') { api.resizeWin(724, 664); api.setMinSize(600, 520); renderCalView(); }
  else { api.resizeWin(354, 680); api.setMinSize(320, 560); }
  if (v === 'settings') fillSettings();
  if (v === 'list') render();
}

/* ---------- 侧边栏 ---------- */
function dueCount() {
  const now = new Date();
  return state.items.filter(it => {
    if (it.done || !it.reminder) return false;
    return UI.expand(it.reminder, UI.ymd(now), UI.ymd(now)).includes(UI.ymd(now));
  }).length;
}
function renderSide() {
  if (!curCatId.startsWith('#') && !state.categories.some(c => c.id === curCatId)) {
    curCatId = state.categories[0] ? state.categories[0].id : 'c_note';
  }
  const bar = $('sideBar');
  const impCnt = state.items.filter(i => !i.done && i.reminder && i.reminder.important).length;
  let html = `<div class="side-item side-logo" id="sideBrand" title="${collapsed ? '展开面板' : '折叠面板'}">${collapsed ? '⌄' : 'C签'}</div>`;
  for (const c of state.categories) {
    const items = state.items.filter(i => i.categoryId === c.id);
    const n = items.filter(i => !i.done).length; // 角标只数未完成，清零自动隐藏
    html += `<div class="side-item ${c.id === curCatId ? 'on' : ''}" data-cat="${c.id}" title="右键可重命名/删除">${c.name}<br><span style="font-size:10px;color:#7c8fa3">${n}</span>${n ? `<span class="dot">${n}</span>` : ''}</div>`;
  }
  html += `<div class="side-item ${curCatId === '#important' ? 'on' : ''}" data-cat="#important">重要${impCnt ? `<span class="dot">${impCnt}</span>` : ''}</div>`;
  html += `<div class="side-item side-add" id="sideAdd" title="新增分类">＋</div>`;
  bar.innerHTML = html;
  bar.querySelectorAll('[data-cat]').forEach(el => {
    const cid = el.dataset.cat;
    el.onclick = () => {
      if (curView !== 'list') switchView('list');
      curCatId = cid; timelineMode = false;
      localStorage.setItem('curCat', curCatId); render();
    };
    // 分类拖拽排序（重要/品牌位/＋不参与）
    if (!cid.startsWith('#')) {
      el.draggable = true;
      el.addEventListener('dragstart', e => {
        el.classList.add('dragging');
        e.dataTransfer.setData('text/plain', cid);
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dragging = bar.querySelector('.side-item.dragging');
        if (!dragging || dragging === el) return;
        const r = el.getBoundingClientRect();
        const after = (e.clientY - r.top) > r.height / 2;
        bar.insertBefore(dragging, after ? el.nextSibling : el);
      });
      el.addEventListener('drop', e => {
        e.preventDefault();
        const ids = [...bar.querySelectorAll('.side-item[data-cat]')]
          .map(x => x.dataset.cat).filter(c => !c.startsWith('#'));
        api.reorderCategories(ids);
      });
    }
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const cid = el.dataset.cat;
      if (cid.startsWith('#')) return;
      const c = state.categories.find(x => x.id === cid);
      if (!c) return;
      const open = () => UI.showMenu([
        { label: '重命名', icon: '✎', action: async () => {
          const v = await UI.promptBox('重命名分类：', '输入新名称', c.name);
          if (v) await api.renameCategory(cid, v.trim());
        } },
        'sep',
        { label: '删除分类', icon: '🗑', danger: true, action: async () => {
          if (await UI.confirmBox(`删除分类「${c.name}」？<br>其中内容将移入同类型的第一个分类`)) {
            const r = await api.deleteCategory(cid);
            if (r && r.error) UI.toast(r.error);
          }
        } },
      ], e.clientX, e.clientY);
      // 折叠态窗口只有 74px，菜单放不下：先展开再弹
      if (collapsed) { toggleCollapse(); setTimeout(open, 60); } else open();
    });
  });
  $('sideAdd').onclick = async () => {
    const name = await UI.promptBox('新增分类名称：', '输入分类名');
    if (!name) return;
    const c = await api.addCategory(name.trim(), curCat().kind);
    curCatId = c.id; render();
  };
  const brand = $('sideBrand');
  if (brand) brand.onclick = toggleCollapse;
}
function toggleCollapse() {
  if (!collapsed && curView !== 'list') switchView('list');
  collapsed = !collapsed;
  $('panelMain').style.display = collapsed ? 'none' : 'flex';
  $('sideBar').style.borderRadius = '';
  if (collapsed) { api.resizeWin(74, 680); api.setMinSize(74, 300); }
  else { api.resizeWin(354, 680); api.setMinSize(320, 560); }
  renderSide();
}

/* ---------- 列表 ---------- */
function itemsOfCurrent() {
  const now = new Date();
  if (curCatId === '#important') return state.items.filter(it => !it.done && it.reminder && it.reminder.important);
  return state.items.filter(it => it.categoryId === curCatId);
}
function renderList() {
  const cat = curCat();
  const isTodoCat = cat.kind === 'todo';
  renderBuyStats();
  updateQuickAddText();
  $('catName').textContent = curCatId === '#important' ? '重要' : cat.name;
  let items = itemsOfCurrent();
  if (filterMode === 'done') items = items.filter(i => i.done);
  if (filterMode === 'undone') items = items.filter(i => !i.done);
  if (searchKey) items = items.filter(i => (i.text || UI.plainText(i.html || '')).toLowerCase().includes(searchKey.toLowerCase()));
  $('catCnt').textContent = items.length;

  const list = $('noteList');
  if (timelineMode) { renderTimeline(items); return; }
  if (isTodoCat) {
    $('btnClearDone').style.display = items.some(i => i.type === 'todo' && i.done) ? 'inline-block' : 'none';
    const todos = items.filter(i => i.type === 'todo').sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
    const notes = items.filter(i => i.type !== 'todo');
    list.innerHTML = todos.map(todoRowHTML).join('') + notes.map(noteItemHTML).join('') ||
      '<div class="empty-tip">清单空空如也<br>点击上方「＋ 新增」添加待办</div>';
    bindTodoEvents(list);
  } else {
    $('btnClearDone').style.display = 'none';
    // 完成的沉底，其余按更新时间倒序
    const sorted = items.sort((a, b) => ((a.done ? 1 : 0) - (b.done ? 1 : 0)) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
    list.innerHTML = sorted.map(noteItemHTML).join('') || '<div class="empty-tip">暂无内容<br>点击上方「＋ 新增」记录一条吧</div>';
    bindNoteEvents(list);
  }
}
function render() { renderSide(); renderList(); renderChrome(); }

function noteItemHTML(it) {
  const colorMap = { default: '#5a6b7e', yellow: '#f5c451', green: '#86e3b4', pink: '#ff9fce', purple: '#c7a7ff', blue: '#8fc7ff', gray: '#aab4be', dark: '#5a6b7e', teal: '#7fd8e8' };
  const rem = it.reminder;
  let remRow = '';
  if (rem) {
    const rep = UI.repeatText(rem);
    remRow = `<div class="rem-row">⏰ ${rem.date} ${UI.weekdayCN(rem.date)} ${rem.time ? rem.time.slice(0, 5) : ''}${rep ? ` <span class="rep">${rep}</span>` : ''}${rem.important ? ' ⭐' : ''}</div>`;
  }
  const att = (it.attachments || []).map(a => `<span class="att">📎 ${a.name}</span>`).join('');
  return `<div class="note-item ${it.done ? 'is-done' : ''}" data-id="${it.id}">
    <div class="top-row">
      ${it.done
        ? '<div class="bdot-done">✓</div>'
        : `<div class="bdot" style="background:${colorMap[it.color] || colorMap.default}"></div>`}
      <div class="body">${UI.fixAttach(it.html) || ''}</div>
      <div class="time-tag">${UI.fmtTime(it.createdAt || it.updatedAt)}</div>
      ${it.done ? '<span class="done-tag">已完成</span>' : ''}
    </div>${remRow}${att ? `<div class="att-row">${att}</div>` : ''}
  </div>`;
}
function todoRowHTML(it) {
  const rem = it.reminder;
  const meta = [it.buyType ? `🏷 ${esc(it.buyType)}` : '', it.channel ? `🛒 ${esc(it.channel)}` : ''].filter(Boolean).join('');
  const price = (it.price ?? '') === '' ? '' : it.price;
  return `<div class="todo-row" data-id="${it.id}" draggable="${state.settings.freeSort !== false}">
    <div class="chk ${it.done ? 'on' : ''}">✓</div>
    <div class="txt ${it.done ? 'done' : ''}">
      <div class="t-line">${esc(it.text)}${rem ? ` <span class="tr-time">⏰ ${rem.date} ${rem.time || ''}</span>` : ''}</div>
      ${meta ? `<div class="t-meta">${meta}</div>` : ''}
    </div>
    <input class="price-inp" draggable="false" inputmode="decimal" placeholder="¥" title="价格（人民币元）" value="${price}">
    <div class="grip">⋮⋮</div>
  </div>`;
}
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderTimeline(items) {
  const now = new Date();
  const from = UI.ymd(addDays(now, -30)), to = UI.ymd(addDays(now, 95));
  const withRem = items.filter(i => i.reminder).map(i => ({ i, dates: UI.expand(i.reminder, from, to) }))
    .flatMap(({ i, dates }) => dates.map(d => ({ i, d }))).filter(x => x.d >= UI.ymd(new Date(Date.now() - 30 * 86400e3)))
    .sort((a, b) => (a.d + (a.i.reminder.time || '')).localeCompare(b.d + (b.i.reminder.time || '')));
  if (!withRem.length) { $('noteList').innerHTML = '<div class="empty-tip">暂无提醒事项</div>'; return; }
  let html = '', last = '';
  for (const { i, d } of withRem) {
    if (d !== last) { html += `<div class="tl-date">${d} ${UI.weekdayCN(d)}${d === UI.ymd(new Date()) ? ' · 今天' : ''}</div>`; last = d; }
    html += noteItemHTML(i);
  }
  $('noteList').innerHTML = html;
  bindNoteEvents($('noteList'));
}

/* ---------- 便签条目事件 ---------- */
function bindNoteEvents(list) {
  list.querySelectorAll('.note-item').forEach(el => {
    const id = el.dataset.id;
    const item = () => state.items.find(x => x.id === id);
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const it = item(); if (!it) return;
      const cats = state.categories.filter(c => c.kind === 'note' && c.id !== it.categoryId);
      UI.showMenu([
        { label: '编辑', icon: '✎', action: () => api.openWindow({ type: 'editor', id }) },
        { label: it.done ? '取消完成' : '完成', icon: '✔', action: () => api.patchItem(id, { done: !it.done }) },
        { label: '添加提醒', icon: '⏰', action: () => api.openWindow({ type: 'editor', id }) },
        { label: '便签颜色', icon: '🎨', sub: COLORS.map(c => ({ label: c.name, checked: it.color === c.key, action: () => api.patchItem(id, { color: c.key }) })) },
        'sep',
        { label: '复制本条', icon: '⧉', action: () => { api.duplicateItem(id); UI.toast('已复制本条'); } },
        { label: '移动', icon: '⇄', sub: cats.length ? cats.map(c => ({ label: c.name, action: () => api.patchItem(id, { categoryId: c.id }) })) : [{ label: '（无其他分类）', action: () => {} }] },
        { label: '贴到桌面', icon: '📌', action: () => cloudFloat(it) },
        'sep',
        { label: '删除本条', icon: '🗑', danger: true, action: async () => { if (await askDelete('确定删除这条内容吗？')) api.deleteItem(id); } },
      ], e.clientX, e.clientY);
    });
    el.addEventListener('dblclick', () => api.openWindow({ type: 'editor', id }));
    const bodyEl = el.querySelector('.body');
    if (bodyEl) bodyEl.addEventListener('click', async e => {
      const box = e.target.closest('.ck-box');
      if (!box) return;
      box.parentElement.classList.toggle('done');
      await api.patchItem(id, { html: bodyEl.innerHTML });
    });
  });
}
/* ---------- 购物统计 / 新增文案 ---------- */
function renderBuyStats() {
  const box = $('buyStats');
  const cat = curCat();
  if (cat.kind !== 'todo') { box.style.display = 'none'; return; }
  const todos = itemsOfCurrent().filter(i => i.type === 'todo');
  if (!todos.length) { box.style.display = 'none'; return; }
  const sum = a => a.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const un = todos.filter(i => !i.done), dn = todos.filter(i => i.done);
  box.style.display = 'grid';
  box.innerHTML = `
    <div class="bs-cell"><div class="k">待买 ${un.length} 件</div><div class="v ys">¥${sum(un).toFixed(2)}</div></div>
    <div class="bs-cell"><div class="k">已买 ${dn.length} 件</div><div class="v gs">¥${sum(dn).toFixed(2)}</div></div>
    <div class="bs-cell"><div class="k">合计</div><div class="v">¥${sum(todos).toFixed(2)}</div></div>`;
}
function updateQuickAddText() {
  const cat = curCat();
  if (cat.kind === 'todo') {
    const shop = cat.name === '购物';
    $('quickAdd').textContent = shop ? '＋ 新增物品' : '＋ 新增待办';
    $('qaText').placeholder = shop ? '请输入物品名称' : '请输入待办内容';
  } else {
    $('quickAdd').textContent = '＋ 新增便签';
    $('qaText').placeholder = '请输入便签内容';
  }
}

/* ---------- 详情弹窗（价格/类型/渠道） ---------- */
function openTodoDetail(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  const ea = s => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const mask = document.createElement('div');
  mask.className = 'rem-panel';
  mask.innerHTML = `<div class="rem-box">
    <h4>编辑要买的东西</h4>
    <div class="frow"><label>名称</label><input type="text" id="dtText" value="${ea(it.text)}" style="flex:1"></div>
    <div class="frow"><label>价格 ¥</label><input type="text" id="dtPrice" inputmode="decimal" value="${it.price ?? ''}" placeholder="0.00" style="width:96px"></div>
    <div class="frow"><label>类型</label><input type="text" id="dtType" value="${ea(it.buyType)}" placeholder="如：生鲜 / 日用 / 数码" style="flex:1"></div>
    <div class="frow"><label>渠道</label><input type="text" id="dtChannel" value="${ea(it.channel)}" placeholder="如：淘宝 / 京东 / 超市" style="flex:1"></div>
    ${it.reminder ? `<div class="frow"><label>提醒</label><span class="chip remind">⏰ ${it.reminder.date} ${(it.reminder.time || '').slice(0, 5)}</span></div>` : ''}
    <div class="btns"><button class="btn ghost" id="dtCancel">取消</button><button class="btn primary" id="dtOk">保存</button></div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('#dtCancel').onclick = close;
  mask.querySelector('#dtOk').onclick = async () => {
    const text = mask.querySelector('#dtText').value.trim();
    if (!text) { UI.toast('名称不能为空'); return; }
    const pv = parseFloat(mask.querySelector('#dtPrice').value);
    await api.patchItem(id, {
      text,
      price: isNaN(pv) ? null : pv,
      buyType: mask.querySelector('#dtType').value.trim(),
      channel: mask.querySelector('#dtChannel').value.trim()
    });
    close();
  };
  mask.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  mask.querySelector('#dtText').focus();
}

function bindTodoEvents(list) {
  list.querySelectorAll('.todo-row').forEach(el => {
    const id = el.dataset.id;
    const item = () => state.items.find(x => x.id === id);
    el.querySelector('.chk').onclick = () => { const it = item(); if (it) api.patchItem(id, { done: !it.done }); };
    // 价格输入框（行内）
    const pinp = el.querySelector('.price-inp');
    pinp.addEventListener('mousedown', e => e.stopPropagation());
    pinp.addEventListener('dblclick', e => e.stopPropagation());
    pinp.addEventListener('keydown', e => { if (e.key === 'Enter') pinp.blur(); });
    pinp.addEventListener('change', () => {
      const v = parseFloat(pinp.value);
      api.patchItem(id, { price: isNaN(v) ? null : v });
    });
    // 双击整行 → 详情弹窗
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.price-inp') || e.target.closest('.chk')) return;
      openTodoDetail(id);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const it = item(); if (!it) return;
      UI.showMenu([
        { label: '编辑', icon: '✎', action: () => openTodoDetail(id) },
        { label: it.done ? '取消完成' : '完成', icon: '✔', action: () => api.patchItem(id, { done: !it.done }) },
        { label: '添加提醒', icon: '⏰', action: () => api.openWindow({ type: 'editor', id }) },
        'sep',
        { label: '复制本条', icon: '⧉', action: () => { api.duplicateItem(id); UI.toast('已复制'); } },
        { label: '删除本条', icon: '🗑', danger: true, action: async () => { if (await askDelete('确定删除这条待办吗？')) api.deleteItem(id); } },
      ], e.clientX, e.clientY);
    });
    el.addEventListener('dragstart', e => { el.classList.add('dragging'); e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = list.querySelector('.dragging');
      if (!dragging || dragging === el) return;
      const r = el.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      list.insertBefore(dragging, after ? el.nextSibling : el);
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      api.reorderTodos([...list.querySelectorAll('.todo-row')].map(x => x.dataset.id));
    });
  });
}
async function askDelete(msg) {
  if (!state.settings.confirmDelete) return true;
  return UI.confirmBox(msg);
}

/* ---------- 云游 ---------- */
const COLORS = [
  { key: 'yellow', name: '黄色', css: '#fff8b8' }, { key: 'green', name: '绿色', css: '#cdf5c0' },
  { key: 'pink', name: '粉色', css: '#ffd9f2' }, { key: 'purple', name: '紫色', css: '#e3d1fb' },
  { key: 'blue', name: '蓝色', css: '#c8ecfd' }, { key: 'gray', name: '灰色', css: '#e9e9e9' },
  { key: 'dark', name: '深色', css: '#3b3b3b' }
];
async function cloudFloat(it) {
  const x = 100 + Math.round(Math.random() * 300), y = 100 + Math.round(Math.random() * 200);
  await api.openWindow({ type: 'sticky', id: it.id, x, y, ontop: true });
  UI.toast('已贴到桌面（便签窗口）');
}

/* ---------- 快捷新增 ---------- */
function openQuickAdd() {
  $('quickAdd').style.display = 'none';
  $('qaEditor').style.display = 'block';
  $('qaText').value = ''; qaReminder = null; renderQaChips();
  $('qaText').focus();
}
function closeQuickAdd() {
  $('qaEditor').style.display = 'none';
  $('quickAdd').style.display = 'block';
}
function renderQaChips() {
  const box = $('qaChips');
  box.innerHTML = qaReminder ? `<span class="remind-chip">⏰ ${qaReminder.date} ${UI.weekdayCN(qaReminder.date)} ${qaReminder.time}${UI.repeatText(qaReminder) ? ' ' + UI.repeatText(qaReminder) : ''} <span class="x" id="qaChipX">✕</span></span>` : '';
  if (qaReminder) $('qaChipX').onclick = () => { qaReminder = null; renderQaChips(); };
}
async function saveQuickAdd() {
  const text = $('qaText').value.trim();
  if (!text && !qaReminder) { UI.toast('请输入内容'); return; }
  const cat = curCat();
  if (cat.kind === 'todo') {
    const maxOrder = Math.max(-1, ...state.items.filter(i => i.categoryId === cat.id && i.type === 'todo').map(i => i.order || 0));
    await api.upsertItem({ id: UI.uid(), type: 'todo', categoryId: cat.id, text, reminder: qaReminder, done: false, order: maxOrder + 1 });
  } else {
    await api.upsertItem({ id: UI.uid(), type: 'note', categoryId: cat.id, color: 'default', html: esc(text), reminder: qaReminder, done: false, attachments: [] });
  }
  $('qaText').value = ''; qaReminder = null; renderQaChips(); render();
}

/* ---------- 日历视图 ---------- */
function buildEventMap(fromStr, toStr) {
  const now = new Date();
  const map = {};
  for (const it of state.items) {
    if (!it.reminder) continue;
    for (const d of UI.expand(it.reminder, fromStr, toStr)) {
      (map[d] = map[d] || []).push(it);
    }
  }
  for (const d of Object.keys(map)) {
    if (calSort === '按提醒') map[d].sort((a, b) => (a.reminder.time || '').localeCompare(b.reminder.time || ''));
    else map[d].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return map;
}
function chipHTML(it) {
  const colorIdx = ({ default: 0, yellow: 0, green: 1, purple: 2, pink: 3, blue: 1, gray: 6, dark: 6, teal: 5 })[it.color] ?? 0;
  const txt = it.type === 'todo' ? it.text : UI.plainText(it.html || '');
  return `<div class="ev-chip ev-c${colorIdx} ${it.done ? 'done' : ''}" data-id="${it.id}" title="${escAttr(txt)}">${it.reminder.important ? '<span class="star">★</span>' : ''}${escAttr(txt) || '（空）'}</div>`;
}
function escAttr(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function bindChipMenu(container) {
  container.querySelectorAll('.ev-chip').forEach(el => {
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = el.dataset.id;
      const it = state.items.find(x => x.id === id); if (!it) return;
      UI.showMenu([
        { label: '打开', icon: '✎', action: () => api.openWindow({ type: 'editor', id }) },
        { label: '复制', icon: '⧉', action: () => { api.duplicateItem(id); UI.toast('已复制'); } },
        { label: it.done ? '取消完成' : '完成', icon: '✔', action: () => api.patchItem(id, { done: !it.done }) },
        { label: '清除', icon: '⌫', action: () => api.patchItem(id, { reminder: null }) },
        'sep',
        { label: '删除', icon: '🗑', danger: true, action: () => api.deleteItem(id) },
      ], e.clientX, e.clientY);
    });
    el.addEventListener('dblclick', () => api.openWindow({ type: 'editor', id: el.dataset.id }));
  });
}
async function renderCalView() {
  const { year: y, month: m } = cal;
  $('calYm').textContent = y + '年' + m + '月';
  const ws = state.settings.weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  $('calWeek').innerHTML = ws.map(w => `<div class="${w === 0 || w === 6 ? 'cal-weekend' : ''}">周${UI.WEEK[w]}</div>`).join('');
  const lunar = await api.lunarMonth(y, m);
  if (cal.year !== y || cal.month !== m) return; // 已切月则放弃本次渲染
  $('calLunarTag').textContent = lunar.lunarYearMonth;
  const lunarMap = {};
  lunar.days.forEach(d => lunarMap[d.d] = d);
  const todayStr = UI.ymd(new Date());

  if (calMode === 'week') {
    const start = weekStart_(weekOffset);
    const wMap = buildEventMap(UI.ymd(start), UI.ymd(new Date(start.getTime() + 6 * 86400e3)));
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const ds = UI.ymd(d);
      html += `<div class="calv-wcol ${ds === todayStr ? 'today' : ''}" data-date="${ds}"><div class="hd">${d.getMonth() + 1}/${d.getDate()} 周${UI.WEEK[d.getDay()]}</div>${(wMap[ds] || []).map(chipHTML).join('') || '<div style="text-align:center;color:#4a5a6d;font-size:11px;margin-top:14px">—</div>'}</div>`;
    }
    $('calGrid').className = 'calv-weekgrid';
    $('calGrid').innerHTML = html;
    bindChipMenu($('calGrid'));
    $('calGrid').querySelectorAll('.calv-wcol').forEach(el => el.addEventListener('dblclick', e => {
      if (e.target.closest('.ev-chip')) return;
      openEditorAt(el.dataset.date);
    }));
    return;
  }

  $('calGrid').className = 'calv-grid';
  const first = new Date(y, m - 1, 1);
  const ws0 = state.settings.weekStart === 0 ? 0 : 1;
  const lead = (first.getDay() - ws0 + 7) % 7;
  const evMap = buildEventMap(UI.ymd(new Date(y, m - 1, 1 - 7)), UI.ymd(new Date(y, m, 0 + 7)));
  const rendering = [];
  const prevLast = new Date(y, m - 1, 0).getDate();
  for (let i = lead; i > 0; i--) rendering.push({ d: prevLast - i + 1, other: true, pm: true });
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) rendering.push({ d, other: false });
  let nd = 1;
  while (rendering.length < 42) rendering.push({ d: nd++, other: true, nm: true });

  let html = '';
  for (let r = 0; r < 6; r++) {
    html += '<div class="cal-row" style="display:contents">';
    for (let c = 0; c < 7; c++) {
      const cell = rendering[r * 7 + c];
      const dateStr = cell.other
        ? (cell.pm ? UI.ymd(new Date(y, m - 2, cell.d)) : UI.ymd(new Date(y, m, cell.d)))
        : `${y}-${String(m).padStart(2, '0')}-${String(cell.d).padStart(2, '0')}`;
      const ld = cell.other ? null : lunarMap[cell.d];
      let lunarTxt = '', lunarCls = '';
      if (state.settings.showLunar && ld) {
        if (ld.fest) { lunarTxt = ld.fest; lunarCls = 'fest'; }
        else if (ld.jieqi) { lunarTxt = ld.jieqi; lunarCls = 'jieqi'; }
        else if (ld.monthTag) lunarTxt = ld.monthTag;
        else lunarTxt = ld.lunarDay;
      }
      const evs = (evMap[dateStr] || []).slice(0, 3);
      html += `<div class="calv-cell ${cell.other ? 'other' : ''} ${dateStr === todayStr ? 'today' : ''}" data-date="${dateStr}">
        <span class="dnum">${cell.d}</span>${lunarTxt ? `<span class="lunar ${lunarCls}">${lunarTxt}</span>` : ''}
        ${evs.map(chipHTML).join('')}
      </div>`;
    }
  }
  $('calGrid').innerHTML = html;
  bindChipMenu($('calGrid'));
  $('calGrid').querySelectorAll('.calv-cell').forEach(el => {
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.ev-chip')) return;
      openEditorAt(el.dataset.date);
    });
  });
}
function openEditorAt(dateStr) {
  const cat = state.categories.find(c => c.kind === 'note');
  api.openWindow({ type: 'editor', categoryId: cat ? cat.id : 'c_note', date: dateStr || UI.ymd(new Date()), time: '08:00' });
}
function weekStart_(offset) {
  const d = new Date();
  const ws = state.settings.weekStart === 0 ? 0 : 1;
  const off = (d.getDay() - ws + 7) % 7;
  d.setDate(d.getDate() - off + offset);
  return d;
}
function shiftCal(n) {
  if (calMode === 'week') { weekOffset += n; }
  else {
    let mm = cal.month + n, yy = cal.year;
    if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; }
    cal = { year: yy, month: mm };
  }
  renderCalView();
}
function showOpacityPop(x, y) {
  UI.closeMenu();
  const old = document.querySelector('.opacity-pop');
  if (old) old.remove();
  const pop = document.createElement('div');
  pop.className = 'opacity-pop';
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  pop.innerHTML = '<button class="close-x">✕</button><input type="range" min="30" max="100" value="' + Math.round((state.settings.transparency ?? 95)) + '" style="width:100%"><div class="val">0</div>';
  document.body.appendChild(pop);
  const range = pop.querySelector('input'), val = pop.querySelector('.val');
  const upd = () => { val.textContent = range.value + ' / 100'; api.setOpacity(+range.value); };
  upd();
  range.oninput = () => { upd(); api.setSettings({ transparency: +range.value }); };
  // 点外部 / Esc / ✕ 均关闭
  const close = () => { pop.remove(); document.removeEventListener('mousedown', closer, true); document.removeEventListener('keydown', escClose, true); };
  const closer = ev => { if (!pop.contains(ev.target)) close(); };
  const escClose = ev => { if (ev.key === 'Escape') close(); };
  setTimeout(() => {
    document.addEventListener('mousedown', closer, true);
    document.addEventListener('keydown', escClose, true);
  }, 0);
  pop.querySelector('.close-x').onclick = close;
}

/* ---------- 设置视图 ---------- */
function fillSettings() {
  const s = state.settings;
  renderTrash();
  $('setNick').value = s.nickname || '追梦人';
  $('setAvatar').textContent = (s.nickname || '追')[0];
  $('swTips').classList.toggle('on', !!s.tips);
  $('swConfirm').classList.toggle('on', !!s.confirmDelete);
  $('swAuto').classList.toggle('on', !!s.autostart);
  const scb = $('selColorBox');
  if (scb) {
    scb.innerHTML = '';
    scb.appendChild(UI.dropdown(s.colorMode || 'dark', [
      { v: 'dark', l: '暗' }, { v: 'light', l: '亮' }, { v: 'system', l: '使用我的 Windows 模式' }
    ], v => api.setSettings({ colorMode: v })));
  }
  $('opRange').value = s.transparency ?? 95;
}
function renderTrash() {
  const box = $('trashList');
  if (!box) return;
  if (!state.trash.length) { box.innerHTML = '<div class="set-row" style="border-bottom:0"><div class="lb sub">回收站是空的</div></div>'; return; }
  box.innerHTML = state.trash.slice().reverse().map(t => {
    const it = t.item;
    const txt = esc(it.type === 'todo' ? it.text : UI.plainText(it.html || '')) || '（空）';
    const time = new Date(t.deletedAt);
    return `<div class="set-row"><div class="lb" style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${txt}</div><div class="sub">${time.getMonth() + 1}/${time.getDate()} ${UI.pad2(time.getHours())}:${UI.pad2(time.getMinutes())} 删除</div></div>
      <button class="btn ghost" style="font-size:11px;padding:3px 10px" data-restore="${t.deletedAt}">恢复</button>
      <button class="btn ghost" style="font-size:11px;padding:3px 10px;color:#ff8f8f" data-purge="${t.deletedAt}">彻底删除</button></div>`;
  }).join('');
  box.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
    const r = await api.trashRestore(Number(b.dataset.restore));
    UI.toast(r && r.error ? r.error : '已恢复');
  });
  box.querySelectorAll('[data-purge]').forEach(b => b.onclick = async () => {
    if (await UI.confirmBox('彻底删除这条内容？附件文件将一并删除，不可恢复。')) {
      const r = await api.trashPurge(Number(b.dataset.purge));
      UI.toast(r && r.error ? r.error : '已彻底删除');
    }
  });
}
function bindSettingsView() {
  $('setNick').onchange = async () => {
    const v = $('setNick').value.trim() || '追梦人';
    await api.setSettings({ nickname: v });
    fillSettings();
  };
  $('swTips').onclick = async e => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); await api.setSettings({ tips: on }); };
  $('swConfirm').onclick = async e => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); await api.setSettings({ confirmDelete: on }); };
  $('swAuto').onclick = async e => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); await api.setSettings({ autostart: on }); UI.toast(on ? '已开启随软件启动' : '已关闭随软件启动'); };
  $('opRange').oninput = async e => {
    const v = +e.target.value;
    api.setOpacity(v);
    await api.setSettings({ transparency: v });
  };
  $('btnSyncNow').onclick = () => UI.toast('已同步！（本地模式）');
  const tc = $('btnTrashClear');
  if (tc) tc.onclick = async () => {
    if (!state.trash.length) { UI.toast('回收站是空的'); return; }
    if (await UI.confirmBox('清空回收站？其中附件文件将一并删除。')) { await api.trashClear(); UI.toast('已清空'); }
  };
}

/* ---------- 头部/底部 ---------- */
function renderChrome() {
  const due = dueCount();
  $('headBadge').textContent = due;
  $('headBadge').style.display = due ? 'inline-block' : 'none';
}
function injectHeaderIcons() {
  $('btnCal').innerHTML = UI.ICONS.calendar;
  $('btnSync').innerHTML = UI.ICONS.cloud;
  $('btnMenu').innerHTML = UI.ICONS.menu;
  const tl = $('btnTimeline'); tl.innerHTML = UI.ICONS.clock + '<span>时间轴</span>';
  const se = $('btnSearch'); se.innerHTML = UI.ICONS.search + '<span>搜索</span>';
  const st = $('btnSettings'); st.innerHTML = UI.ICONS.gear + '<span>设置</span>';
}

function bindChrome() {
  injectHeaderIcons();
  $('btnCal').onclick = () => switchView('calendar');
  $('calBack').onclick = () => switchView('list');
  $('setBack').onclick = () => switchView('list');
  $('calPrev').onclick = () => shiftCal(-1);
  $('calNext').onclick = () => shiftCal(1);
  $('calMore').onclick = e => {
    const r = e.target.getBoundingClientRect();
    const s = state.settings;
    UI.showMenu([
      { label: '刷新', icon: '⟳', action: renderCalView },
      { label: '透明度', icon: '◐', action: () => showOpacityPop(r.left - 60, r.bottom + 6) },
      { label: '一周开始于', icon: '⇆', sub: [
        { label: '周一', checked: s.weekStart === 1, action: () => { api.setSettings({ weekStart: 1 }); renderCalView(); } },
        { label: '周日', checked: s.weekStart === 0, action: () => { api.setSettings({ weekStart: 0 }); renderCalView(); } },
      ] },
      { label: '显示农历', icon: '历', checked: s.showLunar, action: () => { api.setSettings({ showLunar: !s.showLunar }); renderCalView(); } },
      'sep',
      { label: calMode === 'month' ? '周视图' : '月视图', icon: '▦', action: () => { calMode = calMode === 'month' ? 'week' : 'month'; renderCalView(); } },
    ], r.left - 130, r.bottom + 6);
  };
  $('btnCollapse').onclick = toggleCollapse;
  $('btnHide').onclick = () => api.closeWin();
  $('btnQuit').onclick = async () => {
    if (await UI.confirmBox('退出 C便签？数据已实时保存在本机。')) api.quitApp();
  };
  $('btnMenu').onclick = e => {
    const r = e.target.getBoundingClientRect();
    UI.showMenu([
      { label: '日历月视图', icon: '📅', action: () => switchView('calendar') },
      { label: '设置', icon: '⚙', action: () => switchView('settings') },
      'sep',
      { label: '窗口置顶', checked: !!state.settings.alwaysOnTop, action: () => {
        const v = !state.settings.alwaysOnTop;
        api.setSettings({ alwaysOnTop: v });
        api.setAlwaysOnTop(v);
      } },
    ], r.left - 140, r.bottom + 4);
  };
  $('btnSync').onclick = () => UI.toast('本地模式：数据保存在本机，无需联网');
  $('btnFilter').onclick = e => {
    const r = e.target.getBoundingClientRect();
    UI.showMenu([
      { label: '全部', checked: filterMode === 'all', action: () => { filterMode = 'all'; render(); } },
      { label: '未完成', checked: filterMode === 'undone', action: () => { filterMode = 'undone'; render(); } },
      { label: '已完成', checked: filterMode === 'done', action: () => { filterMode = 'done'; render(); } },
    ], r.left, r.bottom + 4);
  };
  $('btnSearch').onclick = () => {
    const foot = document.querySelector('.p-foot');
    if (foot.querySelector('.search-box')) { foot.querySelector('.search-box').remove(); searchKey = ''; render(); return; }
    const box = document.createElement('div'); box.className = 'search-box';
    box.innerHTML = '<input placeholder="搜索便签、待办...">';
    foot.insertBefore(box, foot.firstChild);
    const inp = box.querySelector('input'); inp.focus();
    inp.oninput = () => { searchKey = inp.value; render(); };
    inp.onkeydown = e => { if (e.key === 'Escape') { box.remove(); searchKey = ''; render(); } };
  };
  $('btnTimeline').onclick = () => { timelineMode = !timelineMode; render(); UI.toast(timelineMode ? '时间轴视图' : '列表视图'); };
  $('btnClearDone').onclick = async () => {
    if (curCatId.startsWith('#')) return;
    if (await UI.confirmBox('清除该分类下所有已完成的待办？')) await api.clearDone(curCatId);
  };
  $('btnSettings').onclick = () => switchView('settings');
  $('quickAdd').onclick = openQuickAdd;
  $('qaCancel').onclick = closeQuickAdd;
  $('qaSave').onclick = saveQuickAdd;
  $('qaRemind').onclick = async e => {
    const r = e.target.getBoundingClientRect();
    openReminderPicker(v => { qaReminder = v; renderQaChips(); }, r.left, r.bottom + 4);
  };
  $('qaText').onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveQuickAdd(); }
    if (e.key === 'Escape') closeQuickAdd();
  };
  $('qaText').oninput = e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; };
}
function openReminderPicker(cb, x, y) {
  const pop = document.createElement('div');
  pop.className = 'ctx-menu';
  pop.style.minWidth = '230px';
  const now = new Date();
  pop.innerHTML = `
    <div style="padding:4px 10px 8px"><input type="date" id="rpDate" value="${UI.ymd(now)}" style="width:100%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#e8eef5;border-radius:7px;padding:6px;outline:none;color-scheme:dark"></div>
    <div class="ctx-item" data-t="08:00">⏰ 早上 08:00</div>
    <div class="ctx-item" data-t="12:00">🌞 中午 12:00</div>
    <div class="ctx-item" data-t="18:00">🌆 傍晚 18:00</div>
    <div class="ctx-item" data-t="21:00">🌙 晚上 21:00</div>`;
  document.body.appendChild(pop);
  pop.style.left = Math.min(x, innerWidth - 240) + 'px';
  pop.style.top = Math.min(y, innerHeight - 200) + 'px';
  pop.querySelectorAll('[data-t]').forEach(el => el.onclick = () => {
    cb({ date: pop.querySelector('#rpDate').value, time: el.dataset.t, repeat: 'none', important: false });
    pop.remove();
  });
  const closer = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', closer, true); } };
  setTimeout(() => document.addEventListener('mousedown', closer, true), 0);
}

bindChrome();
bindSettingsView();
init();

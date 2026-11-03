/* ================= 便签小窗（深色玻璃 + 色条） ================= */
let item = null;
let saveTimer = null;
let topFlag = false;
const $ = id => document.getElementById(id);
const body = $('body');
const COLORS = [
  { key: 'yellow', name: '黄色', css: '#f5c451' }, { key: 'green', name: '绿色', css: '#86e3b4' },
  { key: 'pink', name: '粉色', css: '#ff9fce' }, { key: 'purple', name: '紫色', css: '#c7a7ff' },
  { key: 'blue', name: '蓝色', css: '#8fc7ff' }, { key: 'gray', name: '灰色', css: '#aab4be' },
  { key: 'dark', name: '深色', css: '#5a6b7e' }
];

async function init() {
  const state = await api.load();
  const id = api.query.id;
  item = state.items.find(x => x.id === id);
  if (!item) {
    item = { id: UI.uid(), type: 'note', categoryId: 'c_note', color: 'yellow', html: '', reminder: null, done: false, attachments: [] };
    await api.upsertItem(item);
  }
  injectIcons();
  applyColor(item.color || 'yellow');
  body.innerHTML = UI.fixAttach(item.html || '');
  UI.checklist.normalize(body);
  applyDone();
  api.onState(s => {
    const fresh = s.items.find(x => x.id === item.id);
    if (fresh && fresh.html !== body.innerHTML && document.activeElement !== body) body.innerHTML = UI.fixAttach(fresh.html || '');
    if (fresh && fresh.done !== item.done) { item.done = fresh.done; applyDone(); }
    if (!fresh) window.close();
  });
  bind();
}

function injectIcons() {
  document.querySelector('[data-cmd="insertUnorderedList"]').innerHTML = UI.ICONS.list;
  $('btnImg').innerHTML = UI.ICONS.image;
  $('btnChecklist').innerHTML = UI.ICONS.checklist;
}

function applyDone() {
  // 整条完成状态由主列表同步（右键完成）：卡片淡出 + 标题栏徽章，不划线
  body.classList.toggle('done', !!item.done);
  const tag = $('stkDoneTag');
  if (tag) tag.style.display = item.done ? 'inline-block' : 'none';
}

function applyColor(c) {
  const o = COLORS.find(x => x.key === c) || COLORS[0];
  $('strip').style.background = o.css;
  $('root').style.borderColor = o.css + '55';
  renderColors(o.key);
}
function renderColors(cur) {
  const row = $('colorRow');
  row.innerHTML = COLORS.map(c => `<div class="c ${c.key === cur ? 'on' : ''}" data-c="${c.key}" title="${c.name}" style="background:${c.css}"></div>`).join('');
  row.querySelectorAll('.c').forEach(el => el.onclick = () => { applyColor(el.dataset.c); save(); });
}

function save() {
  if (!item) return;
  UI.checklist.normalize(body);
  item.html = body.innerHTML;
  clearTimeout(saveTimer);
  $('btnSaved').textContent = '···';
  saveTimer = setTimeout(async () => {
    // 只提交本窗口负责的字段，避免覆盖主面板对分类/提醒等字段的修改
    await api.patchItem(item.id, { html: body.innerHTML, color: item.color || 'yellow' });
    $('btnSaved').textContent = '✔';
  }, 500);
}

function bind() {
  body.addEventListener('input', save);
  // 清单模式：逐行勾选框（勾选 → 橙色✓ + 该行文字变灰划线）
  UI.checklist.bind(body, () => save());
  UI.bindSanitizedPaste(body, () => save());
  $('btnChecklist').onclick = () => {
    UI.checklist.toggle(body);
    $('btnChecklist').classList.toggle('act', UI.checklist.inside(body));
    save();
  };
  document.querySelectorAll('.stk-tools .tb[data-cmd]').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      document.execCommand(b.dataset.cmd, false, null);
      document.querySelectorAll('.stk-tools .tb[data-cmd]').forEach(x => {
        try { x.classList.toggle('act', document.queryCommandState(x.dataset.cmd)); } catch (e) {}
      });
      body.focus(); save();
    });
  });
  $('btnImg').addEventListener('mousedown', e => e.preventDefault());
  $('btnImg').onclick = () => $('fileInput').click();
  $('fileInput').onchange = async () => {
    const f = $('fileInput').files[0]; if (!f) return;
    const p = api.filePath(f);
    const saved = await api.addAttachment(p);
    if (saved && saved.path) {
      body.focus();
      document.execCommand('insertHTML', false, `<img src="attach://${encodeURIComponent(saved.name)}">`);
      save();
    }
    $('fileInput').value = '';
  };
  // 拖拽图片进便签
  body.addEventListener('dragover', e => e.preventDefault());
  body.addEventListener('drop', async e => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      const p = api.filePath(f);
      if (!p) continue;
      const saved = await api.addAttachment(p);
      if (saved && saved.path) {
        if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(saved.name)) {
          document.execCommand('insertHTML', false, `<img src="attach://${encodeURIComponent(saved.name)}">`);
        } else {
          document.execCommand('insertHTML', false, `<div>📎 ${saved.name}</div>`);
        }
      }
    }
    save();
  });

  $('btnClose').onclick = () => api.closeWin();
  // 新建：先落库拿到唯一 id，再按 id 开独立窗口（点几次新建几个）
  $('btnNew').onclick = async () => {
    const x = 120 + Math.round(Math.random() * 320), y = 110 + Math.round(Math.random() * 170);
    const id = UI.uid();
    await api.upsertItem({ id, type: 'note', categoryId: item.categoryId || 'c_note', color: item.color || 'yellow', html: '', reminder: null, done: false, attachments: [] });
    await api.openWindow({ type: 'sticky', id, x, y, ontop: false });
  };
  $('btnMore').onclick = e => {
    const r = e.target.getBoundingClientRect();
    const cur = item.color || 'yellow';
    UI.showMenu([
      { label: '便签颜色', icon: '🎨', sub: COLORS.map(c => ({ label: c.name, checked: cur === c.key, action: () => { item.color = c.key; applyColor(c.key); save(); } })) },
      { label: '便签列表', icon: '☰', action: () => api.openWindow({ type: 'main' }) },
      { label: '窗口置顶', icon: '📌', checked: !!topFlag, action: () => { topFlag = !topFlag; api.setAlwaysOnTop(topFlag); } },
      'sep',
      { label: '删除笔记', icon: '🗑', danger: true, action: async () => { await api.deleteItem(item.id); UI.toast('已删除'); api.reallyCloseWin(); } },
    ], r.left - 130, r.bottom + 6);
  };
}

init();

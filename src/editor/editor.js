/* ================= 编辑器窗口 ================= */
let state = null;
let editing = null;      // 已有便签/待办
let reminder = null;
let attachments = [];
let color = 'default';
let done = false;
let draftType = 'note';
let edCatId = '';
let pendingDel = []; // 待删除的附件名，保存成功后统一落盘删除
const $ = id => document.getElementById(id);
const body = $('body');
const COLORS = [
  { key: 'default', name: '默认', css: '#5a6b7e' }, { key: 'yellow', name: '黄色', css: '#f5c451' },
  { key: 'green', name: '绿色', css: '#86e3b4' }, { key: 'pink', name: '粉色', css: '#ff9fce' },
  { key: 'purple', name: '紫色', css: '#c7a7ff' }, { key: 'blue', name: '蓝色', css: '#8fc7ff' },
  { key: 'teal', name: '青色', css: '#7fd8e8' }
];

async function init() {
  state = await api.load();
  injectToolbarIcons();
  const q = api.query;
  const noteCat = state.categories.find(c => c.kind === 'note');

  if (q.id) {
    editing = state.items.find(x => x.id === q.id);
    if (editing) {
      $('edTitle').textContent = editing.type === 'todo' ? '编辑待办' : '编辑便签';
      draftType = editing.type;
      if (draftType === 'todo') { body.contentEditable = 'plaintext-only'; body.innerText = editing.text; }
      else body.innerHTML = UI.fixAttach(editing.html || '');
      UI.checklist.normalize(body);
      reminder = editing.reminder ? JSON.parse(JSON.stringify(editing.reminder)) : null;
      attachments = (editing.attachments || []).slice();
      color = editing.color || 'default';
      done = !!editing.done;
      edCatId = editing.categoryId;
    }
  } else {
    draftType = (state.categories.find(c => c.id === (q.categoryId || '')) || {}).kind === 'todo' ? 'todo' : 'note';
    if (draftType === 'todo') { body.contentEditable = 'plaintext-only'; }
    $('edTitle').textContent = draftType === 'todo' ? '新增待办' : '新增便签';
    edCatId = q.categoryId || (noteCat ? noteCat.id : '');
    reminder = q.date ? { date: q.date, time: q.time || '08:00', repeat: 'none', important: false } : null;
  }
  if (!edCatId) edCatId = state.categories[0] ? state.categories[0].id : '';
  renderChips(); renderAtt(); count(); renderCatSel();
  api.onState(s => { state = s; renderCatSel(); });
  bind();
  bindChecklist();
  if (api.query.autoprem === '1') setTimeout(openRemPanel, 700);
  if (api.query.autock === '1') setTimeout(() => $('btnChecklist').click(), 800);
}

function renderChips() {
  const box = $('chips');
  let html = '';
  if (reminder && reminder.date) {
    const rep = UI.repeatText(reminder);
    html += `<span class="chip remind" id="chipRemind">⏰ ${reminder.date} ${UI.weekdayCN(reminder.date)} ${(reminder.time || '09:00').slice(0, 5)} 提醒 <span class="x" data-x="remind">✕</span></span>`;
    if (rep) html += `<span class="chip repeat" id="chipRep">🔁 ${rep} <span class="x" data-x="rep">✕</span></span>`;
    if (reminder.important) html += `<span class="chip imp" id="chipImp">⭐ 重要事项 <span class="x" data-x="imp">✕</span></span>`;
  } else {
    html += `<span class="chip" id="chipAddRemind" style="border:1px dashed rgba(255,255,255,.35);background:transparent;color:#9fb1c3">＋ 添加提醒</span>`;
  }
  box.innerHTML = html;
  $('btnRepeat').classList.toggle('act', !!(reminder && reminder.repeat && reminder.repeat !== 'none'));
  box.querySelectorAll('.x').forEach(x => x.onclick = e => {
    e.stopPropagation();
    const t = x.dataset.x;
    if (t === 'remind' || t === 'rep') { if (reminder) { reminder.repeat = 'none'; reminder.repeatDays = undefined; } }
    if (t === 'imp' && reminder) reminder.important = false;
    renderChips();
  });
  const cr = $('chipRemind'); if (cr) cr.onclick = () => openRemPanel();
  const cp = $('chipRep'); if (cp) cp.onclick = () => openRemPanel();
  const ca = $('chipAddRemind'); if (ca) ca.onclick = () => openRemPanel();
}

/* ---------- 提醒设置面板 ---------- */
function openRemPanel() {
  if (!reminder) reminder = { date: UI.ymd(new Date()), time: '08:00', repeat: 'none', important: false };
  const r = reminder;
  let h = (r.time || '08:00').split(':')[0];
  let m = (r.time || '08:00').split(':')[1] || '00';
  let rep = r.repeat || 'none';
  let imp = r.important ? '1' : '0';
  const mask = document.createElement('div');
  mask.className = 'rem-panel';
  mask.innerHTML = `
  <div class="rem-box">
    <h4>设置提醒</h4>
    <div class="frow"><label>提醒日期</label><input type="date" id="rpDate" value="${r.date || UI.ymd(new Date())}"></div>
    <div class="frow"><label>提醒时间</label><span id="rpHBox"></span><span id="rpMBox"></span></div>
    <div class="quick" id="rpQuick">
      <span data-t="08:00">08:00</span><span data-t="12:00">12:00</span><span data-t="18:00">18:00</span><span data-t="21:00">21:00</span>
    </div>
    <div class="frow"><label>是否重复</label><span id="rpRepBox"></span></div>
    <div id="rpWeekBox" style="display:none">
      <div class="frow"><label>重复于</label><div class="quick" id="rpWeek" style="flex:1;margin:0">
        ${['日', '一', '二', '三', '四', '五', '六'].map((w, i) => `<span data-w="${i}" ${((r.repeatWeekdays || []).includes(i)) ? 'class="on"' : ''}>周${w}</span>`).join('')}
      </div></div>
    </div>
    <div id="rpMonthBox" style="display:none">
      <div class="frow"><label>每</label><input type="text" id="rpEvery" value="${r.repeatEvery || 1}" style="width:44px;text-align:center"><span>月</span></div>
      <div class="mini-cal" id="rpDays">
        ${[...Array(31).keys()].map(i => `<div data-d="${i + 1}" ${((r.repeatDays || []).includes(i + 1)) ? 'class="sel"' : ''}>${i + 1}</div>`).join('')}
      </div>
    </div>
    <div class="frow"><label>重复截止</label><input type="date" id="rpEnd" value="${r.endDate || '2099-12-31'}"></div>
    <div class="frow"><label>重要事项</label><span id="rpImpBox"></span></div>
    <div class="frow"><label>背景颜色</label><div class="swatches" id="rpSw"></div></div>
    <div class="btns">
      <button class="btn ghost" id="rpClear">清除</button>
      <button class="btn ghost" id="rpCancel">取消</button>
      <button class="btn primary" id="rpOk">确定</button>
    </div>
  </div>`;
  document.body.appendChild(mask);

  // 深色自定义下拉
  const hours = [...Array(24).keys()].map(i => ({ v: String(i).padStart(2, '0'), l: String(i).padStart(2, '0') + ' 时' }));
  const mins = ['00', '15', '30', '45'].map(v => ({ v, l: v + ' 分' }));
  const renderTime = () => {
    const hb = mask.querySelector('#rpHBox'), mb = mask.querySelector('#rpMBox');
    hb.innerHTML = ''; mb.innerHTML = '';
    hb.appendChild(UI.dropdown(h, hours, v => { h = v; }));
    mb.appendChild(UI.dropdown(m, mins, v => { m = v; }));
  };
  renderTime();
  const reps = [
    { v: 'none', l: '不重复' }, { v: 'day', l: '按天' }, { v: 'week', l: '按周' },
    { v: 'month', l: '按月' }, { v: 'year', l: '按年' }
  ];
  const syncBoxes = () => {
    mask.querySelector('#rpWeekBox').style.display = rep === 'week' ? 'block' : 'none';
    mask.querySelector('#rpMonthBox').style.display = rep === 'month' ? 'block' : 'none';
    $('btnRepeat').classList.toggle('act', rep !== 'none');
  };
  mask.querySelector('#rpRepBox').appendChild(UI.dropdown(rep, reps, v => { rep = v; syncBoxes(); }));
  mask.querySelector('#rpImpBox').appendChild(UI.dropdown(imp, [
    { v: '0', l: '不重要' }, { v: '1', l: '⭐ 重要（间隔提醒）' }
  ], v => { imp = v; }));

  // 颜色
  const sw = mask.querySelector('#rpSw');
  sw.innerHTML = COLORS.map(c => `<div class="c ${color === c.key ? 'on' : ''}" data-c="${c.key}" title="${c.name}" style="background:${c.css}"></div>`).join('');
  sw.querySelectorAll('.c').forEach(el => el.onclick = () => {
    color = el.dataset.c;
    sw.querySelectorAll('.c').forEach(x => x.classList.toggle('on', x === el));
  });

  syncBoxes();
  mask.querySelectorAll('#rpQuick span').forEach(el => el.onclick = () => {
    h = el.dataset.t.split(':')[0]; m = el.dataset.t.split(':')[1];
    renderTime();
  });
  mask.querySelectorAll('#rpWeek span').forEach(el => el.onclick = () => el.classList.toggle('on'));
  mask.querySelectorAll('#rpDays div').forEach(el => el.onclick = () => el.classList.toggle('sel'));

  mask.querySelector('#rpClear').onclick = () => { reminder = null; renderChips(); mask.remove(); };
  mask.querySelector('#rpCancel').onclick = () => mask.remove();
  mask.querySelector('#rpOk').onclick = () => {
    const date = mask.querySelector('#rpDate').value;
    if (!date) { mask.remove(); return; }
    const upd = { date, time: h + ':' + m, repeat: rep, important: imp === '1', endDate: mask.querySelector('#rpEnd').value };
    if (rep === 'week') upd.repeatWeekdays = [...mask.querySelectorAll('#rpWeek span.on')].map(x => +x.dataset.w);
    if (rep === 'month') {
      upd.repeatDays = [...mask.querySelectorAll('#rpDays div.sel')].map(x => +x.dataset.d);
      upd.repeatEvery = Math.max(1, +mask.querySelector('#rpEvery').value || 1);
    }
    reminder = upd;
    renderChips(); mask.remove();
  };
}

/* ---------- 附件与插图 ---------- */
// 图片 → 嵌入正文；其他文件 → 附件区
async function handleFiles(files) {
  for (const f of files) {
    const p = api.filePath(f); if (!p) continue;
    const saved = await api.addAttachment(p);
    if (!saved || !saved.path) continue;
    if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(saved.name)) {
      body.focus();
      document.execCommand('insertHTML', false, `<img src="attach://${encodeURIComponent(saved.name)}">`);
    } else {
      attachments.push({ name: saved.name, path: saved.path });
    }
  }
  renderAtt(); count();
}
function renderAtt() {
  $('attList').innerHTML = attachments.map((a, i) =>
    `<span class="chip remind" style="background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.15);color:#9fb1c3">📎 ${esc(a.name)} <span class="x" data-i="${i}">✕</span></span>`).join('');
  $('attList').querySelectorAll('.x').forEach(x => x.onclick = () => {
    const i = +x.dataset.i;
    const att = attachments[i];
    if (att && att.name) pendingDel.push(att.name); // 延迟删盘：保存成功后才删，取消编辑不丢文件
    attachments.splice(i, 1);
    renderAtt();
  });
}
function esc(s) { return (s || '').replace(/</g, '&lt;'); }
function dropText() { return attachments.length ? '继续拖拽或点击添加文件' : '拖拽或添加文件'; }

function renderCatSel() {
  const box = $('catSelBox');
  if (!box) return;
  const cur = state.categories.some(c => c.id === edCatId) ? edCatId : (state.categories[0] || {}).id;
  if (cur !== edCatId) edCatId = cur;
  box.innerHTML = '';
  box.appendChild(UI.dropdown(edCatId, state.categories.map(c => ({ v: c.id, l: c.name })), v => { edCatId = v; }));
}

/* ---------- 保存 ---------- */
function collect() {
  UI.checklist.normalize(body);
  const catId = edCatId;
  const cat = state.categories.find(c => c.id === catId);
  const isTodo = cat && cat.kind === 'todo';
  if (isTodo) {
    const text = body.innerText.trim();
    if (!text) return null;
    return { id: editing ? editing.id : UI.uid(), type: 'todo', categoryId: catId, text, reminder, done, order: editing ? editing.order : 9999 };
  }
  const html = body.innerHTML.trim();
  if (!html || html === '<br>') return null;
  return { id: editing ? editing.id : UI.uid(), type: 'note', categoryId: catId, html, reminder, done, color, attachments };
}
async function saveOne(keepOpen) {
  const item = collect();
  if (!item) { UI.toast('请输入内容'); return; }
  await api.upsertItem(JSON.parse(JSON.stringify(item)));
  for (const name of pendingDel) api.deleteAttachment(name, item.id);
  pendingDel = [];
  UI.toast('保存成功');
  if (keepOpen) {
    editing = null;
    body.innerHTML = ''; attachments = []; pendingDel = []; reminder = null; renderChips(); renderAtt(); count();
  } else {
    api.reallyCloseWin();
  }
}

function count() {
  const n = (draftType === 'todo' ? body.innerText : body.textContent || '').replace(/\s/g, '').length;
  $('cnt').textContent = n;
}

/* ---------- 工具栏图标 ---------- */
function injectToolbarIcons() {
  document.querySelector('[data-cmd="insertUnorderedList"]').innerHTML = UI.ICONS.list;
  $('btnImg').innerHTML = UI.ICONS.image;
  $('btnChecklist').innerHTML = UI.ICONS.checklist;
  $('btnRepeat').innerHTML = UI.ICONS.clock;
  $('btnDone').innerHTML = UI.ICONS.check;
}

/* ---------- 清单模式（共用逻辑在 UI.checklist） ---------- */
function bindChecklist() {
  $('btnChecklist').onclick = () => {
    UI.checklist.toggle(body);
    $('btnChecklist').classList.toggle('act', UI.checklist.inside(body));
    count();
  };
  UI.checklist.bind(body, () => count());
}

function bind() {
  $('btnMin').onclick = () => api.minWin();
  $('btnClose').onclick = () => api.reallyCloseWin();
  $('btnSave').onclick = () => saveOne(false);
  $('btnSaveMore').onclick = () => saveOne(true);
  body.addEventListener('input', count);
  UI.bindSanitizedPaste(body, () => count());
  document.querySelectorAll('.ed-toolbar .tb[data-cmd]').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => { document.execCommand(b.dataset.cmd, false, null); body.focus(); });
  });
  $('btnRepeat').onclick = () => openRemPanel();
  $('btnDone').onclick = () => { done = !done; $('btnDone').classList.toggle('act', done); UI.toast(done ? '已标记完成' : '已取消完成'); };
  $('btnImg').onclick = () => $('fileInput').click();
  $('fileInput').onchange = () => { handleFiles([...$('fileInput').files]); $('fileInput').value = ''; };
  const drop = $('drop');
  drop.onclick = () => $('fileInput').click();
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); drop.textContent = '松开以添加'; });
  drop.addEventListener('dragleave', () => { drop.classList.remove('over'); drop.textContent = dropText(); });
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
  // 整窗拖拽内容
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') api.reallyCloseWin();
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveOne(false); }
  });
}

init();

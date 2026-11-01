/* ===== 公共组件：下钻式菜单 / Toast / 确认框 / 输入框 / 工具函数 ===== */
(function () {
  let menuEl = null;

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('mousedown', onDocDown, true); document.removeEventListener('keydown', onEsc, true); }
  }
  function onDocDown(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function onEsc(e) { if (e.key === 'Escape') closeMenu(); }

  // items: [{label, icon?, danger?, checked?, sub?:[...], action:fn} | 'sep']
  // 窄窗口友好：带 sub 的项点击后进入下一层面板（‹ 返回），随根菜单一起销毁
  function showMenu(items, x, y) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'ctx-menu';
    const stack = [items];
    function pane() {
      const cur = stack[stack.length - 1];
      menuEl.innerHTML = '';
      if (stack.length > 1) {
        const back = document.createElement('div');
        back.className = 'ctx-item';
        back.innerHTML = '<span class="ck">‹</span><span class="lb">返回</span>';
        back.onclick = () => { stack.pop(); pane(); };
        menuEl.appendChild(back);
        const s = document.createElement('div'); s.className = 'ctx-sep'; menuEl.appendChild(s);
      }
      for (const it of cur) {
        if (it === 'sep') { const s = document.createElement('div'); s.className = 'ctx-sep'; menuEl.appendChild(s); continue; }
        const row = document.createElement('div');
        row.className = 'ctx-item' + (it.danger ? ' danger' : '');
        row.innerHTML = (it.checked ? '<span class="ck">✓</span>' : '<span class="ck"></span>') +
          '<span class="ic">' + (it.icon || '') + '</span><span class="lb">' + it.label + '</span>' +
          (it.sub ? '<span class="arrow">›</span>' : '');
        if (it.sub) row.onclick = () => { stack.push(it.sub); pane(); };
        else row.onclick = () => { closeMenu(); it.action && it.action(); };
        menuEl.appendChild(row);
      }
    }
    pane();
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onEsc, true);
  }

  let toastEl = null;
  function toast(msg, ms = 1800) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('on'), ms);
  }

  function confirmBox(msg) {
    return new Promise(res => {
      const mask = document.createElement('div');
      mask.className = 'confirm-mask';
      mask.innerHTML = '<div class="confirm-box"><div class="msg">' + msg + '</div>' +
        '<div class="btns"><button class="c">取消</button><button class="o">确定</button></div></div>';
      document.body.appendChild(mask);
      mask.querySelector('.c').onclick = () => { mask.remove(); res(false); };
      mask.querySelector('.o').onclick = () => { mask.remove(); res(true); };
    });
  }

  function promptBox(title, placeholder, def) {
    return new Promise(res => {
      const mask = document.createElement('div');
      mask.className = 'confirm-mask';
      mask.innerHTML = '<div class="confirm-box"><div class="msg">' + title + '</div>' +
        '<input class="pin" placeholder="' + (placeholder || '') + '" value="' + (def || '') + '">' +
        '<div class="btns"><button class="c">取消</button><button class="o">确定</button></div></div>';
      document.body.appendChild(mask);
      const inp = mask.querySelector('.pin');
      inp.focus(); inp.select();
      const ok = () => { const v = inp.value.trim(); mask.remove(); res(v || null); };
      const no = () => { mask.remove(); res(null); };
      mask.querySelector('.c').onclick = no;
      mask.querySelector('.o').onclick = ok;
      inp.onkeydown = e => {
        if (e.key === 'Enter') ok();
        if (e.key === 'Escape') no();
      };
    });
  }

  /* 提醒展开：统一委托 src/common/recur.js（区间签名），页面需先加载 recur.js */
  const R = window.Recur;
  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const fixAttach = html => String(html || '').replace(/(src=")file:\/\/\/[^"]*?\/attachments\//g, '$1attach://');
  function weekdayCN(dateStr) { return '周' + WEEK[new Date(dateStr + 'T00:00:00').getDay()]; }
  function repeatText(r) {
    if (!r || !r.repeat || r.repeat === 'none') return '';
    if (r.repeat === 'day') return '每天';
    if (r.repeat === 'week') return '每周' + ((r.repeatWeekdays || []).map(d => WEEK[d]).join('、') || '');
    if (r.repeat === 'month') return (r.repeatDays && r.repeatDays.length ? '每月' + r.repeatDays.join('号,') + '号' : '每月');
    if (r.repeat === 'year') return '每年';
    return '';
  }
  function fmtTime(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = ymd(d) === ymd(now);
    const sameYear = d.getFullYear() === now.getFullYear();
    return (sameYear ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate() +
      (sameDay ? ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '');
  }
  function plainText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').trim();
  }
  const uid = () => 'i' + Math.random().toString(36).slice(2, 10);

  /* 自定义下拉：options=[{v,l}]，onPick(v) */
  function dropdown(current, options, onPick, cls) {
    const el = document.createElement('span');
    el.className = 'dd' + (cls ? ' ' + cls : '');
    const label = () => { const o = options.find(x => x.v === current); el.setAttribute('data-v', current); el.firstChild && el.removeChild(el.firstChild); el.insertBefore(document.createTextNode(o ? o.l : current), el.lastChild); };
    const txt = document.createTextNode('');
    el.appendChild(txt);
    const arrow = document.createElement('span'); arrow.textContent = ''; el.appendChild(arrow);
    label();
    el.onclick = e => {
      e.stopPropagation();
      const old = document.querySelector('.dd-pop'); if (old) { old.remove(); document.removeEventListener('mousedown', closer, true); }
      const pop = document.createElement('div');
      pop.className = 'dd-pop';
      for (const o of options) {
        const r = document.createElement('div');
        r.className = 'dd-item' + (o.v === current ? ' on' : '');
        r.textContent = o.l;
        r.onclick = () => { pop.remove(); document.removeEventListener('mousedown', closer, true); current = o.v; label(); onPick(o.v); };
        pop.appendChild(r);
      }
      document.body.appendChild(pop);
      const rr = el.getBoundingClientRect();
      pop.style.left = Math.min(rr.left, innerWidth - pop.offsetWidth - 8) + 'px';
      if (rr.bottom + pop.offsetHeight > innerHeight - 6) pop.style.top = Math.max(4, rr.top - pop.offsetHeight - 4) + 'px';
      else pop.style.top = rr.bottom + 4 + 'px';
      const closer = ev => { if (!pop.contains(ev.target) && !el.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', closer, true); } };
      setTimeout(() => document.addEventListener('mousedown', closer, true), 0);
    };
    return el;
  }

  /* 线性 SVG 图标（编辑器/便签小窗共用） */
  function svg(s) { return '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + s + '</svg>'; }
  const ICONS = {
    list: svg('<circle cx="2.6" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2.6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2.6" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M5.5 4H14M5.5 8H14M5.5 12H14"/>'),
    image: svg('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.5"/><circle cx="5.6" cy="6.2" r="1.1" fill="currentColor" stroke="none"/><path d="M2.5 11.5l3.5-3.5 2.8 2.8 2.2-2.2 2.8 2.8"/>'),
    clock: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.7"/>'),
    check: svg('<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3"/><path d="M5.4 8.4l2 2 3.6-4"/>'),
    checklist: svg('<path d="M3 3.5l1.2 1.2L6.4 2.5"/><path d="M8.5 4H14M3 8.2l1.2 1.2 2.2-2.2"/><path d="M8.5 8.7H14M3 12.9l1.2 1.2 2.2-2.2"/><path d="M8.5 13.4H14"/>'),
    calendar: svg('<rect x="2" y="3.4" width="12" height="10.6" rx="1.8"/><path d="M2 6.6h12M5.2 1.8v2.8M10.8 1.8v2.8"/>'),
    cloud: svg('<path d="M5 12.6a3.4 3.4 0 1 1 .6-6.8 4.1 4.1 0 0 1 8 .9 2.9 2.9 0 0 1-.5 5.9H5z"/>'),
    menu: svg('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>'),
    search: svg('<circle cx="7" cy="7" r="4.6"/><path d="M10.6 10.6L14 14"/>'),
    gear: svg('<circle cx="8" cy="8" r="2.3"/><path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5l1.6 1.6M10.9 10.9l1.6 1.6M12.5 3.5L10.9 5.1M5.1 10.9l-1.6 1.6"/>')
  };

  /* 清单模式（编辑器/便签小窗共用）：转换、回车续行、勾选 */
  const checklist = {
    inside: bodyEl => !!bodyEl.querySelector('.ck-item'),
    // 结构归一化：把散落在 .ck-text 外面的 img/文本收回 ck-text，防止 flex 溢出
    normalize: bodyEl => {
      bodyEl.querySelectorAll('.ck-item').forEach(item => {
        const box = item.querySelector('.ck-box');
        const text = item.querySelector('.ck-text');
        if (!box || !text) return;
        [...item.childNodes].forEach(n => {
          if (n === box || n === text) return;
          if (n.nodeType === 1 && n.classList && (n.classList.contains('ck-box') || n.classList.contains('ck-text'))) return;
          text.appendChild(n);
        });
      });
    },
    toggle: bodyEl => {
      if (checklist.inside(bodyEl)) {
        const items = [...bodyEl.querySelectorAll('.ck-item')];
        const frag = document.createDocumentFragment();
        items.forEach(it => {
          const div = document.createElement('div');
          div.innerHTML = (it.querySelector('.ck-text') || {}).innerHTML || '<br>';
          frag.appendChild(div);
        });
        bodyEl.innerHTML = '';
        bodyEl.appendChild(frag);
        return;
      }
      const tmp = document.createElement('div');
      tmp.innerHTML = bodyEl.innerHTML;
      let lines = [];
      const blocks = [...tmp.children];
      if (!blocks.length) {
        lines = tmp.innerHTML.split(/<br\s*\/?>/i).map(s => s.replace(/^&nbsp;$/, ''));
        if (!tmp.innerHTML.trim()) lines = [''];
      } else {
        for (const b of blocks) {
          if (b.tagName === 'UL' || b.tagName === 'OL') [...b.children].forEach(li => lines.push(li.innerHTML));
          else if (b.classList && b.classList.contains('ck-item')) lines.push({ done: b.classList.contains('done'), html: (b.querySelector('.ck-text') || {}).innerHTML || '' });
          else lines.push(b.innerHTML);
        }
      }
      bodyEl.innerHTML = lines.map(l => typeof l === 'object'
        ? '<div class="ck-item' + (l.done ? ' done' : '') + '"><span class="ck-box" contenteditable="false"></span><span class="ck-text">' + (l.html || '<br>') + '</span></div>'
        : '<div class="ck-item"><span class="ck-box" contenteditable="false"></span><span class="ck-text">' + (l || '<br>') + '</span></div>').join('');
      const last = bodyEl.querySelector('.ck-item:last-child .ck-text');
      if (last) {
        const r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
        const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    },
    bind: (bodyEl, onChange) => {
      bodyEl.addEventListener('mousedown', e => {
        const box = e.target.closest('.ck-box');
        if (box) { e.preventDefault(); box.parentElement.classList.toggle('done'); onChange && onChange(); }
      });
      bodyEl.addEventListener('keydown', e => {
        if (!checklist.inside(bodyEl) || e.shiftKey) return;
        const sel = document.getSelection();
        const node = sel.anchorNode;
        const el0 = node && (node.nodeType === 3 ? node.parentElement : node.nodeType === 1 ? node : null);
        const textSpan = el0 && el0.closest ? el0.closest('.ck-text') : null;
        if (!textSpan) return;
        const ckItem = textSpan.closest('.ck-item');
        // 空行按 Enter → 退出清单，变普通段落
        if (e.key === 'Enter' && textSpan.textContent.trim() === '') {
          e.preventDefault();
          const plain = document.createElement('div');
          plain.innerHTML = '<br>';
          if (ckItem.nextSibling) ckItem.parentNode.insertBefore(plain, ckItem.nextSibling);
          else ckItem.parentNode.appendChild(plain);
          ckItem.remove();
          const r2 = document.createRange(); r2.selectNodeContents(plain); r2.collapse(false);
          sel.removeAllRanges(); sel.addRange(r2);
          onChange && onChange();
          return;
        }
        // 空行按 Backspace → 删除整行
        if (e.key === 'Backspace' && textSpan.textContent.trim() === '') {
          e.preventDefault();
          const prev = ckItem.previousElementSibling;
          ckItem.remove();
          if (!bodyEl.querySelector('.ck-item')) { onChange && onChange(); return; }
          const target = (prev && prev.querySelector('.ck-text')) || bodyEl.querySelector('.ck-item:last-child .ck-text');
          if (target) {
            const r2 = document.createRange(); r2.selectNodeContents(target); r2.collapse(false);
            sel.removeAllRanges(); sel.addRange(r2);
          }
          onChange && onChange();
          return;
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const range = sel.getRangeAt(0);
        const after = range.cloneRange();
        after.selectNodeContents(textSpan);
        after.setStart(range.endContainer, range.endOffset);
        const frag = after.extractContents();
        const holder = document.createElement('div');
        holder.appendChild(frag);
        const newItem = document.createElement('div');
        newItem.className = 'ck-item';
        newItem.innerHTML = '<span class="ck-box" contenteditable="false"></span><span class="ck-text"></span>';
        newItem.querySelector('.ck-text').innerHTML = holder.innerHTML || '<br>';
        if (ckItem.nextSibling) ckItem.parentNode.insertBefore(newItem, ckItem.nextSibling);
        else ckItem.parentNode.appendChild(newItem);
        const nt = newItem.querySelector('.ck-text');
        const r2 = document.createRange(); r2.selectNodeContents(nt); r2.collapse(true);
        sel.removeAllRanges(); sel.addRange(r2);
        onChange && onChange();
      });
    }
  };

  /* 粘贴清洗：只放行白名单标签，img 仅限 attach:/data:，a 仅限 http(s)，其余降级为纯文本 */
  function sanitizeHtml(html) {
    const tpl = document.createElement('div');
    tpl.innerHTML = String(html || '');
    const ok = new Set(['B', 'I', 'U', 'S', 'STRIKE', 'STRONG', 'EM', 'BR', 'DIV', 'SPAN', 'P', 'UL', 'OL', 'LI', 'IMG', 'A', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);
    (function walk(node) {
      [...node.children].forEach(ch => {
        walk(ch);
        if (!ok.has(ch.tagName)) {
          const frag = document.createDocumentFragment();
          [...ch.childNodes].forEach(n => frag.appendChild(n));
          ch.replaceWith(frag);
          return;
        }
        [...ch.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (n === 'style' || n === 'class' || n === 'contenteditable') return;
          ch.removeAttribute(a.name);
        });
        if (ch.tagName === 'IMG') {
          const src = ch.getAttribute('src') || '';
          if (!src.startsWith('attach://') && !src.startsWith('data:image/')) ch.remove();
        }
        if (ch.tagName === 'A') {
          const href = ch.getAttribute('href') || '';
          if (!/^https?:/i.test(href)) ch.removeAttribute('href');
          else { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener noreferrer'); }
        }
      });
    })(tpl);
    return tpl.innerHTML;
  }
  function bindSanitizedPaste(el, onChange) {
    el.addEventListener('paste', e => {
      e.preventDefault();
      const html = e.clipboardData && e.clipboardData.getData('text/html');
      if (html) {
        document.execCommand('insertHTML', false, sanitizeHtml(html));
      } else {
        const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        document.execCommand('insertText', false, text);
      }
      onChange && onChange();
    });
  }

  window.UI = { showMenu, closeMenu, toast, confirmBox, promptBox, dropdown, ICONS, checklist, sanitizeHtml, bindSanitizedPaste, expand: (r, f, t) => R.expand(r, f, t), fixAttach, weekdayCN, repeatText, fmtTime, plainText, uid, pad2, ymd, WEEK };
})();

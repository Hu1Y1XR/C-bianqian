/* 粘贴/导入内容清洗：白名单式，主进程 require 与渲染层 <script> 双兼容
   设计要点：
   1) 先按标签读取关键属性（src/href），校验通过后再统一剥离属性——顺序不能反
   2) script/style/iframe/object 等危险元素整块丢弃，不是解开
   3) img 只允许 attach:// 与位图 data URI（排除 svg，防脚本注入）
   4) style 保留但剔除 position/z-index/behavior/expression 等危险声明
   5) 属性白名单法：非白名单属性一律删除 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sanitize = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ALLOWED_TAGS = new Set([
    'B', 'I', 'U', 'S', 'STRIKE', 'STRONG', 'EM', 'BR', 'DIV', 'SPAN', 'P',
    'UL', 'OL', 'LI', 'IMG', 'A', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR'
  ]);
  // 整块丢弃（含内容），不保留文本
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT',
    'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'VIDEO', 'AUDIO'
  ]);
  const ATTR_ALLOW = {
    IMG: ['src', 'alt', 'width', 'height'],
    A: ['href', 'target', 'rel'],
    _default: []
  };
  const BAD_STYLE_DECL = /(position|z-index|behavior|-moz-binding|expression|content\s*:)/i;
  const IMG_SRC_OK = /^(attach:\/\/|data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,)/i;

  /* 大小写不敏感取属性：某些解析路径可能保留 <IMG SRC> 大写，
     getAttribute('src') 取不到时按小写名在 attributes 里回查 */
  function attr(el, name) {
    const v = el.getAttribute(name);
    if (v !== null && v !== undefined) return v;
    const lower = String(name).toLowerCase();
    const list = el.attributes ? [...el.attributes] : [];
    for (const a of list) {
      if (String(a.name).toLowerCase() === lower) return a.value;
    }
    return null;
  }
  function removeAttr(el, name) {
    el.removeAttribute(name);
    const lower = String(name).toLowerCase();
    const list = el.attributes ? [...el.attributes] : [];
    for (const a of list) {
      if (String(a.name).toLowerCase() === lower) el.removeAttribute(a.name);
    }
  }

  /* 属性规范化：统一小写名并按固定顺序重排。
     目的：jsdom 与 linkedom 的序列化行为不同（linkedom 保留原始大小写、setAttribute 前插），
     规范化后两个解析器对同一输入产出逐字节一致的 HTML */
  const ATTR_ORDER = ['src', 'alt', 'width', 'height', 'href', 'target', 'rel', 'style', 'contenteditable', 'class'];
  const appendModeCache = new WeakMap();
  function isAppendMode(doc) {
    if (appendModeCache.has(doc)) return appendModeCache.get(doc);
    let append = true;
    try {
      const probe = doc.createElement('div');
      probe.setAttribute('a', '1');
      probe.setAttribute('b', '2');
      const first = [...probe.attributes][0];
      append = !!first && String(first.name) === 'a';
    } catch (e) { append = true; }
    appendModeCache.set(doc, append);
    return append;
  }
  function rank(name) { const i = ATTR_ORDER.indexOf(name); return i < 0 ? 99 : i; }
  function normalizeAttributes(el, doc) {
    const list = el.attributes ? [...el.attributes] : [];
    if (!list.length) return;
    const seen = new Set();
    const uniq = [];
    for (const a of list) {
      const n = String(a.name).toLowerCase();
      if (seen.has(n)) continue;
      seen.add(n);
      uniq.push([n, a.value]);
    }
    uniq.sort((x, y) => rank(x[0]) - rank(y[0]));
    const alreadyNormal = list.length === uniq.length && list.every((a, i) => String(a.name) === uniq[i][0]);
    if (alreadyNormal) return;
    list.forEach(a => el.removeAttribute(a.name));
    const seq = isAppendMode(doc) ? uniq : uniq.slice().reverse();
    for (const [n, v] of seq) el.setAttribute(n, v);
  }

  function sanitizeStyle(value) {
    if (!value) return '';
    return String(value)
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(decl => !BAD_STYLE_DECL.test(decl))
      .filter(decl => !/url\s*\(\s*['"]?\s*(javascript|vbscript|data:text)/i.test(decl))
      .join('; ');
  }

  function sanitizeHtml(html, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return String(html || '').replace(/<[^>]*>/g, '');
    const tpl = d.createElement('div');
    tpl.innerHTML = String(html || '');

    (function walk(node) {
      [...node.children].forEach(ch => {
        const tag = ch.tagName;

        // 1) 危险元素整块丢弃
        if (DROP_TAGS.has(tag)) { ch.remove(); return; }

        // 2) 非白名单标签：解开，保留子节点（递归处理子节点后再解）
        if (!ALLOWED_TAGS.has(tag)) {
          walk(ch);
          const frag = d.createDocumentFragment();
          [...ch.childNodes].forEach(n => frag.appendChild(n));
          ch.replaceWith(frag);
          return;
        }

        walk(ch);

        // 3) 先读关键属性并校验（必须在剥离之前）
        const src = tag === 'IMG' ? (attr(ch, 'src') || '') : null;
        const href = tag === 'A' ? (attr(ch, 'href') || '') : null;
        const styleRaw = attr(ch, 'style');

        if (tag === 'IMG' && !IMG_SRC_OK.test(src)) { ch.remove(); return; }
        if (tag === 'A' && href !== null && !/^https?:\/\//i.test(href)) {
          // 非 http(s) 链接：保留文字，去掉链接语义
          const frag = d.createDocumentFragment();
          [...ch.childNodes].forEach(n => frag.appendChild(n));
          ch.replaceWith(frag);
          return;
        }

        // 4) 属性白名单剥离（此时关键属性已读完，删掉也不影响判断）
        //    特例：清单结构（ck-item/ck-box/ck-text + contenteditable=false）必须保留，
        //    否则用户在便签之间复制粘贴清单时会破坏勾选框结构
        const allow = ATTR_ALLOW[tag] || ATTR_ALLOW._default;
        [...ch.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (allow.includes(n)) return;
          if (n === 'class' && /^(ck-(item|box|text)( done)?|done)$/.test((attr(ch, 'class') || '').trim())) return;
          if (n === 'contenteditable' && (attr(ch, 'contenteditable') || '') === 'false') return;
          ch.removeAttribute(a.name);
        });

        // 5) 安全属性回填/规范化
        if (styleRaw) {
          const clean = sanitizeStyle(styleRaw);
          if (clean) ch.setAttribute('style', clean);
          else removeAttr(ch, 'style');
        }
        if (tag === 'A') {
          ch.setAttribute('target', '_blank');
          ch.setAttribute('rel', 'noopener noreferrer');
        }
        if (tag === 'IMG') {
          const w = attr(ch, 'width');
          const h = attr(ch, 'height');
          if (w && !/^\d{1,5}$/.test(w)) removeAttr(ch, 'width');
          if (h && !/^\d{1,5}$/.test(h)) removeAttr(ch, 'height');
        }

        // 6) 属性名小写化 + 固定顺序，保证不同 DOM 实现序列化一致
        normalizeAttributes(ch, d);
      });
    })(tpl);

    return tpl.innerHTML;
  }

  return { sanitizeHtml, sanitizeStyle, ALLOWED_TAGS, DROP_TAGS };
});

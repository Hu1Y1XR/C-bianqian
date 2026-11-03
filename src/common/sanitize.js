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
        const src = tag === 'IMG' ? (ch.getAttribute('src') || '') : null;
        const href = tag === 'A' ? (ch.getAttribute('href') || '') : null;
        const styleRaw = ch.getAttribute('style');

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
          if (n === 'class' && /^(ck-(item|box|text)( done)?|done)$/.test((ch.getAttribute('class') || '').trim())) return;
          if (n === 'contenteditable' && (ch.getAttribute('contenteditable') || '') === 'false') return;
          ch.removeAttribute(a.name);
        });

        // 5) 安全属性回填/规范化
        if (styleRaw) {
          const clean = sanitizeStyle(styleRaw);
          if (clean) ch.setAttribute('style', clean);
          else ch.removeAttribute('style');
        }
        if (tag === 'A') {
          ch.setAttribute('target', '_blank');
          ch.setAttribute('rel', 'noopener noreferrer');
        }
        if (tag === 'IMG') {
          const w = ch.getAttribute('width');
          const h = ch.getAttribute('height');
          if (w && !/^\d{1,5}$/.test(w)) ch.removeAttribute('width');
          if (h && !/^\d{1,5}$/.test(h)) ch.removeAttribute('height');
        }
      });
    })(tpl);

    return tpl.innerHTML;
  }

  return { sanitizeHtml, sanitizeStyle, ALLOWED_TAGS, DROP_TAGS };
});

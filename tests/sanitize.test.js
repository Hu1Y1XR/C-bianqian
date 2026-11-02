/* sanitize.js 单元测试：node tests/sanitize.test.js */
const assert = require('assert');
const { JSDOM } = require('jsdom');
const Sanitize = require('../src/common/sanitize.js');

const doc = new JSDOM('').window.document;
const clean = html => Sanitize.sanitizeHtml(html, doc);
// 归一化：浏览器会补全属性顺序，比较时用 DOM 解析回来对比结构
const norm = html => { const d = doc.createElement('div'); d.innerHTML = html; return d.innerHTML; };

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/* —— 本次回归：属性剥离顺序 —— */
t('img 的 src 能通过校验并保留（顺序 bug 回归）', () => {
  const out = clean('<img src="attach://a.png" alt="x">');
  assert.ok(out.includes('src="attach://a.png"'), 'src 被误删: ' + out);
  assert.ok(out.includes('<img'), 'img 被误删: ' + out);
});
t('a 的 http(s) href 保留并加 noopener', () => {
  const out = clean('<a href="https://example.com">站点</a>');
  assert.ok(out.includes('href="https://example.com"'), 'href 被误删: ' + out);
  assert.ok(out.includes('rel="noopener noreferrer"'), '缺 rel: ' + out);
  assert.ok(out.includes('target="_blank"'), '缺 target: ' + out);
});

/* —— img 白名单 —— */
t('img 拒绝 svg data URI（XSS 向量）', () => {
  assert.strictEqual(clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">').includes('<img'), false);
});
t('img 允许位图 data URI', () => {
  const out = clean('<img src="data:image/png;base64,iVBORw0KGgo=">');
  assert.ok(out.includes('<img'), out);
});
t('img 拒绝远程/本地绝对路径与 javascript:', () => {
  for (const bad of ['http://evil/x.png', 'file:///C:/x.png', 'javascript:alert(1)', '']) {
    assert.strictEqual(clean(`<img src="${bad}">`).includes('<img'), false, 'should drop: ' + bad);
  }
});

/* —— 危险元素 —— */
t('script/style 整块丢弃（含内容）', () => {
  const out = clean('<div>安全<script>alert(1)<\/script><style>body{color:red}</style></div>');
  assert.ok(!/script|alert|color:red/i.test(out), out);
  assert.ok(out.includes('安全'), out);
});
t('iframe/object/embed/svg 整块丢弃', () => {
  const out = clean('<iframe src="x"></iframe><object data="x"></object><svg><circle/></svg><p>正文</p>');
  assert.ok(!/iframe|object|svg/i.test(out), out);
  assert.ok(out.includes('正文'), out);
});

/* —— 属性与 style —— */
t('on* 事件属性一律剥离', () => {
  const out = clean('<div onclick="alert(1)" onmouseover="x()">文字</div>');
  assert.ok(!/onclick|onmouseover/i.test(out), out);
  assert.ok(out.includes('文字'), out);
});
t('style 保留安全声明，剔除 position/z-index', () => {
  const out = clean('<span style="color: red; position: fixed; z-index: 999; font-weight: bold">x</span>');
  assert.ok(out.includes('color: red'), out);
  assert.ok(out.includes('font-weight: bold'), out);
  assert.ok(!/position|z-index/i.test(out), out);
});
t('style 中的 expression / javascript url 剔除', () => {
  const out = clean('<span style="width: expression(alert(1)); background: url(javascript:alert(1))">x</span>');
  assert.ok(!/expression|javascript/i.test(out), out);
});
t('非白名单属性剥离，白名单标签保留', () => {
  const out = clean('<div class="evil" id="x" data-foo="1" contenteditable="true">文字</div>');
  assert.ok(!/class=|id=|data-foo|contenteditable/i.test(out), out);
  assert.ok(out.includes('文字'), out);
  assert.ok(out.includes('<div>'), out);
});

/* —— 其他 —— */
t('非白名单标签解开保留文字', () => {
  const out = clean('<table><tr><td>单元格</td></tr></table>');
  assert.ok(!/<table|<tr|<td/i.test(out), out);
  assert.ok(out.includes('单元格'), out);
});
t('javascript: 链接降级为纯文本', () => {
  const out = clean('<a href="javascript:alert(1)">点我</a>');
  assert.ok(!/<a/i.test(out), out);
  assert.ok(out.includes('点我'), out);
});
t('空/undefined 输入安全', () => {
  assert.strictEqual(clean(''), '');
  assert.strictEqual(clean(null), '');
  assert.strictEqual(clean(undefined), '');
});
t('嵌套结构保留常规排版', () => {
  const out = clean('<div><b>粗</b><ul><li>项</li></ul><br></div>');
  assert.ok(out.includes('<b>粗</b>'), out);
  assert.ok(out.includes('<li>项</li>'), out);
  assert.ok(out.includes('<br>'), out);
});

let fail = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); }
}
console.log(fail ? `${fail} 个用例失败` : `全部 ${cases.length} 个用例通过`);
process.exit(fail ? 1 : 0);

/* recur.js 单元测试：node tests/recur.test.js */
const assert = require('assert');
const Recur = require('../src/common/recur.js');

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('每月 31 日短月截断到月末', () => {
  assert.deepStrictEqual(
    Recur.expand({ date: '2026-01-31', repeat: 'month', repeatDays: [31] }, '2026-01-01', '2026-04-30'),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});
t('每月多日（16,17,18）', () => {
  assert.deepStrictEqual(
    Recur.expand({ date: '2025-07-16', repeat: 'month', repeatDays: [16, 17, 18] }, '2026-10-01', '2026-10-31'),
    ['2026-10-16', '2026-10-17', '2026-10-18']);
});
t('每 2 月按起始月对齐', () => {
  assert.deepStrictEqual(
    Recur.expand({ date: '2026-01-10', repeat: 'month', repeatEvery: 2 }, '2026-07-01', '2026-12-31'),
    ['2026-07-10', '2026-09-10', '2026-11-10']);
});
t('周重复不下探区间下界', () => {
  assert.deepStrictEqual(
    Recur.expand({ date: '2026-10-26', repeat: 'week', repeatWeekdays: [1] }, '2026-11-01', '2026-11-30'),
    ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
});
t('年重复 2 月 29 闰年截断', () => {
  assert.deepStrictEqual(
    Recur.expand({ date: '2024-02-29', repeat: 'year' }, '2026-02-01', '2026-03-01'),
    ['2026-02-28']);
});
t('单次提醒只落在自身日期', () => {
  assert.deepStrictEqual(Recur.expand({ date: '2026-10-15', repeat: 'none' }, '2026-10-01', '2026-10-31'), ['2026-10-15']);
  assert.deepStrictEqual(Recur.expand({ date: '2026-11-13', repeat: 'none' }, '2026-10-01', '2026-10-31'), []);
});
t('重复截止日期生效', () => {
  assert.deepStrictEqual(
    Recur.expand({ date: '2026-01-05', repeat: 'day', endDate: '2026-01-10' }, '2026-01-01', '2026-01-31'),
    ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10']);
});
t('空/坏数据返回空数组', () => {
  assert.deepStrictEqual(Recur.expand(null, '2026-01-01', '2026-12-31'), []);
  assert.deepStrictEqual(Recur.expand({}, '2026-01-01', '2026-12-31'), []);
  assert.deepStrictEqual(Recur.expand({ date: 'not-a-date', repeat: 'day' }, '2026-01-01', '2026-12-31'), []);
});

let fail = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); }
}
console.log(fail ? `${fail} 个用例失败` : `全部 ${cases.length} 个用例通过`);
process.exit(fail ? 1 : 0);

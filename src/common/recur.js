/* 重复提醒展开：主进程 require / 渲染层 <script> 双兼容 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Recur = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  /* 区间展开：返回 [fromStr, toStr] 内的全部发生日（YYYY-MM-DD 升序）
     r: { date, time, repeat, repeatWeekdays, repeatDays, repeatEvery, endDate }
     月/年重复在短月自动截断到月末（1月31日 → 2月按 28/29 算） */
  function expand(r, fromStr, toStr) {
    if (!r || !r.date) return [];
    const out = [];
    const start = new Date(r.date + 'T00:00:00');
    const rangeFrom = new Date(fromStr + 'T00:00:00');
    const rangeTo = new Date(toStr + 'T23:59:59');
    const cap = r.endDate ? new Date(r.endDate + 'T23:59:59') : rangeTo;
    if (isNaN(start.getTime()) || rangeTo < start || rangeFrom > cap) return [];

    const push = d => { const s = ymd(d); if (s >= fromStr && s <= toStr && d <= cap) out.push(s); };

    if (!r.repeat || r.repeat === 'none') {
      if (r.date >= fromStr && r.date <= toStr && start <= cap) out.push(r.date);
      return out;
    }

    if (r.repeat === 'day') {
      let d = new Date(Math.max(start.getTime(), rangeFrom.getTime()));
      while (d <= rangeTo && d <= cap) { push(d); d.setDate(d.getDate() + 1); }
    } else if (r.repeat === 'week') {
      const wd = (r.repeatWeekdays && r.repeatWeekdays.length) ? r.repeatWeekdays : [start.getDay()];
      let d = new Date(Math.max(start.getTime(), rangeFrom.getTime()));
      d.setDate(d.getDate() - 7); // 回退一周对齐星期
      while (d <= rangeTo && d <= cap) {
        if (d >= start && wd.includes(d.getDay())) push(d);
        d.setDate(d.getDate() + 1);
      }
    } else if (r.repeat === 'month') {
      const days = (r.repeatDays && r.repeatDays.length) ? r.repeatDays : [start.getDate()];
      const every = r.repeatEvery || 1;
      const idx0 = start.getFullYear() * 12 + start.getMonth();
      let y = rangeFrom.getFullYear(), m = rangeFrom.getMonth();
      if (y * 12 + m < idx0) { y = start.getFullYear(); m = start.getMonth(); }
      const lastIdx = rangeTo.getFullYear() * 12 + rangeTo.getMonth();
      let guard = 0;
      while (y * 12 + m <= lastIdx && guard++ < 2000) {
        if ((y * 12 + m - idx0) % every === 0) {
          for (const day of days) {
            const dd = Math.min(day, daysInMonth(y, m)); // 短月截断到月末
            const dt = new Date(y, m, dd);
            if (dt >= start && dt <= rangeTo && dt <= cap) out.push(ymd(dt));
          }
        }
        m += 1; if (m > 11) { m = 0; y += 1; }
      }
    } else if (r.repeat === 'year') {
      for (let y = rangeFrom.getFullYear(); y <= rangeTo.getFullYear(); y++) {
        const dt = new Date(y, start.getMonth(), Math.min(start.getDate(), daysInMonth(y, start.getMonth())));
        if (dt >= start && dt <= rangeTo && dt <= cap) out.push(ymd(dt));
      }
    }
    return [...new Set(out)].sort();
  }

  return { expand, ymd, pad2, daysInMonth };
});

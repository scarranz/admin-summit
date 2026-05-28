// Shared projection helpers

export function recomputeAccountTotals(acct) {
  const yt = {};
  Object.keys(acct.monthly).forEach(ym => {
    const y = parseInt(ym.split('-')[0]);
    yt[y] = (yt[y] || 0) + acct.monthly[ym];
  });
  Object.keys(yt).forEach(y => { yt[y] = Math.round(yt[y] * 100) / 100; });
  acct.year_totals = yt;
  acct.grand_total = Math.round(Object.values(yt).reduce((s, v) => s + v, 0) * 100) / 100;
}

export function recomputeLineTotals(line) {
  const yt = {};
  Object.keys(line.monthly).forEach(ym => {
    const y = parseInt(ym.split('-')[0]);
    yt[y] = (yt[y] || 0) + line.monthly[ym];
  });
  Object.keys(yt).forEach(y => { yt[y] = Math.round(yt[y] * 100) / 100; });
  line.year_totals = yt;
  line.grand_total = Math.round(Object.values(yt).reduce((s, v) => s + v, 0) * 100) / 100;
}

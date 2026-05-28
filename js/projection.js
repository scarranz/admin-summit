// Shared projection helpers

export function recomputeAccountTotals(acct) {
  const yt = {};
  const hasMonthly = {}; // track which years have real monthly entries

  Object.keys(acct.monthly).forEach(ym => {
    const parts = ym.split('-');
    const y = parseInt(parts[0]);
    const m = parts[1];
    if (m === '00' || m === 'annual') {
      // Annual-only entry — use only if no monthly entries exist for this year
      if (!hasMonthly[y]) yt[y] = (yt[y] || 0) + acct.monthly[ym];
    } else {
      // Monthly entry — if this is the first monthly entry for the year,
      // discard any annual entry we already counted
      if (!hasMonthly[y] && yt[y]) yt[y] = 0;
      hasMonthly[y] = true;
      yt[y] = (yt[y] || 0) + acct.monthly[ym];
    }
  });

  Object.keys(yt).forEach(y => { yt[y] = Math.round(yt[y] * 100) / 100; });
  acct.year_totals = yt;
  acct.grand_total = Math.round(Object.values(yt).reduce((s, v) => s + v, 0) * 100) / 100;
}

export function recomputeLineTotals(line) {
  const yt = {};
  const hasMonthly = {};

  Object.keys(line.monthly).forEach(ym => {
    const parts = ym.split('-');
    const y = parseInt(parts[0]);
    const m = parts[1];
    if (m === '00' || m === 'annual') {
      if (!hasMonthly[y]) yt[y] = (yt[y] || 0) + line.monthly[ym];
    } else {
      if (!hasMonthly[y] && yt[y]) yt[y] = 0;
      hasMonthly[y] = true;
      yt[y] = (yt[y] || 0) + line.monthly[ym];
    }
  });

  Object.keys(yt).forEach(y => { yt[y] = Math.round(yt[y] * 100) / 100; });
  line.year_totals = yt;
  line.grand_total = Math.round(Object.values(yt).reduce((s, v) => s + v, 0) * 100) / 100;
}

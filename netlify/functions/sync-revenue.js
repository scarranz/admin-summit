// Sync management fees from Neon (export.fees) → Supabase (revenue_cells)
// Called from the Revenue page "Sync from API" button.
// Requires env vars: NEON_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY

const { neon } = require('@neondatabase/serverless');

const BANK_SLUG_MAP = {
  merrill_lynch: 'ML',
  jp_morgan: 'JPM',
  goldman_sachs: 'GS',
};
const PROTECTED_BANKS = new Set(['GS']);
const SYNC_START_YEAR = 2026;
const SYNC_START_MONTH = 5;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function ok(body) { return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) }; }
function err(status, msg) { return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) }; }

// Minimal Supabase REST client (service key — bypasses RLS)
function makeSupabase(url, serviceKey) {
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  return {
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`SELECT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async insert(table, rows) {
      const res = await fetch(`${base}/${table}`, { method: 'POST', headers, body: JSON.stringify(rows) });
      if (!res.ok) throw new Error(`INSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async upsert(table, rows) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`UPSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  const { NEON_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } = process.env;
  if (!NEON_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) return err(500, 'Server misconfigured');

  // ─── Verify caller has a valid Supabase session ───
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return err(401, 'Unauthorized');

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return err(401, 'Invalid session');

  // ─── Run sync ───
  try {
    const sql = neon(NEON_URL);
    const supa = makeSupabase(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Fetch fees from Neon
    const fees = await sql`
      SELECT portfolio_name, bank_slug, bank_name, period_year, period_month, fee_amount
      FROM export.fees
      WHERE fee_type = 'management'
        AND (period_year > ${SYNC_START_YEAR}
          OR (period_year = ${SYNC_START_YEAR} AND period_month >= ${SYNC_START_MONTH}))
        AND portfolio_name NOT IN ('Team Blue', 'Team Green', '2025')
      ORDER BY portfolio_name, period_year, period_month
    `;

    if (fees.length === 0) {
      return ok({ synced: 0, created: [], skipped_manual: 0, skipped_gs: 0 });
    }

    // 2. Load existing accounts
    const accounts = await supa.select('revenue_accounts', 'select=id,bank,account_name,display_order');
    const acctMap = new Map(accounts.map(a => [`${a.bank}|${a.account_name}`, a.id]));
    let maxOrder = accounts.reduce((m, a) => Math.max(m, a.display_order || 0), 0);

    const stats = { synced: 0, skipped_gs: 0, skipped_manual: 0, created: [] };
    const portfolioBank = new Map();

    // 3. Resolve bank codes; auto-create accounts for new clients
    for (const f of fees) {
      if (portfolioBank.has(f.portfolio_name)) continue;

      let bank = BANK_SLUG_MAP[f.bank_slug];
      if (!bank && f.bank_name === 'UBS') bank = 'UBS';
      if (!bank) continue;

      if (PROTECTED_BANKS.has(bank)) { stats.skipped_gs++; continue; }

      portfolioBank.set(f.portfolio_name, bank);

      const key = `${bank}|${f.portfolio_name}`;
      if (!acctMap.has(key)) {
        const [created] = await supa.insert('revenue_accounts', [{
          bank,
          account_name: f.portfolio_name,
          display_order: ++maxOrder,
        }]);
        acctMap.set(key, created.id);
        stats.created.push({ bank, name: f.portfolio_name });
      }
    }

    // 4. Load manual cells to protect
    const startYM = `${SYNC_START_YEAR}-${String(SYNC_START_MONTH).padStart(2, '0')}`;
    const manualRows = await supa.select(
      'revenue_cells',
      `select=account_id,year_month&source=eq.manual&year_month=gte.${startYM}`
    );
    const manualCells = new Set(manualRows.map(c => `${c.account_id}|${c.year_month}`));

    // 5. Build upsert batch
    const batch = [];
    for (const f of fees) {
      const bank = portfolioBank.get(f.portfolio_name);
      if (!bank) continue;
      const accountId = acctMap.get(`${bank}|${f.portfolio_name}`);
      if (!accountId) continue;

      const yearMonth = `${f.period_year}-${String(f.period_month).padStart(2, '0')}`;
      const amount = parseFloat(f.fee_amount);
      if (isNaN(amount)) continue;

      if (manualCells.has(`${accountId}|${yearMonth}`)) { stats.skipped_manual++; continue; }

      batch.push({ account_id: accountId, year_month: yearMonth, amount: Math.round(amount * 100) / 100, is_projected: false, source: 'api' });
      stats.synced++;
    }

    // 6. Upsert in chunks of 50
    for (let i = 0; i < batch.length; i += 50) {
      await supa.upsert('revenue_cells', batch.slice(i, i + 50));
    }

    return ok(stats);
  } catch (e) {
    console.error('Sync error:', e);
    return err(500, e.message);
  }
};

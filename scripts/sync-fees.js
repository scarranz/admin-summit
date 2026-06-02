#!/usr/bin/env node
// Sync management fees from Neon (export.fees) → Supabase (revenue_cells)
// Usage: node scripts/sync-fees.js [--dry-run]

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// ─── Config ───

const BANK_SLUG_MAP = {
  merrill_lynch: 'ML',
  jp_morgan: 'JPM',
  goldman_sachs: 'GS',
};

const IGNORED_PORTFOLIOS = new Set(['Team Blue', 'Team Green', '2025']);
const SYNC_START_YEAR = 2026;
const SYNC_START_MONTH = 5;
const PROTECTED_BANKS = new Set(['GS']); // SMGS is manual-only


const DRY_RUN = process.argv.includes('--dry-run');

// ─── Load env ───

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.sync');
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env.sync — create it with NEON_URL, SUPABASE_URL, and SUPABASE_SERVICE_KEY');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  if (!env.NEON_URL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error('.env.sync must have NEON_URL, SUPABASE_URL, and SUPABASE_SERVICE_KEY');
    process.exit(1);
  }
  return env;
}

// ─── Supabase REST helpers ───

function supaRest(env) {
  const base = env.SUPABASE_URL + '/rest/v1';
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
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
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`INSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    async upsert(table, rows, onConflict) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`UPSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}

// ─── Main ───

async function main() {
  const env = loadEnv();
  if (DRY_RUN) console.log('DRY RUN — no writes will be made\n');

  const sql = neon(env.NEON_URL);
  const supa = supaRest(env);

  // ─── Phase 1: Fetch fees from Neon ───
  console.log('Fetching fees from Neon...');
  const fees = await sql`
    SELECT portfolio_name, bank_slug, bank_name, period_year, period_month, fee_amount
    FROM export.fees
    WHERE fee_type = 'management'
      AND (period_year > ${SYNC_START_YEAR} OR (period_year = ${SYNC_START_YEAR} AND period_month >= ${SYNC_START_MONTH}))
      AND portfolio_name NOT IN ('Team Blue', 'Team Green', '2025')
    ORDER BY portfolio_name, period_year, period_month
  `;

  console.log(`  ${fees.length} fee rows fetched\n`);
  if (fees.length === 0) { console.log('Nothing to sync.'); return; }

  // ─── Phase 2: Load existing revenue_accounts from Supabase ───
  console.log('Loading revenue_accounts from Supabase...');
  const accounts = await supa.select('revenue_accounts', 'select=id,bank,account_name');

  const acctMap = new Map();
  for (const a of accounts) {
    acctMap.set(`${a.bank}|${a.account_name}`, a.id);
  }
  console.log(`  ${accounts.length} accounts loaded\n`);

  // ─── Phase 3: Resolve bank codes and match/create accounts ───
  console.log('Matching portfolios to accounts...');
  const stats = { fetched: fees.length, upserted: 0, skipped_gs: 0, skipped_manual: 0, created: [] };

  const portfolioBank = new Map();
  for (const f of fees) {
    if (portfolioBank.has(f.portfolio_name)) continue;

    let bank = BANK_SLUG_MAP[f.bank_slug];
    if (!bank && f.bank_name === 'UBS') bank = 'UBS';

    if (!bank) {
      console.warn(`  Warning: No bank mapping for ${f.portfolio_name} (slug=${f.bank_slug}, name=${f.bank_name}) — skipping`);
      continue;
    }

    if (PROTECTED_BANKS.has(bank)) {
      stats.skipped_gs++;
      continue;
    }

    portfolioBank.set(f.portfolio_name, bank);

    const key = `${bank}|${f.portfolio_name}`;
    if (!acctMap.has(key)) {
      if (DRY_RUN) {
        console.log(`  Would create account: ${bank} / ${f.portfolio_name}`);
        acctMap.set(key, 'dry-run-id');
      } else {
        const maxOrder = accounts.reduce((m, a) => Math.max(m, a.display_order || 0), 0);
        const [created] = await supa.insert('revenue_accounts', [{
          bank,
          account_name: f.portfolio_name,
          display_order: maxOrder + 1
        }]);
        acctMap.set(key, created.id);
        console.log(`  Created account: ${bank} / ${f.portfolio_name} (${created.id})`);
      }
      stats.created.push(f.portfolio_name);
    }
  }

  // ─── Phase 4: Upsert revenue_cells ───
  console.log('\nSyncing revenue cells...');

  // First, load existing cells for the sync period so we can skip manual ones
  const existingCells = await supa.select(
    'revenue_cells',
    `select=account_id,year_month,source&source=eq.manual&year_month=gte.${SYNC_START_YEAR}-${String(SYNC_START_MONTH).padStart(2, '0')}`
  );
  const manualCells = new Set(existingCells.map(c => `${c.account_id}|${c.year_month}`));

  const upsertBatch = [];

  for (const f of fees) {
    const bank = portfolioBank.get(f.portfolio_name);
    if (!bank) continue;

    const key = `${bank}|${f.portfolio_name}`;
    const accountId = acctMap.get(key);
    if (!accountId || accountId === 'dry-run-id') {
      if (DRY_RUN) {
        const ym = `${f.period_year}-${String(f.period_month).padStart(2, '0')}`;
        const amt = parseFloat(f.fee_amount).toFixed(2);
        console.log(`  Would upsert: ${f.portfolio_name} ${ym} = $${amt}`);
        stats.upserted++;
      }
      continue;
    }

    const yearMonth = `${f.period_year}-${String(f.period_month).padStart(2, '0')}`;
    const amount = parseFloat(f.fee_amount);

    if (isNaN(amount)) {
      console.warn(`  Warning: Invalid amount for ${f.portfolio_name} ${yearMonth}: ${f.fee_amount}`);
      continue;
    }

    // Skip cells that were manually edited
    const cellKey = `${accountId}|${yearMonth}`;
    if (manualCells.has(cellKey)) {
      stats.skipped_manual++;
      continue;
    }

    upsertBatch.push({
      account_id: accountId,
      year_month: yearMonth,
      amount: Math.round(amount * 100) / 100,
      is_projected: false,
      source: 'api',
    });
    stats.upserted++;
  }

  if (!DRY_RUN && upsertBatch.length > 0) {
    // Upsert in chunks of 50
    for (let i = 0; i < upsertBatch.length; i += 50) {
      const chunk = upsertBatch.slice(i, i + 50);
      await supa.upsert('revenue_cells', chunk, 'account_id,year_month');
    }
  }

  // ─── Summary ───
  console.log('\n' + '-'.repeat(45));
  console.log(`Sync ${DRY_RUN ? '(dry run) ' : ''}complete:`);
  console.log(`  Fetched:          ${stats.fetched} fee rows from Neon`);
  if (stats.created.length) {
    console.log(`  Accounts created: ${stats.created.length} (${stats.created.join(', ')})`);
  }
  console.log(`  Cells upserted:   ${stats.upserted}`);
  console.log(`  Skipped (manual): ${stats.skipped_manual}`);
  console.log(`  Skipped (GS):     ${stats.skipped_gs}`);
  console.log('-'.repeat(45));
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});

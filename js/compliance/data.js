// Shared in-memory cache for the current session. The compliance
// dashboard is inherently cross-referencing (score cards pull from
// filings + clients + lps + policies + employees at once), so unlike
// research-summit's per-tab-siloed pages, every render function here
// reads from this shared cache instead of re-fetching per page.
// Call refresh<X>() after any write, then re-render.
import * as api from './api.js';

export const state = {
  entities: [],
  entityByKey: {},
  advGuideItems: [],      // all rows; filter by entity_id + form in the UI
  filings: [],
  filingHistory: [],
  documents: [],
  clients: [],
  lps: [],
  employees: [],
  employeeDocuments: [],
  ptReports: [],
  policies: [],
  policyHistory: [],
  regulatoryChecks: [],
  visibility: 'all',       // 'all' | 'external_filed' | 'internal_only'
  loaded: false,
};

export async function loadAll() {
  const [entities, adv, filings, filingHistory, documents, clients, lps, employees, empDocs, ptReports, policies, policyHistory, regulatoryChecks] = await Promise.all([
    api.fetchEntities(),
    // adv_guide_items has no dedicated "fetch all" — pull per-entity below once entities are known
    Promise.resolve({ success: true, data: [] }),
    api.fetchFilings(),
    api.fetchFilingHistory(),
    api.fetchDocuments(),
    api.fetchClients(),
    api.fetchLps(),
    api.fetchEmployees(),
    api.fetchEmployeeDocuments(),
    api.fetchPersonalTradingReports(),
    api.fetchPolicies(),
    api.fetchPolicyHistory(),
    api.fetchRegulatoryChecks(),
  ]);

  state.entities = entities.data || [];
  state.entityByKey = Object.fromEntries(state.entities.map(e => [e.key, e]));
  state.filings = filings.data || [];
  state.filingHistory = filingHistory.data || [];
  state.documents = documents.data || [];
  state.clients = clients.data || [];
  state.lps = lps.data || [];
  state.employees = employees.data || [];
  state.employeeDocuments = empDocs.data || [];
  state.ptReports = ptReports.data || [];
  state.policies = policies.data || [];
  state.policyHistory = policyHistory.data || [];
  state.regulatoryChecks = regulatoryChecks.data || [];

  const guideForms = [
    { key: 'advisory', form: 'adv' },
    { key: 'fund_llc', form: 'adv_era' },
    { key: 'fund_lp', form: 'form_d' },
  ];
  const guideResults = await Promise.all(
    guideForms.map(g => state.entityByKey[g.key]
      ? api.fetchAdvGuideItems(state.entityByKey[g.key].id, g.form)
      : Promise.resolve({ success: true, data: [] }))
  );
  state.advGuideItems = guideResults.flatMap(r => r.data || []);

  state.loaded = true;
  return state;
}

export async function refreshEntities() {
  const r = await api.fetchEntities();
  state.entities = r.data || [];
  state.entityByKey = Object.fromEntries(state.entities.map(e => [e.key, e]));
}
export async function refreshFilings() {
  const r = await api.fetchFilings();
  state.filings = r.data || [];
}
export async function refreshFilingHistory() {
  const r = await api.fetchFilingHistory();
  state.filingHistory = r.data || [];
}
export async function refreshDocuments() {
  const r = await api.fetchDocuments();
  state.documents = r.data || [];
}
export async function refreshClients() {
  const r = await api.fetchClients();
  state.clients = r.data || [];
}
export async function refreshLps() {
  const r = await api.fetchLps();
  state.lps = r.data || [];
}
export async function refreshEmployees() {
  const r = await api.fetchEmployees();
  state.employees = r.data || [];
}
export async function refreshEmployeeDocuments() {
  const r = await api.fetchEmployeeDocuments();
  state.employeeDocuments = r.data || [];
}
export async function refreshPtReports() {
  const r = await api.fetchPersonalTradingReports();
  state.ptReports = r.data || [];
}
export async function refreshPolicies() {
  const r = await api.fetchPolicies();
  state.policies = r.data || [];
}
export async function refreshPolicyHistory() {
  const r = await api.fetchPolicyHistory();
  state.policyHistory = r.data || [];
}
export async function refreshRegulatoryChecks() {
  const r = await api.fetchRegulatoryChecks();
  state.regulatoryChecks = r.data || [];
}

// ─── Visibility filter (external vs internal vs all) ─────────

export function setVisibility(v) { state.visibility = v; }
export function passesVisibility(row) {
  if (state.visibility === 'all') return true;
  return row.visibility === state.visibility;
}

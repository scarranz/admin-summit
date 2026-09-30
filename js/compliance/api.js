// Compliance data layer — READ-ONLY SNAPSHOT, no database.
//
// The Compliance tab was ported from the standalone compliance-summit
// portal. Every fetch returns data from snapshot.js (compliance-summit's
// sql/001–014 applied in order, then exported); every write fails with a
// "not connected" error, which the page modules already surface via alert().
//
// To reconnect it later, replace this file with the original api.js from
// compliance-summit (same exported function names and { success, data,
// error } return shape) pointed at a Supabase client. Nothing else in
// js/compliance/ talks to a backend.
import snapshot from './snapshot.js';

const NOT_CONNECTED = 'Compliance is read-only — it is not connected to a database yet.';

function ok(data) { return { success: true, data, error: null }; }
function fail() { return { success: false, data: null, error: NOT_CONNECTED }; }
// Deep copy so page modules can mutate what they get without touching the snapshot.
const rows = (key, filter = () => true) => ok(structuredClone(snapshot[key].filter(filter)));
const write = async () => fail();

// ─── reads ───────────────────────────────────────────────────

export async function fetchEntities() { return rows('entities'); }
export async function fetchAdvGuideItems(entityId, form) { return rows('advGuideItems', r => r.entity_id === entityId && r.form === form); }
export async function fetchFilings() { return rows('filings'); }
export async function fetchFilingHistory() { return rows('filingHistory'); }
export async function fetchDocuments() { return rows('documents'); }
export async function fetchClients() { return rows('clients'); }
export async function fetchLps() { return rows('lps'); }
export async function fetchEmployees() { return rows('employees'); }
export async function fetchEmployeeDocuments() { return rows('employeeDocuments'); }
export async function fetchPersonalTradingAccounts(employeeId) { return rows('ptAccounts', r => r.employee_id === employeeId); }
export async function fetchPreclearance(employeeId) { return rows('preclearance', r => r.employee_id === employeeId); }
export async function fetchPersonalTradingReports() { return rows('ptReports'); }
export async function fetchPersonalTradingStatements(employeeId) { return rows('ptStatements', r => r.employee_id === employeeId); }
export async function fetchPolicies() { return rows('policies'); }
export async function fetchPolicyHistory() { return rows('policyHistory'); }
export async function fetchRegulatoryChecks() { return rows('regulatoryChecks'); }
// Uploaded files lived in Supabase Storage and were not carried over.
export const getDocumentFileUrl = write;

// ─── writes (all disabled) ───────────────────────────────────

export const updateEntity = write;
export const updateFiling = write;
export const insertFilingHistory = write;
export const updateFilingHistory = write;
export const deleteFilingHistory = write;
export const insertDocument = write;
export const updateDocument = write;
export const deleteDocument = write;
export const uploadDocumentFile = write;
export const deleteDocumentFile = write;
export const deleteDocumentAndFile = write;
export const insertClient = write;
export const updateClient = write;
export const insertLp = write;
export const updateLp = write;
export const insertEmployee = write;
export const updateEmployee = write;
export const updateEmployeeDocument = write;
export const uploadEmployeeDocFile = write;
export const insertPersonalTradingAccount = write;
export const insertPreclearance = write;
export const updatePreclearance = write;
export const updatePersonalTradingReport = write;
export const insertPersonalTradingStatement = write;
export const updatePersonalTradingStatement = write;
export const updatePolicy = write;
export const insertPolicyHistory = write;
export const deletePolicyHistory = write;
export const insertRegulatoryCheck = write;

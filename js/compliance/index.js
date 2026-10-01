// Entry point for admin's Compliance tab (registered as a page loader in
// index.html). Loads the compliance skeleton once; later visits keep state.
import { loadAll } from './data.js';
import { initNav } from './nav.js';

let _loaded = false;

export async function loadCompliancePage() {
  if (_loaded) return;
  _loaded = true;
  await loadAll();
  initNav();
}

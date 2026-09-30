// Compliance tab's internal sub-navigation. Uses .cpage / data-cpage
// (not .page / data-page) so admin's js/nav.js never hides or removes them.
import { $ } from './utils.js';
import { setVisibility } from './data.js';
import { renderDashboard, renderEntityPage } from './entities.js';
import { renderCommunications } from './communications.js';
import { renderPolicies } from './policies.js';
import { renderEmployeesPage } from './employees.js';

const PAGES = {
  'dashboard': { title: ['Dashboard', 'Compliance overview — all entities'], render: () => renderDashboard() },
  'entity-advisory': { title: ['Advisory', 'Technologies ABX LLC'], render: () => renderEntityPage('advisory') },
  'entity-fund_llc': { title: ['Fund — LLC (ERA)', 'Summit Management Technologies ABX, LLC'], render: () => renderEntityPage('fund_llc') },
  'entity-fund_lp': { title: ['Fund — LP', 'Summit Management Technologies ABX, LP'], render: () => renderEntityPage('fund_lp') },

  'int-main': { title: ['Internal Compliance', 'Internal policies · Supervised personnel'], render: () => renderInternalMain() },
  'communication': { title: ['Communication', "What's been sent to investors"], render: () => renderCommunications('page-communication') },
};

function renderInternalMain() {
  renderPolicies('page-int-pol-rows');
  renderEmployeesPage('page-int-emp-rows');
}

const root = () => $('cmp-root');

export function show(id) {
  root().querySelectorAll('.cpage').forEach(p => p.classList.remove('active'));
  root().querySelectorAll('.sb-item[data-cpage]').forEach(n => n.classList.remove('active'));
  const page = $('page-' + id); if (page) page.classList.add('active');
  const navItem = root().querySelector(`.sb-item[data-cpage="${id}"]`);
  if (navItem) navItem.classList.add('active');
  const cfg = PAGES[id];
  if (cfg) { $('cmp-pt').textContent = cfg.title[0]; $('cmp-ps').textContent = cfg.title[1]; cfg.render(); }
}

let _wired = false;

export function initNav() {
  if (_wired) return;
  _wired = true;

  root().querySelectorAll('.sb-item[data-cpage]').forEach(el => el.addEventListener('click', () => show(el.dataset.cpage)));

  // Delegated so it also wires sub-tabs rendered dynamically (entity pages).
  root().addEventListener('click', (e) => {
    const btn = e.target.closest('.stab');
    if (!btn) return;
    const scope = btn.closest('.card') || root();
    scope.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    scope.querySelectorAll('.stab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pane = document.getElementById(btn.dataset.stab);
    if (pane) pane.classList.add('active');
  });

  $('cmp-visibility-filter').addEventListener('change', (e) => {
    setVisibility(e.target.value);
    const activePage = root().querySelector('.cpage.active');
    if (activePage) {
      const id = activePage.id.replace('page-', '');
      const cfg = PAGES[id];
      if (cfg) cfg.render();
    }
  });

  show('dashboard');
}

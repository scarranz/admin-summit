// Sidebar navigation, page switching, role-based access
import { getCurrentUser, canAccess, signOut } from './auth.js';

let _currentPage = null;
let _pageLoaders = {};

export function registerPageLoader(page, loaderFn) {
  _pageLoaders[page] = loaderFn;
}

export function nav(page) {
  const user = getCurrentUser();
  if (!user) return;
  if (!canAccess(page)) { page = user.defaultPage; }

  // Update nav active states
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .nav-child').forEach(n => n.classList.remove('active'));

  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  document.querySelectorAll(`[data-page="${page}"]`).forEach(n => n.classList.add('active'));

  // Ensure expenses dropdown is open when payroll/office selected
  if (page === 'payroll' || page === 'office') {
    const expParent = document.getElementById('exp-parent');
    if (expParent && !expParent.classList.contains('open')) {
      expParent.classList.add('open');
    }
  }

  window.scrollTo({ top: 0 });
  _currentPage = page;

  // Load page data if needed
  if (_pageLoaders[page]) {
    _pageLoaders[page]();
  }

  // Auto-scroll tables to the right
  const tableIdByPage = { revenue: 'revenueTable', payroll: 'payrollTable', office: 'expCategoryTable' };
  const tableId = tableIdByPage[page];
  if (tableId) {
    setTimeout(() => {
      const tbl = document.getElementById(tableId);
      if (tbl) {
        const scroller = tbl.closest('.rev-table-scroll');
        if (scroller) scroller.scrollLeft = scroller.scrollWidth;
      }
    }, 150);
  }
}

export function getCurrentPage() { return _currentPage; }

export function toggleExpenses() {
  document.getElementById('exp-parent').classList.toggle('open');
}

export function initNav() {
  const user = getCurrentUser();
  if (!user) return;

  // Update user info in sidebar
  const nameEl = document.getElementById('sbUserName');
  const roleEl = document.getElementById('sbUserRole');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.label;

  // Apply nav permissions - hide pages user can't access
  document.querySelectorAll('[data-page]').forEach(el => {
    const page = el.dataset.page;
    el.style.display = canAccess(page) ? '' : 'none';
  });

  // If only office is allowed (Deborah), hide the Expenses dropdown and show
  // "Office Expenses" as a standalone top-level nav item instead
  if (user.allowedPages.length === 1 && user.allowedPages[0] === 'office') {
    const navSection = document.querySelector('.nav-section');
    if (navSection) navSection.style.display = 'none';

    // Insert a standalone nav-item for Office Expenses after the revenue item
    const officeNavItem = document.createElement('div');
    officeNavItem.className = 'nav-item';
    officeNavItem.dataset.page = 'office';
    officeNavItem.onclick = () => window._nav('office');
    officeNavItem.innerHTML = `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 17v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/><polyline points="9 11 12 14 17 9"/></svg>
      Office Expenses`;
    const sbNav = document.querySelector('.sb-nav');
    if (sbNav) sbNav.appendChild(officeNavItem);
  }

  // Hide page sections user can't access (defense in depth — RLS is the real guard)
  document.querySelectorAll('.page').forEach(pageEl => {
    const pageId = pageEl.id.replace('page-', '');
    if (!canAccess(pageId)) {
      pageEl.remove();
    }
  });

  // Wire up sign-out
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', () => signOut());

  // Navigate to default page
  nav(user.defaultPage);
}

// Expose to window for onclick handlers
window._nav = nav;
window._toggleExpenses = toggleExpenses;

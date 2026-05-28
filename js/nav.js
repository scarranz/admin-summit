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

  // If only office is allowed (Deborah), hide Expenses parent and show office directly
  if (user.allowedPages.length === 1 && user.allowedPages[0] === 'office') {
    const navSection = document.querySelector('.nav-section');
    if (navSection) navSection.style.display = 'none';
    // The office nav-child is already shown via data-page
  }

  // Wire up sign-out
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', () => signOut());

  // Navigate to default page
  nav(user.defaultPage);
}

// Expose to window for onclick handlers
window._nav = nav;
window._toggleExpenses = toggleExpenses;

/* =====================================================
   BusConnect - Auth & Utilities
   ===================================================== */

const API = '/api';

// ─── TOKEN MANAGEMENT ─────────────────────────────────
const getToken = () => localStorage.getItem('busconnect_token');
const getUser = () => { try { return JSON.parse(localStorage.getItem('busconnect_user')); } catch { return null; } };
const setAuth = (token, user) => {
  localStorage.setItem('busconnect_token', token);
  localStorage.setItem('busconnect_user', JSON.stringify(user));
};
const clearAuth = () => {
  localStorage.removeItem('busconnect_token');
  localStorage.removeItem('busconnect_user');
};

// ─── API HELPER ───────────────────────────────────────
async function apiCall(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}), ...options.headers };
  const res = await fetch(API + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

// ─── LOGOUT ───────────────────────────────────────────
function logout() {
  clearAuth();
  window.location.href = '/index.html';
}

// ─── TOAST NOTIFICATION ───────────────────────────────
let toastContainer;
function showToast(msg, type = 'info', duration = 3500) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${msg}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ─── SCROLL NAVBAR ───────────────────────────────────
window.addEventListener('scroll', () => {
  document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 20);
});

// ─── UPDATE NAV BASED ON AUTH ─────────────────────────
function updateNav() {
  const user = getUser();
  const guestNav = document.getElementById('guestNav');
  const userNav = document.getElementById('userNav');
  const navWallet = document.getElementById('navWallet');
  const navBookings = document.getElementById('navBookings');
  const navProfile = document.getElementById('navProfile');

  if (user && getToken()) {
    if (guestNav) guestNav.style.display = 'none';
    if (userNav) userNav.style.display = 'flex';
    if (navWallet) navWallet.style.display = '';
    if (navBookings) navBookings.style.display = '';
    if (navProfile) navProfile.style.display = '';

    // Fetch wallet balance
    apiCall('/wallet/balance').then(w => {
      const badge = document.getElementById('navBalance');
      if (badge) badge.textContent = `₹${parseFloat(w.balance).toLocaleString('en-IN')}`;
    }).catch(() => {});
  }
}

// ─── FORMAT CURRENCY ──────────────────────────────────
const fmtINR = (n) => `₹${parseFloat(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ─── FORMAT DATE ──────────────────────────────────────
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

// ─── REQUIRE AUTH ─────────────────────────────────────
function requireAuth() {
  if (!getToken() || !getUser()) {
    showToast('Please login to continue', 'warn');
    setTimeout(() => window.location.href = '/pages/login.html', 1000);
    return false;
  }
  return true;
}

// ─── PAGINATION ───────────────────────────────────────
function renderPagination(container, page, total, limit, onPage) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) { container.innerHTML = ''; return; }
  let html = '<div style="display:flex;gap:8px;justify-content:center;margin-top:24px;">';
  for (let i = 1; i <= pages; i++) {
    html += `<button onclick="(${onPage.toString()})(${i})"
      style="padding:8px 14px;border-radius:8px;border:2px solid ${i===page?'var(--blue)':'var(--border)'};
      background:${i===page?'var(--blue)':'white'};color:${i===page?'white':'var(--text)'};cursor:pointer;font-weight:600;">${i}</button>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

// ─── DURATION FORMATTER ───────────────────────────────
function fmtDuration(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Init
document.addEventListener('DOMContentLoaded', updateNav);

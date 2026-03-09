// ─── BusConnect Operator UI – app.js ────────────────────────
const API = window.location.hostname === 'localhost' ? 'http://localhost:8080/api' : '/api';

// ── Auth helpers (also defined in auth.js, included for standalone use) ───────
const getToken  = () => localStorage.getItem('op_token');
const getOperator = () => { try { return JSON.parse(localStorage.getItem('op_user')); } catch { return null; } };
const setAuth   = (token, user) => { localStorage.setItem('op_token', token); localStorage.setItem('op_user', JSON.stringify(user)); };
const clearAuth = () => { localStorage.removeItem('op_token'); localStorage.removeItem('op_user'); };

// ── API wrapper ────────────────────────────────────────────────────────────────
async function apiCall(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(API + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  if (res.status === 401) { clearAuth(); window.location.href = '/operator-ui/pages/login.html'; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Auth guard ─────────────────────────────────────────────────────────────────
function requireAuth() {
  const op = getOperator();
  if (!op || !getToken()) { window.location.href = '/operator-ui/pages/login.html'; return false; }
  const sidebarUser = document.getElementById('sidebarUser');
  if (sidebarUser) sidebarUser.innerHTML = `<strong>${op.company_name || op.name}</strong><br><small>${op.email}</small>`;
  return true;
}

function logout() { clearAuth(); window.location.href = '/operator-ui/pages/login.html'; }

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtINR = (v) => `₹${parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';

// ── Toast notification ─────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(container);
  }
  const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb', warning: '#d97706' };
  const toast = document.createElement('div');
  toast.style.cssText = `background:${colors[type]||colors.info};color:white;padding:12px 20px;border-radius:10px;
    box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:14px;font-weight:500;max-width:320px;
    animation:slideIn 0.3s ease;`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ── Modal helpers ──────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); });

// ── Pagination builder ─────────────────────────────────────────────────────────
function buildPagination(containerId, total, page, limit, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  let html = '<div class="pagination">';
  if (page > 1) html += `<button onclick="${onPageChange}(${page-1})">‹ Prev</button>`;
  for (let i = Math.max(1,page-2); i <= Math.min(totalPages,page+2); i++) {
    html += `<button class="${i===page?'active':''}" onclick="${onPageChange}(${i})">${i}</button>`;
  }
  if (page < totalPages) html += `<button onclick="${onPageChange}(${page+1})">Next ›</button>`;
  html += `<span class="page-info">Page ${page} of ${totalPages} (${total} total)</span></div>`;
  container.innerHTML = html;
}

// ── Seat map renderer ──────────────────────────────────────────────────────────
function renderSeatMap(containerId, totalSeats, layout, bookedSeats = [], selectedSeats = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const cols = layout === '2+2' ? 4 : layout === '2+1' ? 3 : layout === '1+1' ? 2 : 4;
  let html = '<div class="seat-map"><div class="seat-legend">';
  html += '<span class="seat available"></span> Available ';
  html += '<span class="seat booked"></span> Booked ';
  html += '<span class="seat selected"></span> Selected </div>';
  html += '<div class="driver-area">🚌 Driver</div><div class="seats-grid">';
  
  for (let i = 1; i <= totalSeats; i++) {
    const isBooked = bookedSeats.includes(String(i)) || bookedSeats.includes(i);
    const isSelected = selectedSeats.includes(String(i)) || selectedSeats.includes(i);
    const cls = isBooked ? 'booked' : isSelected ? 'selected' : 'available';
    html += `<div class="seat ${cls}" data-seat="${i}" ${!isBooked ? 'onclick="toggleSeat(this)"' : 'title="Already booked"'}>${i}</div>`;
    if (layout === '2+2' && i % 2 === 0 && i % cols !== 0) html += '<div class="aisle"></div>';
  }
  html += '</div></div>';
  container.innerHTML = html;
}

// ── Status badge helper ────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    CONFIRMED: 'badge-green', PENDING: 'badge-orange', CANCELLED: 'badge-red',
    COMPLETED: 'badge-blue', PAYMENT_FAILED: 'badge-red', INITIATED: 'badge-gray'
  };
  return `<span class="badge ${map[status]||'badge-gray'}">${status}</span>`;
}

// ── Add CSS animation ──────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn { from { transform: translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }
  .pagination { display:flex;gap:6px;align-items:center;margin-top:16px;flex-wrap:wrap; }
  .pagination button { padding:6px 12px;border:1px solid #e2e8f0;background:white;border-radius:6px;cursor:pointer;font-size:13px; }
  .pagination button.active { background:#1A56DB;color:white;border-color:#1A56DB; }
  .pagination button:hover:not(.active) { background:#f8fafc; }
  .page-info { font-size:12px;color:#64748b;margin-left:8px; }
  .seat-map { padding:16px; }
  .seat-legend { display:flex;gap:16px;margin-bottom:12px;font-size:13px;align-items:center; }
  .seats-grid { display:flex;flex-wrap:wrap;gap:6px;max-width:300px; }
  .seat { width:38px;height:38px;border-radius:8px 8px 4px 4px;display:flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:600;cursor:pointer;border:2px solid transparent;transition:all 0.2s; }
  .seat.available { background:#e8f5e9;border-color:#4caf50;color:#2e7d32; }
  .seat.available:hover { background:#4caf50;color:white; }
  .seat.booked { background:#ffebee;border-color:#ef9a9a;color:#c62828;cursor:not-allowed; }
  .seat.selected { background:#1565c0;border-color:#0d47a1;color:white; }
  .aisle { width:16px; }
  .driver-area { background:#f1f5f9;border-radius:8px;padding:8px;text-align:center;margin-bottom:12px;font-size:13px; }
  .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center; }
  .modal-overlay.open { display:flex; }
  .modal-box { background:white;border-radius:16px;padding:32px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto; }
`;
document.head.appendChild(style);

// ─── BusConnect Admin UI – app.js ────────────────────────────
const API = window.location.hostname === 'localhost' ? 'http://localhost:8080/api' : '/api';

// ── Auth helpers ───────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('admin_token');
const getAdmin  = () => { try { return JSON.parse(localStorage.getItem('admin_user')); } catch { return null; } };
const setAuth   = (token, user) => { localStorage.setItem('admin_token', token); localStorage.setItem('admin_user', JSON.stringify(user)); };
const clearAuth = () => { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); };

// ── API wrapper ────────────────────────────────────────────────────────────────
async function apiCall(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(API + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  if (res.status === 401) { clearAuth(); window.location.href = '/admin-ui/index.html'; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Auth guard ─────────────────────────────────────────────────────────────────
function requireAuth() {
  const admin = getAdmin();
  if (!admin || !getToken()) { window.location.href = '/admin-ui/index.html'; return false; }
  const sidebarUser = document.getElementById('sidebarUser');
  if (sidebarUser) sidebarUser.innerHTML = `<strong>${admin.name}</strong><br><small>${admin.email}</small>`;
  return true;
}

function logout() { clearAuth(); window.location.href = '/admin-ui/index.html'; }

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtINR      = (v) => `₹${parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtCredits  = (v) => `${parseFloat(v || 0).toLocaleString('en-IN')} credits`;
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtDate     = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtNum      = (n) => parseFloat(n || 0).toLocaleString('en-IN');

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
    box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:14px;font-weight:500;max-width:340px;
    animation:slideIn 0.3s ease;`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transition='opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Modal helpers ──────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); });

// ── Status badge helper ────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    CONFIRMED:'badge-green', PENDING:'badge-orange', CANCELLED:'badge-red',
    COMPLETED:'badge-blue', PAYMENT_FAILED:'badge-red', INITIATED:'badge-gray',
    true:'badge-green', false:'badge-red'
  };
  return `<span class="badge ${map[status]||'badge-gray'}">${status}</span>`;
}

// ── Confirm dialog ─────────────────────────────────────────────────────────────
function confirmAction(msg, onConfirm) {
  if (window.confirm(msg)) onConfirm();
}

// ── Pagination builder ─────────────────────────────────────────────────────────
function buildPagination(containerId, total, page, limit, callbackName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  let html = '<div class="pagination">';
  if (page > 1) html += `<button onclick="${callbackName}(${page-1})">‹ Prev</button>`;
  const start = Math.max(1,page-2), end = Math.min(totalPages,page+2);
  for (let i = start; i <= end; i++) {
    html += `<button class="${i===page?'active':''}" onclick="${callbackName}(${i})">${i}</button>`;
  }
  if (page < totalPages) html += `<button onclick="${callbackName}(${page+1})">Next ›</button>`;
  html += `<span class="page-info">Page ${page} of ${totalPages} (${total} total)</span></div>`;
  container.innerHTML = html;
}

// ── Date range quick select ────────────────────────────────────────────────────
function setDateRange(fromId, toId, days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  document.getElementById(fromId).value = from.toISOString().split('T')[0];
  document.getElementById(toId).value   = to.toISOString().split('T')[0];
}

// ── Simple chart renderer (canvas-based bar chart) ─────────────────────────────
function renderBarChart(canvasId, labels, data, title = '', color = '#1A56DB') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pad = { top:40, right:20, bottom:60, left:70 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxVal = Math.max(...data, 1);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = '#1e293b'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(title, W/2, 24);

  // Y-axis grid lines
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + chartH - (i / 5) * chartH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtNum(Math.round((i / 5) * maxVal)), pad.left - 8, y + 4);
  }

  // Bars
  const barW = Math.min(40, (chartW / labels.length) - 8);
  labels.forEach((label, i) => {
    const x = pad.left + (i + 0.5) * (chartW / labels.length) - barW / 2;
    const barH = (data[i] / maxVal) * chartH;
    const y = pad.top + chartH - barH;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barW, barH, [4,4,0,0]) : ctx.rect(x, y, barW, barH);
    ctx.fill();

    // X label
    ctx.fillStyle = '#475569'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    const lbl = label.length > 8 ? label.substring(0,8) + '…' : label;
    ctx.fillText(lbl, x + barW/2, pad.top + chartH + 16);
  });

  // Axes
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + chartH); ctx.lineTo(pad.left + chartW, pad.top + chartH); ctx.stroke();
}

// ── Add shared CSS ─────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn { from { transform:translateX(100%);opacity:0; } to { transform:translateX(0);opacity:1; } }
  .pagination { display:flex;gap:6px;align-items:center;margin-top:16px;flex-wrap:wrap; }
  .pagination button { padding:6px 12px;border:1px solid #e2e8f0;background:white;border-radius:6px;cursor:pointer;font-size:13px; }
  .pagination button.active { background:#1A56DB;color:white;border-color:#1A56DB; }
  .pagination button:hover:not(.active) { background:#f8fafc; }
  .page-info { font-size:12px;color:#64748b;margin-left:8px; }
  .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center; }
  .modal-overlay.open { display:flex; }
  .modal-box { background:white;border-radius:16px;padding:32px;max-width:560px;width:90%;max-height:85vh;overflow-y:auto; }
  .filter-bar { display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;align-items:flex-end; }
  .filter-bar input, .filter-bar select { padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;min-width:140px; }
  .filter-bar button { padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500; }
  .btn-apply { background:#1A56DB;color:white; }
  .btn-reset { background:#f1f5f9;color:#475569; }
`;
document.head.appendChild(style);

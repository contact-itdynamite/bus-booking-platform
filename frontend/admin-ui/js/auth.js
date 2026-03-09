const API = '/api';
const getToken = () => localStorage.getItem('admin_token');
const getAdmin = () => { try { return JSON.parse(localStorage.getItem('admin_user')); } catch { return null; } };
const setAuth = (token, user) => { localStorage.setItem('admin_token', token); localStorage.setItem('admin_user', JSON.stringify(user)); };
const clearAuth = () => { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); };

async function apiCall(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}), ...options.headers };
  const res = await fetch(API + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function logout() { clearAuth(); window.location.href = '/admin-ui/index.html'; }

function requireAuth() {
  if (!getToken() || !getAdmin()) { window.location.href = '/admin-ui/index.html'; return false; }
  return true;
}

let toastContainer;
function showToast(msg, type='info', dur=3500) {
  if (!toastContainer) { toastContainer=document.createElement('div'); toastContainer.className='toast-container'; document.body.appendChild(toastContainer); }
  const icons={success:'✅',error:'❌',warn:'⚠️',info:'ℹ️'};
  const t=document.createElement('div'); t.className=`toast ${type}`; t.innerHTML=`<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  toastContainer.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, dur);
}

const fmtINR = n => `₹${parseFloat(n||0).toLocaleString('en-IN',{minimumFractionDigits:0})}`;
const fmtDate = d => new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const fmtTime = d => new Date(d).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
const fmtDateTime = d => `${fmtDate(d)} ${fmtTime(d)}`;

function setSidebarAdmin() {
  const a = getAdmin();
  if (a) { const el=document.getElementById('adminName'); if(el) el.textContent=a.name||'Admin'; }
}
document.addEventListener('DOMContentLoaded', setSidebarAdmin);

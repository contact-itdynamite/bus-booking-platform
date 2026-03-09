const API = '/api';
const getToken = () => localStorage.getItem('op_token');
const getOperator = () => { try { return JSON.parse(localStorage.getItem('op_user')); } catch { return null; } };
const setAuth = (token, user) => { localStorage.setItem('op_token', token); localStorage.setItem('op_user', JSON.stringify(user)); };
const clearAuth = () => { localStorage.removeItem('op_token'); localStorage.removeItem('op_user'); };

async function apiCall(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}), ...options.headers };
  const res = await fetch(API + path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function logout() { clearAuth(); window.location.href = '/operator-ui/pages/login.html'; }

function requireAuth() {
  const op = getOperator();
  if (!op || !getToken()) { window.location.href = '/operator-ui/pages/login.html'; return false; }
  return true;
}

function setSidebarUser() {
  const op = getOperator();
  if (op) {
    const el = document.getElementById('sidebarUser');
    if (el) el.innerHTML = `<strong>${op.name}</strong>${op.company_name}`;
  }
}

let toastContainer;
function showToast(msg, type='info', dur=3500) {
  if (!toastContainer) { toastContainer=document.createElement('div'); toastContainer.className='toast-container'; document.body.appendChild(toastContainer); }
  const icons={success:'✅',error:'❌',warn:'⚠️',info:'ℹ️'};
  const t=document.createElement('div'); t.className=`toast ${type}`; t.innerHTML=`<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  toastContainer.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),300); },dur);
}

const fmtINR = n => `₹${parseFloat(n).toLocaleString('en-IN',{minimumFractionDigits:0})}`;
const fmtDate = d => new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const fmtTime = d => new Date(d).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
const fmtDateTime = d => `${fmtDate(d)} ${fmtTime(d)}`;

document.addEventListener('DOMContentLoaded', setSidebarUser);

/* =====================================================
   BusConnect - App.js (Home page logic)
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Show promo popup if user is logged in and hasn't seen it
  const user = getUser();
  if (user && !sessionStorage.getItem('promoShown')) {
    setTimeout(() => showPromoPopup(), 3000);
  }
});

async function showPromoPopup() {
  try {
    const promos = await apiCall('/promos/user/available');
    if (!promos.length) return;
    const promo = promos[0];
    sessionStorage.setItem('promoShown', '1');
    const banner = document.createElement('div');
    banner.className = 'promo-banner';
    banner.innerHTML = `
      <span class="close" onclick="this.parentElement.remove()">×</span>
      <h4>🎉 Promo Available!</h4>
      <p>${promo.description || 'Use this code for a discount'}</p>
      <div class="promo-code-display">${promo.code}</div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 8000);
  } catch (e) {}
}

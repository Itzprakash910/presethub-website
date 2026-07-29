// ===== CONFIGURATION =====
const API_URL = window.location.origin + '/api';

// ===== GLOBALS =====
let currentUser = null;
let token = localStorage.getItem('token');
let allPresets = [];
let wishlist = [];
let currentPage = 1;
let totalPages = 1;
let currentFilters = {};
let isOnline = navigator.onLine;
let subscriptionData = {};
let notifications = [];
let viewedPresets = new Set();

// ===== DOM REFS =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const authSection = $('#authSection');
const userSection = $('#userSection');
const userAvatar = $('#userAvatar');
const loginBtn = $('#loginBtn');
const signupBtn = $('#signupBtn');
const logoutBtn = $('#logoutBtn');
const presetGrid = $('#presetGrid');
const latestGrid = $('#latestGrid');
const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const filterCategory = $('#filterCategory');
const filterPrice = $('#filterPrice');
const filterSort = $('#filterSort');
const wishlistBtn = $('#wishlistBtn');
const exploreBtn = $('#exploreBtn');
const uploadHeroBtn = $('#uploadHeroBtn');
const featuredDownloadBtn = $('#featuredDownloadBtn');
const searchSuggestions = $('#searchSuggestions');
const themeToggle = $('#themeToggle');
const loadMoreBtn = $('#loadMoreBtn');
const offlineIndicator = $('#offlineIndicator');
const userDropdown = document.getElementById('userDropdown');

// ============================================================
// ===== OFFLINE QUEUE UTILITY =====
// ============================================================
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PresetHubOffline', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToQueue(action, url, options = {}) {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const item = {
      action: action,
      url: url,
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body || null,
      data: options.data || null,
      timestamp: Date.now()
    };
    await new Promise((resolve, reject) => {
      const request = store.add(item);
      request.onsuccess = resolve;
      request.onerror = reject;
    });
    console.log(`📦 Added to queue: ${action} (${url})`);
    
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register('presethub-sync');
        console.log('🔄 Sync registered!');
      } catch (err) {
        console.warn('Background Sync not available, will retry on next load.', err);
      }
    }
    
    showToast(`⏳ "${action}" saved offline. Will sync when online.`, 'warning');
    return true;
  } catch (err) {
    console.error('❌ Failed to add to queue:', err);
    showToast('❌ Failed to save offline. Please try again later.', 'error');
    return false;
  }
}

// ============================================================
// ===== ONLINE / OFFLINE INDICATOR =====
// ============================================================
window.addEventListener('online', async () => {
  isOnline = true;
  if (offlineIndicator) offlineIndicator.style.display = 'none';
  showToast('🔄 Connection restored! Syncing data...', 'info');
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if ('SyncManager' in window) {
        await registration.sync.register('presethub-sync');
      }
    } catch (err) {
      console.warn('Sync registration failed:', err);
    }
  }
});

window.addEventListener('offline', () => {
  isOnline = false;
  if (offlineIndicator) offlineIndicator.style.display = 'inline-block';
  showToast('📴 You are offline. Actions will be queued.', 'warning');
});

navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data.type === 'SYNC_SUCCESS') {
    showToast(`✅ "${event.data.action}" synced successfully!`, 'success');
    if (event.data.action === 'review') {
      loadPresets();
    } else if (event.data.action === 'wishlist') {
      fetchWishlist();
      loadPresets();
    } else if (event.data.action === 'upload') {
      loadPresets();
      loadLatestPresets();
    } else if (event.data.action === 'download' || event.data.action === 'follow' || event.data.action === 'order') {
      fetchUserProfile();
    }
  }
});

// ============================================================
// ===== TOAST SYSTEM =====
// ============================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
window.showToast = showToast;

// ============================================================
// ===== DARK MODE =====
// ============================================================
const currentTheme = localStorage.getItem('theme') || 'light';
if (currentTheme === 'dark') {
  document.body.classList.add('dark');
  themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
}
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// ============================================================
// ===== AUTH =====
// ============================================================
if (token) {
  fetchUserProfile();
}

async function fetchUserProfile() {
  try {
    const res = await fetch(`${API_URL}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const user = await res.json();
      currentUser = user;
      showLoggedInUI(user);
    } else {
      logout();
    }
  } catch (err) {
    console.error('Profile fetch error', err);
  }
}

function showLoggedInUI(user) {
  authSection.style.display = 'none';
  userSection.style.display = 'flex';
  userAvatar.textContent = user.name.charAt(0).toUpperCase();
  if (user.avatar) {
    userAvatar.style.backgroundImage = `url(${user.avatar})`;
    userAvatar.style.backgroundSize = 'cover';
    userAvatar.textContent = '';
  }
  fetchWishlist();
  fetchSubscription();
  fetchNotifications();
  if (userDropdown) userDropdown.style.display = 'none';
  requestNotificationPermission();
}

function logout() {
  localStorage.removeItem('token');
  token = null;
  currentUser = null;
  authSection.style.display = 'flex';
  userSection.style.display = 'none';
  wishlist = [];
  notifications = [];
  subscriptionData = {};
  updateWishlistUI();
  if (userDropdown) userDropdown.style.display = 'none';
  showToast('लॉगआउट हो गया', 'info');
}

loginBtn.addEventListener('click', () => openAuthModal('login'));
signupBtn.addEventListener('click', () => openAuthModal('signup'));
logoutBtn.addEventListener('click', logout);

// ============================================================
// ===== USER DROPDOWN TOGGLE =====
// ============================================================
userAvatar.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentUser) return;
  if (userDropdown.style.display === 'block') {
    userDropdown.style.display = 'none';
  } else {
    userDropdown.style.display = 'block';
  }
});

document.addEventListener('click', () => {
  if (userDropdown) userDropdown.style.display = 'none';
});

// ============================================================
// ===== MY PRESETS (Web) =====
// ============================================================
window.showMyPresets = async function() {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/users/${currentUser.id}/presets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to load presets');
    const presets = await res.json();
    if (!presets.length) {
      showToast('आपने अभी तक कोई प्रीसेट अपलोड नहीं किया।', 'info');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <button class="close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        <h2>📦 मेरे प्रीसेट</h2>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
          ${presets.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg, #f8f6f2);border-radius:12px;">
              <div>
                <strong>${p.name}</strong> – ${p.category}
                <span style="font-size:0.8rem;color:#888;">(${p.status})</span>
              </div>
              <button class="btn btn-sm btn-primary" onclick="window.openPresetModal('${p.id}')">देखें</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());
  } catch (err) {
    console.error(err);
    showToast('प्रीसेट लोड नहीं हुए', 'error');
  }
};

// ============================================================
// ===== MY DOWNLOADS =====
// ============================================================
window.showMyDownloads = async function() {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/users/me/downloads`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to load downloads');
    const presets = await res.json();
    if (!presets.length) {
      showToast('आपने अभी तक कोई प्रीसेट डाउनलोड नहीं किया।', 'info');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <button class="close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
        <h2>⬇️ मेरे डाउनलोड</h2>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
          ${presets.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg, #f8f6f2);border-radius:12px;">
              <div>
                <strong>${p.name}</strong> – ${p.author}
              </div>
              <button class="btn btn-sm btn-primary" onclick="window.openPresetModal('${p.id}')">देखें</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());
  } catch (err) {
    console.error(err);
    showToast('डाउनलोड लोड नहीं हुए', 'error');
  }
};

// ============================================================
// ===== AUTH MODAL =====
// ============================================================
function openAuthModal(mode) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref') || '';
  const refInput = ref ? `<input type="hidden" id="authRef" value="${ref}" />` : '';
  modal.innerHTML = `
    <div class="modal" style="max-width:450px;">
      <button class="close">&times;</button>
      <h2>${mode === 'login' ? 'लॉग इन' : 'साइन अप'}</h2>
      <form id="authForm">
        ${mode === 'signup' ? `<div class="form-group"><input type="text" id="authName" placeholder="आपका नाम" required /></div>` : ''}
        <div class="form-group"><input type="email" id="authEmail" placeholder="ईमेल" required /></div>
        <div class="form-group"><input type="password" id="authPassword" placeholder="पासवर्ड (6+ अक्षर)" required minlength="6" /></div>
        ${refInput}
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">
          ${mode === 'login' ? 'लॉग इन करें' : 'साइन अप करें'}
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.close').addEventListener('click', () => modal.remove());

  modal.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const name = document.getElementById('authName')?.value;
    const refCode = document.getElementById('authRef')?.value || '';
    let url = `${API_URL}/auth/${mode}`;
    if (mode === 'signup' && refCode) {
      url += `?ref=${encodeURIComponent(refCode)}`;
    }
    const payload = { email, password };
    if (mode === 'signup') payload.name = name;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('token', data.token);
        token = data.token;
        currentUser = data.user;
        showLoggedInUI(data.user);
        modal.remove();
        loadPresets();
        loadLatestPresets();
        loadTopCreators();
        showToast(mode === 'login' ? 'स्वागत है! 🎉' : 'अकाउंट बन गया! 🎉', 'success');
        if (window.history && window.history.replaceState) {
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        }
      } else {
        showToast(data.error || 'कुछ गलत हो गया', 'error');
      }
    } catch (err) {
      showToast('सर्वर से कनेक्ट नहीं हो पाया', 'error');
    }
  });
}
window.openAuthModal = openAuthModal;

// ============================================================
// ===== WISHLIST =====
// ============================================================
async function fetchWishlist() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_URL}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const user = await res.json();
      wishlist = user.wishlist || [];
      updateWishlistUI();
    }
  } catch (err) { console.error(err); }
}

async function toggleWishlist(presetId) {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  const url = `${API_URL}/users/me/wishlist/${presetId}`;
  const options = {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  };
  try {
    if (!navigator.onLine) {
      await addToQueue('wishlist', url, options);
      const index = wishlist.indexOf(presetId);
      if (index === -1) wishlist.push(presetId);
      else wishlist.splice(index, 1);
      updateWishlistUI();
      renderPresets(allPresets);
      loadLatestPresets();
      return;
    }
    const res = await fetch(url, options);
    if (res.ok) {
      const data = await res.json();
      wishlist = data.wishlist || [];
      updateWishlistUI();
      renderPresets(allPresets);
      loadLatestPresets();
      showToast(wishlist.includes(presetId) ? '❤️ पसंद में जोड़ा' : '💔 पसंद से हटाया', 'info');
    } else {
      showToast('❌ कृपया बाद में प्रयास करें', 'error');
    }
  } catch (err) {
    await addToQueue('wishlist', url, options);
  }
}
window.toggleWishlist = toggleWishlist;

function updateWishlistUI() {
  const count = wishlist.length;
  wishlistBtn.innerHTML = `<i class="fa${count > 0 ? 's' : 'r'} fa-heart"></i>${count > 0 ? count : ''}`;
}

// ============================================================
// ===== WISHLIST MODAL =====
// ============================================================
async function showWishlist() {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  if (wishlist.length === 0) {
    showToast('आपकी विशलिस्ट खाली है।', 'info');
    return;
  }
  const presetPromises = wishlist.map(id =>
    fetch(`${API_URL}/presets/${id}`).then(r => r.ok ? r.json() : null)
  );
  const presets = (await Promise.all(presetPromises)).filter(Boolean);
  if (presets.length === 0) {
    showToast('कोई प्रीसेट नहीं मिला।', 'info');
    return;
  }
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:600px;">
      <button class="close">&times;</button>
      <h2>❤️ आपकी विशलिस्ट</h2>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
        ${presets.map(p => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg, #f8f6f2);border-radius:12px;">
            <div>
              <strong>${p.name}</strong> – ${p.author}
              <span style="margin-left:8px;font-size:0.8rem;color:#6b6b6b;">${p.category}</span>
            </div>
            <button class="btn btn-sm btn-primary" onclick="window.openPresetModal('${p.id}')">देखें</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());
}
wishlistBtn.addEventListener('click', showWishlist);

// ============================================================
// ===== PRESETS CRUD (with engagement stats) =====
// ============================================================
function renderPresetsToContainer(presets, container) {
  if (!container) return;
  if (!presets || presets.length === 0) {
    container.innerHTML = `<div class="no-results" style="grid-column:1/-1;text-align:center;padding:40px;color:#7a7a7a;">😕 कोई प्रीसेट नहीं मिला</div>`;
    return;
  }
  container.innerHTML = presets.map(p => {
    const isLiked = wishlist.includes(p.id);
    const priceDisplay = p.price === 0 ?
      `<span class="price free">मुफ्त</span>` :
      `<span class="price">₹${p.price}</span>`;
    const stars = '★'.repeat(Math.floor(p.avgRating || 0)) + (p.avgRating % 1 >= 0.5 ? '½' : '');
    const previewImg = p.previewImage ? 
      `<img src="${p.previewImage}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">` :
      `<svg viewBox="0 0 270 200" style="background:#d9d0c4;width:100%;height:100%;">
        <rect x="20" y="20" width="80" height="70" rx="10" fill="#b8aa98" />
        <rect x="120" y="20" width="80" height="70" rx="10" fill="#c4b5a2" />
        <rect x="20" y="110" width="80" height="70" rx="10" fill="#a89682" />
        <rect x="120" y="110" width="80" height="70" rx="10" fill="#d4c5b2" />
        <text x="60" y="180" font-family="Inter" font-weight="600" font-size="12" fill="#4a3f35">📷 ${p.name}</text>
      </svg>`;
    return `
      <div class="preset-card" data-id="${p.id}">
        <div class="thumb">
          ${previewImg}
          <div class="overlay">
            <button class="btn btn-sm preview-btn" data-id="${p.id}"><i class="fas fa-eye"></i> प्रीव्यू</button>
            <button class="btn btn-sm wishlist-toggle" data-id="${p.id}" style="background:#fff;color:#e74c3c;">
              <i class="fa${isLiked ? 's' : 'r'} fa-heart"></i>
            </button>
          </div>
        </div>
        <div class="info">
          <span class="tag">${p.category || 'General'}</span>
          <h3>${p.name}</h3>
          <div class="author" style="cursor:pointer;color:#d4a373;" onclick="event.stopPropagation(); window.openProfile('${p.authorId}')">
            ${p.author}
            <span style="font-size:0.7rem;color:#888;margin-left:6px;"><i class="fas fa-users"></i> ${p.authorFollowers || 0}</span>
          </div>
          <div class="meta" style="flex-wrap:wrap;gap:4px;">
            ${priceDisplay}
            <span class="rating">${stars} ${p.avgRating ? p.avgRating.toFixed(1) : '0'}</span>
          </div>
          <div style="display:flex;gap:10px;font-size:0.75rem;color:#888;margin-top:6px;flex-wrap:wrap;">
            <span><i class="fas fa-eye"></i> ${p.views || 0}</span>
            <span><i class="fas fa-heart" style="color:#e74c3c;"></i> ${p.likes?.length || 0}</span>
            <span><i class="fas fa-share-alt"></i> ${p.shares || 0}</span>
            <span><i class="fas fa-comment"></i> ${p.reviews?.length || 0}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// ===== EVENT DELEGATION FOR PRESET GRID =====
// ============================================================
presetGrid.addEventListener('click', function(e) {
  const card = e.target.closest('.preset-card');
  if (!card) return;
  const id = card.dataset.id;
  const previewBtn = e.target.closest('.preview-btn');
  if (previewBtn) {
    e.stopPropagation();
    openPresetModal(id);
    return;
  }
  const wishBtn = e.target.closest('.wishlist-toggle');
  if (wishBtn) {
    e.stopPropagation();
    toggleWishlist(id);
    return;
  }
  if (!e.target.closest('.author')) {
    openPresetModal(id);
  }
});

loadMoreBtn.addEventListener('click', () => {
  loadPresets(currentPage + 1, true);
});

// ============================================================
// ===== LOAD PRESETS (with follower counts enrichment) =====
// ============================================================
async function loadPresets(page = 1, append = false) {
  try {
    const params = new URLSearchParams();
    const q = searchInput.value.trim();
    if (q) params.append('q', q);
    const cat = filterCategory.value;
    if (cat) params.append('category', cat);
    const price = filterPrice.value;
    if (price) params.append('price', price);
    const sort = filterSort.value;
    if (sort) params.append('sort', sort);
    params.append('page', page);
    params.append('limit', 20);
    
    const url = `${API_URL}/presets?${params.toString()}`;
    const res = await fetch(url);
    
    if (res.ok) {
      const data = await res.json();
      let userMap = {};
      try {
        const usersRes = await fetch(`${API_URL}/users?limit=100`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (usersRes.ok) {
          const users = await usersRes.json();
          users.forEach(u => {
            userMap[u.id] = { followers: u.followers?.length || 0, name: u.name };
          });
        }
      } catch (e) { console.warn('Could not load follower counts', e); }
      data.presets.forEach(p => {
        p.authorFollowers = userMap[p.authorId]?.followers || 0;
      });
      allPresets = data.presets || [];
      totalPages = data.totalPages || 1;
      currentPage = data.page || 1;
      
      if (append) {
        const existing = presetGrid.innerHTML;
        const tempDiv = document.createElement('div');
        renderPresetsToContainer(allPresets, tempDiv);
        presetGrid.innerHTML = existing + tempDiv.innerHTML;
      } else {
        renderPresetsToContainer(allPresets, presetGrid);
      }
      
      if (currentPage < totalPages) {
        loadMoreBtn.style.display = 'inline-flex';
        loadMoreBtn.textContent = `और लोड करें (${currentPage}/${totalPages})`;
      } else {
        loadMoreBtn.style.display = 'none';
      }
      return;
    }
    
    throw new Error('Network or server error');
    
  } catch (err) {
    console.warn('⚠️ Load presets failed, trying cache:', err);
    try {
      const params = new URLSearchParams();
      const q = searchInput.value.trim();
      if (q) params.append('q', q);
      const cat = filterCategory.value;
      if (cat) params.append('category', cat);
      const price = filterPrice.value;
      if (price) params.append('price', price);
      const sort = filterSort.value;
      if (sort) params.append('sort', sort);
      params.append('page', page);
      params.append('limit', 20);
      const url = `${API_URL}/presets?${params.toString()}`;
      
      const cache = await caches.open('presethub-api-v1');
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        const data = await cachedResponse.json();
        allPresets = data.presets || [];
        totalPages = data.totalPages || 1;
        currentPage = data.page || 1;
        renderPresetsToContainer(allPresets, presetGrid);
        showToast('📦 Showing cached presets (offline)', 'info');
        return;
      }
      showToast('😕 No cached presets available offline.', 'error');
    } catch (cacheErr) {
      console.error('Cache error:', cacheErr);
      showToast('❌ Unable to load presets. Please check your connection.', 'error');
    }
  }
}

// ============================================================
// ===== LOAD LATEST PRESETS =====
// ============================================================
async function loadLatestPresets() {
  try {
    const res = await fetch(`${API_URL}/presets?sort=newest&limit=6`);
    const data = await res.json();
    const presets = data.presets || [];
    let userMap = {};
    try {
      const usersRes = await fetch(`${API_URL}/users?limit=100`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (usersRes.ok) {
        const users = await usersRes.json();
        users.forEach(u => {
          userMap[u.id] = { followers: u.followers?.length || 0, name: u.name };
        });
      }
    } catch (e) { console.warn('Could not load follower counts', e); }
    presets.forEach(p => {
      p.authorFollowers = userMap[p.authorId]?.followers || 0;
    });
    renderPresetsToContainer(presets, latestGrid);
  } catch (err) {
    console.warn('⚠️ Load latest failed, trying cache');
    try {
      const cache = await caches.open('presethub-api-v1');
      const cachedResponse = await cache.match(`${API_URL}/presets?sort=newest&limit=6`);
      if (cachedResponse) {
        const data = await cachedResponse.json();
        renderPresetsToContainer(data.presets || [], latestGrid);
        return;
      }
    } catch (cacheErr) {
      console.error('Latest cache error:', cacheErr);
    }
  }
}

// ============================================================
// ===== SMART SEARCH =====
// ============================================================
let searchTimeout = null;
searchInput.addEventListener('input', function() {
  const query = this.value.trim();
  if (query.length < 2) {
    searchSuggestions.style.display = 'none';
    return;
  }
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`${API_URL}/presets/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const suggestions = await res.json();
        if (suggestions.length === 0) {
          searchSuggestions.style.display = 'none';
          return;
        }
        searchSuggestions.innerHTML = suggestions.map(p => `
          <div class="suggestion-item" data-id="${p.id}">
            <strong>${p.name}</strong> — ${p.author}
            <span style="font-size:0.8rem;color:#6b6b6b;">${p.category}</span>
          </div>
        `).join('');
        searchSuggestions.style.display = 'block';
        searchSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            const id = item.dataset.id;
            searchInput.value = '';
            searchSuggestions.style.display = 'none';
            openPresetModal(id);
          });
        });
      }
    } catch (err) { console.error(err); }
  }, 300);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-search')) {
    searchSuggestions.style.display = 'none';
  }
});

// ============================================================
// ===== PRESET MODAL (with like, share, view, ad-impression) =====
// ============================================================
async function openPresetModal(presetId) {
  try {
    const res = await fetch(`${API_URL}/presets/${presetId}`);
    if (!res.ok) throw new Error('Preset not found');
    const preset = await res.json();
    const isLiked = wishlist.includes(preset.id);
    const isFree = preset.price === 0;

    if (!viewedPresets.has(presetId) && currentUser && preset.authorId !== currentUser.id) {
      viewedPresets.add(presetId);
      try {
        await fetch(`${API_URL}/presets/${presetId}/view`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      } catch (e) { console.warn('View tracking failed:', e); }
      try {
        await fetch(`${API_URL}/presets/${presetId}/ad-impression`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      } catch (e) { console.warn('Ad impression tracking failed:', e); }
    }

    const reviews = preset.reviews || [];
    const sortedReviews = [...reviews].sort((a, b) => (b.helpful || 0) - (a.helpful || 0) || new Date(b.createdAt) - new Date(a.createdAt));
    const topReviews = sortedReviews.slice(0, 5);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal">
        <button class="close">&times;</button>
        <div class="modal-grid">
          <div class="modal-preview">
            ${preset.previewImage ? `<img src="${preset.previewImage}" alt="${preset.name}" style="width:100%;height:auto;border-radius:16px;" onerror="this.style.display='none'">` :
              `<svg viewBox="0 0 300 200" style="width:100%;height:auto;background:#d9d0c4;border-radius:16px;">
                <rect x="20" y="20" width="100" height="80" rx="8" fill="#b8aa98" />
                <rect x="140" y="20" width="100" height="80" rx="8" fill="#c4b5a2" />
                <rect x="20" y="120" width="100" height="60" rx="8" fill="#a89682" />
                <rect x="140" y="120" width="100" height="60" rx="8" fill="#d4c5b2" />
                <text x="80" y="185" font-family="Inter" font-weight="600" font-size="14" fill="#4a3f35">${preset.name}</text>
              </svg>`
            }
          </div>
          <div class="modal-details">
            <h2>${preset.name}</h2>
            <div class="author" style="cursor:pointer;color:#d4a373;" onclick="window.openProfile('${preset.authorId}')">by <strong>${preset.author}</strong></div>
            <div class="desc">${preset.description || 'कोई विवरण नहीं'}</div>
            <div class="price-lg ${isFree ? 'free' : ''}">${isFree ? 'मुफ्त' : '₹' + preset.price}</div>
            <div class="actions">
              <button class="btn btn-primary download-btn" data-id="${preset.id}">
                <i class="fas fa-download"></i> ${isFree ? 'डाउनलोड करें' : 'खरीदें'}
              </button>
              <button class="btn btn-outline wishlist-btn" data-id="${preset.id}">
                <i class="fa${isLiked ? 's' : 'r'} fa-heart"></i> ${isLiked ? 'पसंद में' : 'पसंद करें'}
              </button>
              <button class="btn btn-outline like-btn" data-id="${preset.id}">
                <i class="fa${preset.likes && preset.likes.includes(currentUser?.id) ? 's' : 'r'} fa-heart"></i>
                <span class="like-count">${preset.likes?.length || 0}</span>
              </button>
              <button class="btn btn-outline share-btn" data-id="${preset.id}">
                <i class="fas fa-share-alt"></i> <span class="share-count">${preset.shares || 0}</span>
              </button>
            </div>
            <div class="meta-list">
              <span><i class="fas fa-eye"></i> ${preset.views || 0} views</span>
              <span><i class="fas fa-download"></i> ${preset.downloads || 0} downloads</span>
              <span><i class="fas fa-star" style="color:#f4a261;"></i> ${preset.avgRating ? preset.avgRating.toFixed(1) : '0'} (${preset.reviews?.length || 0})</span>
              <span><i class="fas fa-tag"></i> ${preset.tags?.join(', ') || '—'}</span>
            </div>
            <div style="margin-top:20px;border-top:1px solid var(--border, #eee);padding-top:16px;">
              <h4>⭐ समीक्षाएँ (${preset.reviews?.length || 0})</h4>
              <div id="reviewList">
                ${topReviews.length > 0 ? topReviews.map(r => `
                  <div style="padding:10px 0;border-bottom:1px solid var(--border, #f0ebe3);">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;">
                      <div>
                        <strong>${r.userName}</strong> 
                        <span style="color:#f4a261;">${'★'.repeat(r.rating)}</span>
                        <span style="color:#888;font-size:0.8rem;">${new Date(r.createdAt).toLocaleDateString()}</span>
                      </div>
                      <span style="font-size:0.8rem;color:#888;">
                        <i class="fas fa-thumbs-up" style="color:#d4a373;"></i> ${r.helpful || 0}
                      </span>
                    </div>
                    <p style="margin:4px 0 0;color:var(--text, #3a3a3a);">${r.comment}</p>
                  </div>
                `).join('') : '<p style="color:#888;">अभी कोई समीक्षा नहीं</p>'}
                ${preset.reviews && preset.reviews.length > 5 ? `<p style="color:#888;font-size:0.8rem;margin-top:6px;">... और ${preset.reviews.length - 5} समीक्षाएँ</p>` : ''}
              </div>
              ${currentUser ? `
                <form id="reviewForm" style="margin-top:12px;">
                  <div class="form-group">
                    <label>रेटिंग (1-5)</label>
                    <input type="number" id="reviewRating" min="1" max="5" required />
                  </div>
                  <div class="form-group">
                    <textarea id="reviewComment" placeholder="अपनी समीक्षा लिखें..." required></textarea>
                  </div>
                  <button type="submit" class="btn btn-sm btn-primary">समीक्षा भेजें</button>
                </form>
              ` : `<p style="color:#888;margin-top:12px;">समीक्षा देने के लिए <a href="#" onclick="openAuthModal('login');return false;">लॉग इन</a> करें</p>`}
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.close').addEventListener('click', () => modal.remove());

    modal.querySelector('.download-btn').addEventListener('click', async () => {
      if (!currentUser) {
        showToast('कृपया लॉग इन करें', 'warning');
        return;
      }
      await downloadPreset(preset.id);
    });

    modal.querySelector('.wishlist-btn').addEventListener('click', async () => {
      await toggleWishlist(preset.id);
      modal.remove();
      openPresetModal(preset.id);
    });

    modal.querySelector('.like-btn')?.addEventListener('click', async () => {
      if (!currentUser) { showToast('Please login', 'warning'); return; }
      const res = await fetch(`${API_URL}/presets/${preset.id}/like`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const likeSpan = modal.querySelector('.like-count');
        const icon = modal.querySelector('.like-btn i');
        icon.className = data.liked ? 'fas fa-heart' : 'far fa-heart';
        likeSpan.textContent = data.likes;
        await fetchNotifications();
      }
    });

    modal.querySelector('.share-btn')?.addEventListener('click', async () => {
      if (!currentUser) { showToast('Please login', 'warning'); return; }
      const res = await fetch(`${API_URL}/presets/${preset.id}/share`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        modal.querySelector('.share-count').textContent = data.shares;
        const shareLink = `${window.location.origin}/preset/${preset.id}`;
        if (navigator.share) {
          navigator.share({ title: preset.name, text: 'Check out this preset!', url: shareLink });
        } else {
          navigator.clipboard.writeText(shareLink).then(() => showToast('Link copied!', 'success'));
        }
      }
    });

    const reviewForm = modal.querySelector('#reviewForm');
    if (reviewForm) {
      reviewForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rating = document.getElementById('reviewRating').value;
        const comment = document.getElementById('reviewComment').value;
        await submitReview(preset.id, rating, comment);
      });
    }
  } catch (err) {
    console.error(err);
    showToast('प्रीसेट लोड नहीं हुआ', 'error');
  }
}
window.openPresetModal = openPresetModal;

// ============================================================
// ===== REVIEW SUBMIT =====
// ============================================================
async function submitReview(presetId, rating, comment) {
  const url = `${API_URL}/reviews/${presetId}`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ rating, comment })
  };
  try {
    if (!navigator.onLine) {
      await addToQueue('review', url, options);
      showToast('⏳ Review saved offline. Will sync when online.', 'info');
      return;
    }
    const res = await fetch(url, options);
    if (res.ok) {
      showToast('✅ समीक्षा सहेजी गई', 'success');
      const modal = document.querySelector('.modal-overlay.active');
      if (modal) {
        const id = modal.querySelector('.download-btn')?.dataset.id;
        if (id) {
          modal.remove();
          openPresetModal(id);
        }
      }
    } else {
      const err = await res.json();
      showToast(err.error || 'समीक्षा सबमिट नहीं हो पाई', 'error');
    }
  } catch (err) {
    await addToQueue('review', url, options);
  }
}

// ============================================================
// ===== DOWNLOAD (with ad modal 3s countdown) =====
// ============================================================
async function downloadPreset(presetId) {
  if (!currentUser) {
    showToast('कृपया लॉग इन करें', 'warning');
    return;
  }

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'ad-overlay';
    modal.innerHTML = `
      <div class="ad-modal">
        <h3>📢 Sponsored</h3>
        <div class="ad-content">
          <img src="https://via.placeholder.com/400x200/d4a373/ffffff?text=Your+Ad+Here" alt="Ad" style="max-width:100%;border-radius:12px;">
          <p style="margin-top:8px;color:#888;">Continue in <span class="timer">3</span>s</p>
        </div>
        <button class="skip-btn" disabled>Skip Ad</button>
      </div>
    `;
    document.body.appendChild(modal);

    let seconds = 3;
    const timerSpan = modal.querySelector('.timer');
    const skipBtn = modal.querySelector('.skip-btn');

    const interval = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(interval);
        timerSpan.textContent = '0';
        skipBtn.textContent = 'Download Now';
        skipBtn.classList.add('enabled');
        skipBtn.disabled = false;
        setTimeout(() => {
          skipBtn.click();
        }, 500);
      } else {
        timerSpan.textContent = seconds;
      }
    }, 1000);

    skipBtn.addEventListener('click', async () => {
      if (!skipBtn.classList.contains('enabled')) return;
      modal.remove();
      await adWatched();
      await performDownload(presetId);
      resolve();
    });
  });
}

async function performDownload(presetId) {
  const url = `${API_URL}/presets/${presetId}/download`;
  const options = { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } };
  try {
    if (!navigator.onLine) {
      await addToQueue('download', url, options);
      showToast('⏳ Download queued. Will start when online.', 'warning');
      return;
    }
    const res = await fetch(url, options);
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const disposition = res.headers.get('content-disposition');
      let filename = 'preset.xmp';
      if (disposition && disposition.indexOf('filename=') !== -1) {
        const match = disposition.match(/filename="?(.+)"?/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      showToast('✅ प्रीसेट डाउनलोड हो गया!', 'success');
      await fetchNotifications();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'डाउनलोड विफल', 'error');
    }
  } catch (err) {
    await addToQueue('download', url, options);
  }
}
window.downloadPreset = downloadPreset;

// ============================================================
// ===== BUY (Razorpay) – kept but not used =====
// ============================================================
async function buyPreset(presetId) {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  if (!navigator.onLine) {
    const url = `${API_URL}/payments/create-order`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ presetId })
    };
    await addToQueue('order', url, options);
    return;
  }
  try {
    const res = await fetch(`${API_URL}/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ presetId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Order creation failed');
    const options = {
      key: data.key,
      amount: data.amount,
      currency: data.currency,
      name: 'PresetHub',
      description: 'Preset Purchase',
      order_id: data.orderId,
      handler: function (response) {
        verifyPayment(response, presetId);
      },
      prefill: {
        name: currentUser.name,
        email: currentUser.email,
      },
      theme: {
        color: '#d4a373'
      }
    };
    const rzp = new Razorpay(options);
    rzp.open();
  } catch (err) {
    showToast('Payment initiation failed: ' + err.message, 'error');
  }
}
window.buyPreset = buyPreset;

async function verifyPayment(response, presetId) {
  try {
    const res = await fetch(`${API_URL}/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✅ भुगतान सफल! प्रीसेट डाउनलोड हो रहा है...', 'success');
      await downloadPreset(presetId);
    } else {
      showToast('Payment verification failed: ' + (data.error || 'unknown error'), 'error');
    }
  } catch (err) {
    showToast('Verification error: ' + err.message, 'error');
  }
}

// ============================================================
// ===== UPLOAD MODAL =====
// ============================================================
$('#uploadBtn')?.addEventListener('click', openUploadModal);
uploadHeroBtn?.addEventListener('click', openUploadModal);

function openUploadModal() {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:550px;">
      <button class="close">&times;</button>
      <h2>📤 नया प्रीसेट अपलोड करें</h2>
      <form id="uploadForm" enctype="multipart/form-data">
        <div class="form-group"><input type="text" id="uploadName" placeholder="प्रीसेट का नाम" required /></div>
        <div class="form-group"><textarea id="uploadDesc" placeholder="विवरण"></textarea></div>
        <div class="form-group">
          <select id="uploadCategory">
            <option value="सनसेट">सनसेट</option>
            <option value="ब्लैक & व्हाइट">ब्लैक & व्हाइट</option>
            <option value="नैचुरल">नैचुरल</option>
            <option value="विंटेज">विंटेज</option>
            <option value="सिटीस्केप">सिटीस्केप</option>
          </select>
        </div>
        <div class="form-group"><input type="text" id="uploadTags" placeholder="टैग्स (कॉमा से अलग)" /></div>
        <div class="form-group"><input type="number" id="uploadPrice" placeholder="कीमत (0 = मुफ्त)" min="0" step="1" /></div>
        <div class="form-group">
          <label>प्रीसेट फ़ाइल (.xmp, .dng, .lrtemplate)</label>
          <input type="file" id="uploadFile" accept=".xmp,.dng,.lrtemplate" required />
        </div>
        <div class="form-group">
          <label>प्रीव्यू इमेज (वैकल्पिक)</label>
          <input type="file" id="uploadPreview" accept="image/*" />
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">अपलोड करें</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.close').addEventListener('click', () => modal.remove());

  modal.querySelector('#uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', document.getElementById('uploadName').value);
    formData.append('description', document.getElementById('uploadDesc').value);
    formData.append('category', document.getElementById('uploadCategory').value);
    formData.append('tags', document.getElementById('uploadTags').value);
    formData.append('price', document.getElementById('uploadPrice').value || 0);
    const fileInput = document.getElementById('uploadFile');
    if (fileInput.files[0]) formData.append('file', fileInput.files[0]);
    const previewInput = document.getElementById('uploadPreview');
    if (previewInput.files[0]) formData.append('previewImage', previewInput.files[0]);
    
    const url = `${API_URL}/presets`;
    const options = {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    };

    try {
      if (!navigator.onLine) {
        showToast('⚠️ You are offline. Please connect to the internet to upload.', 'warning');
        return;
      }
      const res = await fetch(url, options);
      if (res.ok) {
        showToast('✅ प्रीसेट अपलोड हो गया!', 'success');
        modal.remove();
        loadPresets();
        loadLatestPresets();
        loadTopCreators();
      } else {
        const err = await res.json();
        showToast(err.error || 'अपलोड विफल', 'error');
      }
    } catch (err) {
      showToast('❌ Upload failed. Please check your connection.', 'error');
    }
  });
}
window.openUploadModal = openUploadModal;

// ============================================================
// ===== FEATURED DOWNLOAD =====
// ============================================================
featuredDownloadBtn?.addEventListener('click', async () => {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/presets/featured/download`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'featured-pack.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('✅ फीचर्ड पैक डाउनलोड हो गया!', 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'डाउनलोड विफल', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('त्रुटि: ' + err.message, 'error');
  }
});

// ============================================================
// ===== TOP CREATORS =====
// ============================================================
async function loadTopCreators() {
  try {
    const res = await fetch(`${API_URL}/users/top`);
    if (res.ok) {
      const creators = await res.json();
      const grid = document.getElementById('topCreatorsGrid');
      if (!grid) return;
      if (creators.length === 0) {
        grid.innerHTML = '<p style="color:var(--text);">कोई क्रिएटर नहीं</p>';
        return;
      }
      grid.innerHTML = creators.map(c => `
        <div class="creator-card" onclick="window.openProfile('${c.id}')">
          <div class="avatar" style="background-image:url(${c.avatar || ''}); background-size:cover;">
            ${!c.avatar ? c.name.charAt(0).toUpperCase() : ''}
          </div>
          <div class="name">${c.name}</div>
          <div class="stats">${c.presetCount} प्रीसेट • ${c.totalDownloads} डाउनलोड</div>
          <div class="followers">${c.followers} फॉलोअर्स</div>
        </div>
      `).join('');
    }
  } catch (err) { console.error(err); }
}

// ============================================================
// ===== PROFILE MODAL =====
// ============================================================
window.openProfile = async function(userId) {
  try {
    const res = await fetch(`${API_URL}/users/${userId}`);
    if (!res.ok) throw new Error('User not found');
    const user = await res.json();

    const presetsRes = await fetch(`${API_URL}/users/${userId}/presets`);
    const userPresets = presetsRes.ok ? await presetsRes.json() : [];

    const isFollowing = currentUser ? (user.followers || []).includes(currentUser.id) : false;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:700px;">
        <button class="close">&times;</button>
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:20px;">
          <div style="width:80px;height:80px;border-radius:50%;background:#d4a373;display:flex;align-items:center;justify-content:center;font-size:2rem;color:#fff;${user.avatar ? `background-image:url(${user.avatar});background-size:cover;` : ''}">
            ${!user.avatar ? user.name.charAt(0).toUpperCase() : ''}
          </div>
          <div>
            <h2 style="color:var(--text, #1e1e1e);">${user.name}</h2>
            <div style="color:#6b6b6b;">@${user.username || user.email.split('@')[0]}</div>
            <div style="margin-top:4px;color:var(--text, #1e1e1e);">${user.bio || 'कोई बायो नहीं'}</div>
            <div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;">
              <span><strong>${user.totalPresets || 0}</strong> प्रीसेट</span>
              <span><strong>${user.totalDownloads || 0}</strong> डाउनलोड</span>
              <span><strong>${user.followers || 0}</strong> फॉलोअर्स</span>
              <span><strong>${user.following || 0}</strong> फॉलोइंग</span>
            </div>
          </div>
          <div style="margin-left:auto;">
            ${currentUser && currentUser.id !== userId ? `
              <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" id="followBtn">
                ${isFollowing ? 'अनफॉलो करें' : 'फॉलो करें'}
              </button>
            ` : ''}
            ${currentUser && currentUser.id === userId ? `
              <button class="btn btn-outline" onclick="window.openEditProfile()"><i class="fas fa-edit"></i> प्रोफ़ाइल एडिट करें</button>
            ` : ''}
          </div>
        </div>
        ${user.socialLinks && Object.values(user.socialLinks).some(v => v) ? `
          <div style="margin-bottom:16px;">
            ${user.socialLinks.instagram ? `<a href="${user.socialLinks.instagram}" target="_blank" class="social-icon"><i class="fab fa-instagram"></i></a>` : ''}
            ${user.socialLinks.youtube ? `<a href="${user.socialLinks.youtube}" target="_blank" class="social-icon"><i class="fab fa-youtube"></i></a>` : ''}
            ${user.socialLinks.twitter ? `<a href="${user.socialLinks.twitter}" target="_blank" class="social-icon"><i class="fab fa-twitter"></i></a>` : ''}
            ${user.socialLinks.website ? `<a href="${user.socialLinks.website}" target="_blank" class="social-icon"><i class="fas fa-globe"></i></a>` : ''}
          </div>
        ` : ''}
        <h3 style="color:var(--text, #1e1e1e);">📦 ${user.name} के प्रीसेट</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-top:12px;">
          ${userPresets.length === 0 ? '<p style="grid-column:1/-1;color:#888;">अभी कोई प्रीसेट नहीं</p>' : 
            userPresets.map(p => `
              <div style="background:var(--bg, #f8f6f2);padding:16px;border-radius:12px;cursor:pointer;" onclick="window.openPresetModal('${p.id}')">
                <strong style="color:var(--text, #1e1e1e);">${p.name}</strong>
                <div style="font-size:0.8rem;color:#6b6b6b;">${p.category} • ${p.downloads || 0} डाउनलोड</div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.close').addEventListener('click', () => modal.remove());

    const followBtn = modal.querySelector('#followBtn');
    if (followBtn) {
      followBtn.addEventListener('click', async () => {
        if (!currentUser) {
          showToast('कृपया लॉग इन करें', 'warning');
          return;
        }
        await toggleFollow(userId);
      });
    }
  } catch (err) {
    console.error(err);
    showToast('प्रोफ़ाइल लोड नहीं हुई', 'error');
  }
};

// ============================================================
// ===== FOLLOW / UNFOLLOW =====
// ============================================================
async function toggleFollow(userId) {
  const url = `${API_URL}/users/${userId}/follow`;
  const options = {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  };
  try {
    if (!navigator.onLine) {
      await addToQueue('follow', url, options);
      showToast('⏳ Follow action queued.', 'info');
      return;
    }
    const res = await fetch(url, options);
    if (res.ok) {
      const data = await res.json();
      showToast(data.following ? '✅ फॉलो कर लिया!' : '❌ अनफॉलो कर दिया', 'info');
      const modal = document.querySelector('.modal-overlay.active');
      if (modal) {
        const currentProfileId = window._currentProfileId;
        if (currentProfileId) {
          modal.remove();
          window.openProfile(currentProfileId);
        }
      }
      await fetchNotifications();
    } else {
      showToast('कृपया बाद में प्रयास करें', 'error');
    }
  } catch (err) {
    await addToQueue('follow', url, options);
  }
}

// ============================================================
// ===== EDIT PROFILE =====
// ============================================================
window.openEditProfile = async function() {
  if (!currentUser) {
    showToast('कृपया लॉग इन करें', 'warning');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Profile not found');
    const user = await res.json();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:550px;">
        <button class="close">&times;</button>
        <h2>✏️ प्रोफ़ाइल एडिट करें</h2>
        <form id="editProfileForm" enctype="multipart/form-data">
          <div class="form-group">
            <label>अवतार</label>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
              <img id="avatarPreview" src="${user.avatar || ''}" alt="Avatar" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid #d4a373;${user.avatar ? '' : 'display:none;'}">
              <div>
                <input type="file" id="avatarFile" accept="image/*" style="padding:8px;border:1px solid var(--border,#ddd);border-radius:8px;">
                <div style="font-size:0.8rem;color:#888;margin-top:4px;">Max 5MB, JPG/PNG/GIF/WEBP</div>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>नाम</label>
            <input type="text" id="editName" value="${user.name || ''}" required />
          </div>
          <div class="form-group">
            <label>यूज़रनेम</label>
            <input type="text" id="editUsername" value="${user.username || ''}" />
          </div>
          <div class="form-group">
            <label>बायो</label>
            <textarea id="editBio" rows="3">${user.bio || ''}</textarea>
          </div>
          <div style="border-top:1px solid var(--border, #eee);padding-top:12px;margin-top:12px;">
            <h4>सोशल लिंक्स</h4>
            <div class="form-group">
              <label><i class="fab fa-instagram"></i> Instagram</label>
              <input type="text" id="editInstagram" value="${user.socialLinks?.instagram || ''}" />
            </div>
            <div class="form-group">
              <label><i class="fab fa-youtube"></i> YouTube</label>
              <input type="text" id="editYoutube" value="${user.socialLinks?.youtube || ''}" />
            </div>
            <div class="form-group">
              <label><i class="fab fa-twitter"></i> Twitter</label>
              <input type="text" id="editTwitter" value="${user.socialLinks?.twitter || ''}" />
            </div>
            <div class="form-group">
              <label><i class="fas fa-globe"></i> Website</label>
              <input type="text" id="editWebsite" value="${user.socialLinks?.website || ''}" />
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">सहेजें</button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.close').addEventListener('click', () => modal.remove());

    const avatarFileInput = modal.querySelector('#avatarFile');
    const avatarPreview = modal.querySelector('#avatarPreview');
    avatarFileInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
          avatarPreview.src = event.target.result;
          avatarPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });

    modal.querySelector('#editProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const avatarFile = modal.querySelector('#avatarFile').files[0];
      if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        try {
          const avatarRes = await fetch(`${API_URL}/users/me/avatar`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
          });
          if (!avatarRes.ok) {
            const err = await avatarRes.json();
            showToast('Avatar upload failed: ' + (err.error || 'unknown'), 'error');
            return;
          }
          const avatarData = await avatarRes.json();
          currentUser.avatar = avatarData.avatar;
          showLoggedInUI(currentUser);
        } catch (err) {
          showToast('Avatar upload error', 'error');
          return;
        }
      }

      const payload = {
        name: document.getElementById('editName').value,
        username: document.getElementById('editUsername').value,
        bio: document.getElementById('editBio').value,
        socialLinks: {
          instagram: document.getElementById('editInstagram').value,
          youtube: document.getElementById('editYoutube').value,
          twitter: document.getElementById('editTwitter').value,
          website: document.getElementById('editWebsite').value,
        }
      };
      try {
        const res = await fetch(`${API_URL}/users/me`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const updatedUser = await res.json();
          currentUser = updatedUser;
          showLoggedInUI(updatedUser);
          showToast('✅ प्रोफ़ाइल अपडेट हो गई', 'success');
          modal.remove();
          loadTopCreators();
        } else {
          const err = await res.json();
          showToast(err.error || 'अपडेट विफल', 'error');
        }
      } catch (err) {
        showToast('❌ Update failed. Please check your connection.', 'error');
      }
    });
  } catch (err) {
    console.error(err);
    showToast('प्रोफ़ाइल लोड नहीं हुई', 'error');
  }
};

// ============================================================
// ===== SUBSCRIPTION & REFERRAL =====
// ============================================================
async function fetchSubscription() {
  if (!token) return;
  try {
    const res = await fetch(`${API_URL}/users/me/subscription`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      subscriptionData = await res.json();
      updateSubscriptionUI();
    }
  } catch (err) { console.error(err); }
}

function updateSubscriptionUI() {
  const badge = document.getElementById('premiumBadge');
  if (badge) {
    badge.textContent = subscriptionData.isPremium ? '✅ Premium' : 'Free';
    badge.style.color = subscriptionData.isPremium ? '#2ecc71' : '#e74c3c';
  }
}

async function adWatched() {
  try {
    const res = await fetch(`${API_URL}/ads/watched`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`✅ Ad watched! (${data.adWatchCount} total, ${data.daysEarned} days earned)`, 'success');
      await fetchSubscription();
    }
  } catch (err) {
    showToast('Failed to register ad watch', 'error');
  }
}

async function generateReferral() {
  try {
    const res = await fetch(`${API_URL}/referrals/generate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`Your referral code: ${data.referralCode}`, 'info');
      await fetchSubscription();
    }
  } catch (err) {
    showToast('Failed to generate code', 'error');
  }
}

function showReferral() {
  const code = subscriptionData.referralCode || 'Generate';
  const link = `${window.location.origin}/?ref=${code}`;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <button class="close">&times;</button>
      <h2>🔗 Referral Program</h2>
      <p>Share your code: <strong>${code}</strong></p>
      <p>Link: <a href="${link}" target="_blank">${link}</a></p>
      <p>You have referred ${subscriptionData.referralCount || 0} users.</p>
      <p>Earn 28 days free for every 10 referrals!</p>
      <button class="btn btn-primary" onclick="generateReferral()">Generate Code</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());
}
window.showReferral = showReferral;

// ============================================================
// ===== NOTIFICATIONS =====
// ============================================================
async function fetchNotifications() {
  if (!token) return;
  try {
    const res = await fetch(`${API_URL}/users/me/notifications`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      notifications = await res.json();
      updateNotificationUI();
    }
  } catch (err) { console.error(err); }
}

function updateNotificationUI() {
  const badge = document.getElementById('notifBadge');
  const unread = notifications.filter(n => !n.read).length;
  if (badge) {
    if (unread > 0) {
      badge.style.display = 'inline';
      badge.textContent = unread;
    } else {
      badge.style.display = 'none';
    }
  }
}

function openNotifications() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:600px;">
      <button class="close">&times;</button>
      <h2>📥 Inbox</h2>
      <div id="notifList">
        ${notifications.length === 0 ? '<p>No notifications</p>' : 
          notifications.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
              <div>${n.message}</div>
              <div class="time">${new Date(n.createdAt).toLocaleString()}</div>
              <a href="${n.link}" target="_blank">View</a>
            </div>
          `).join('')
        }
      </div>
      <button class="btn btn-sm btn-primary" id="markAllRead">Mark all as read</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());
  modal.querySelector('#markAllRead').addEventListener('click', async () => {
    await fetch(`${API_URL}/notifications/read-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await fetchNotifications();
    modal.remove();
    openNotifications();
  });
  modal.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      await fetch(`${API_URL}/notifications/read/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchNotifications();
    });
  });
}
document.getElementById('notificationBtn')?.addEventListener('click', openNotifications);

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ============================================================
// ===== EARNINGS =====
// ============================================================
window.showEarnings = async function() {
  if (!currentUser) { showToast('Please login', 'warning'); return; }
  try {
    const res = await fetch(`${API_URL}/users/${currentUser.id}/earnings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch earnings');
    const data = await res.json();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:700px;">
        <button class="close">&times;</button>
        <h2>💰 My Earnings</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0;">
          <div class="stat-item" style="background:var(--bg,#f8f6f2);padding:16px;border-radius:12px;text-align:center;">
            <div class="num" style="font-size:1.8rem;font-weight:700;color:#d4a373;">${data.totalImpressions}</div>
            <div class="label">Total Impressions</div>
          </div>
          <div class="stat-item" style="background:var(--bg,#f8f6f2);padding:16px;border-radius:12px;text-align:center;">
            <div class="num" style="font-size:1.8rem;font-weight:700;color:#2a9d8f;">₹${data.totalRevenue.toFixed(2)}</div>
            <div class="label">Total Earnings</div>
          </div>
          <div class="stat-item" style="background:var(--bg,#f8f6f2);padding:16px;border-radius:12px;text-align:center;">
            <div class="num" style="font-size:1.8rem;font-weight:700;color:#3498db;">${data.totalDownloads}</div>
            <div class="label">Total Downloads</div>
          </div>
        </div>
        <h3 style="margin:16px 0 8px;">📊 Preset Performance</h3>
        <div style="max-height:300px;overflow-y:auto;">
          ${data.presets.length === 0 ? '<p>No presets uploaded yet.</p>' :
            data.presets.map(p => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border,#eee);flex-wrap:wrap;gap:8px;">
                <div>
                  <strong>${p.name}</strong>
                  <span style="font-size:0.8rem;color:#888;">(${p.category})</span>
                </div>
                <div style="display:flex;gap:16px;font-size:0.85rem;">
                  <span><i class="fas fa-eye"></i> ${p.impressions}</span>
                  <span><i class="fas fa-download"></i> ${p.downloads}</span>
                  <span style="color:#2a9d8f;font-weight:600;">₹${p.revenue.toFixed(2)}</span>
                </div>
              </div>
            `).join('')
          }
        </div>
        ${data.canWithdraw ? `
          <div style="margin-top:16px;padding:12px;background:#d4edda;border-radius:12px;color:#155724;">
            ✅ You are eligible for withdrawal! (Min. ₹100)
            <button class="btn btn-sm btn-primary" onclick="requestWithdrawal()" style="margin-left:12px;">Request Withdrawal</button>
          </div>
        ` : `
          <div style="margin-top:16px;padding:12px;background:#fff3cd;border-radius:12px;color:#856404;">
            💡 You need ₹100+ to withdraw. Current: ₹${data.totalRevenue.toFixed(2)}
          </div>
        `}
        ${data.withdrawalStatus ? `<div style="margin-top:8px;">📝 Withdrawal Status: ${data.withdrawalStatus}</div>` : ''}
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());
  } catch (err) {
    console.error(err);
    showToast('Failed to load earnings', 'error');
  }
};

window.requestWithdrawal = function() {
  showToast('Please contact support@presethub.site for withdrawal requests.', 'info');
};

// ============================================================
// ===== EXIT BUTTON =====
// ============================================================
function exitSite() {
  if (confirm('Are you sure you want to leave PresetHub?')) {
    window.close();
    window.location.href = 'about:blank';
  }
}
document.getElementById('exitBtn')?.addEventListener('click', exitSite);

// ============================================================
// ===== EXPLORE BUTTON & FILTERS =====
// ============================================================
exploreBtn?.addEventListener('click', () => {
  document.getElementById('presetsSection')?.scrollIntoView({ behavior: 'smooth' });
});

searchBtn.addEventListener('click', () => {
  searchSuggestions.style.display = 'none';
  currentPage = 1;
  loadPresets();
});
searchInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') {
    searchSuggestions.style.display = 'none';
    currentPage = 1;
    loadPresets();
  }
});
filterCategory.addEventListener('change', () => { currentPage = 1; loadPresets(); });
filterPrice.addEventListener('change', () => { currentPage = 1; loadPresets(); });
filterSort.addEventListener('change', () => { currentPage = 1; loadPresets(); });

document.querySelectorAll('.category-card').forEach(card => {
  card.addEventListener('click', () => {
    const cat = card.querySelector('.name')?.textContent;
    if (cat) {
      filterCategory.value = cat;
      currentPage = 1;
      loadPresets();
      document.getElementById('presetsSection')?.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// ============================================================
// ===== HANDLE URL ACTIONS (from PWA Shortcuts) =====
// ============================================================
function handleUrlAction() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (!action) return;

  setTimeout(() => {
    switch (action) {
      case 'search':
        const si = document.getElementById('searchInput');
        if (si) { si.focus(); si.scrollIntoView({ behavior: 'smooth' }); }
        break;
      case 'wishlist':
        showWishlist();
        break;
      case 'upload':
        if (currentUser) openUploadModal();
        else showToast('Please login', 'warning');
        break;
      case 'inbox':
        if (currentUser) openNotifications();
        else showToast('Please login', 'warning');
        break;
      case 'profile':
        if (currentUser) openEditProfile();
        else showToast('Please login', 'warning');
        break;
      default:
        break;
    }
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, '/');
    }
  }, 500);
}

// ============================================================
// ===== INIT =====
// ============================================================
loadPresets();
loadLatestPresets();
loadTopCreators();
handleUrlAction();

if (!navigator.onLine && offlineIndicator) {
  offlineIndicator.style.display = 'inline-block';
}

// ============================================================
// ===== PWA =====
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('✅ SW registered with offline support'))
    .catch(err => console.error('❌ SW failed', err));
}

console.log('🚀 PresetHub frontend loaded with all features');
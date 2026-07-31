// ============================================================
// ===== CONFIGURATION =====
// ============================================================
const API_URL = window.location.origin + '/api';

// ============================================================
// ===== GLOBALS =====
// ============================================================
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

// ============================================================
// ===== DOM REFS =====
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let authSection, userSection, userAvatar, loginBtn, signupBtn, logoutBtn;
let presetGrid, latestGrid, searchInput, searchBtn;
let filterCategory, filterPrice, filterSort;
let wishlistBtn, exploreBtn, uploadHeroBtn, featuredDownloadBtn;
let searchSuggestions, themeToggle, loadMoreBtn, offlineIndicator, userDropdown;

// ============================================================
// ===== DOM READY =====
// ============================================================
function initDOM() {
  authSection = $('#authSection');
  userSection = $('#userSection');
  userAvatar = $('#userAvatar');
  loginBtn = $('#loginBtn');
  signupBtn = $('#signupBtn');
  logoutBtn = $('#logoutBtn');
  presetGrid = $('#presetGrid');
  latestGrid = $('#latestGrid');
  searchInput = $('#searchInput');
  searchBtn = $('#searchBtn');
  filterCategory = $('#filterCategory');
  filterPrice = $('#filterPrice');
  filterSort = $('#filterSort');
  wishlistBtn = $('#wishlistBtn');
  exploreBtn = $('#exploreBtn');
  uploadHeroBtn = $('#uploadHeroBtn');
  featuredDownloadBtn = $('#featuredDownloadBtn');
  searchSuggestions = $('#searchSuggestions');
  themeToggle = $('#themeToggle');
  loadMoreBtn = $('#loadMoreBtn');
  offlineIndicator = $('#offlineIndicator');
  userDropdown = document.getElementById('userDropdown');

  attachEventListeners();
}

// ============================================================
// ===== TOAST SYSTEM =====
// ============================================================
function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
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
// ===== ATTACH EVENT LISTENERS =====
// ============================================================
function attachEventListeners() {
  if (loginBtn) loginBtn.addEventListener('click', () => openAuthModal('login'));
  if (signupBtn) signupBtn.addEventListener('click', () => openAuthModal('signup'));
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
    if (document.body.classList.contains('dark')) {
      themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }
  }

  if (userAvatar) {
    userAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!currentUser) {
        showToast('कृपया पहले लॉग इन करें', 'warning');
        return;
      }
      if (userDropdown) {
        userDropdown.style.display = userDropdown.style.display === 'block' ? 'none' : 'block';
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (userDropdown && !e.target.closest('#userSection')) {
      userDropdown.style.display = 'none';
    }
  });

  if (wishlistBtn) wishlistBtn.addEventListener('click', showWishlist);

  const uploadBtn = $('#uploadBtn');
  if (uploadBtn) uploadBtn.addEventListener('click', openUploadModal);
  if (uploadHeroBtn) uploadHeroBtn.addEventListener('click', openUploadModal);

  if (exploreBtn) {
    exploreBtn.addEventListener('click', () => {
      const section = document.getElementById('presetsSection');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
  }

  if (featuredDownloadBtn) {
    featuredDownloadBtn.addEventListener('click', async () => {
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
        showToast('त्रुटि: ' + err.message, 'error');
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      if (searchSuggestions) searchSuggestions.style.display = 'none';
      currentPage = 1;
      loadPresets();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        if (searchSuggestions) searchSuggestions.style.display = 'none';
        currentPage = 1;
        loadPresets();
      }
    });

    let searchTimeout = null;
    searchInput.addEventListener('input', function () {
      const query = this.value.trim();
      if (query.length < 2) {
        if (searchSuggestions) searchSuggestions.style.display = 'none';
        return;
      }
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`\( {API_URL}/presets/search?q= \){encodeURIComponent(query)}`);
          if (res.ok) {
            const suggestions = await res.json();
            if (searchSuggestions) {
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
                item.addEventListener('click', function (e) {
                  e.stopPropagation();
                  const id = this.dataset.id;
                  if (searchInput) searchInput.value = '';
                  if (searchSuggestions) searchSuggestions.style.display = 'none';
                  openPresetModal(id);
                });
              });
            }
          }
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 300);
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-search')) {
      if (searchSuggestions) searchSuggestions.style.display = 'none';
    }
  });

  if (filterCategory) filterCategory.addEventListener('change', () => { currentPage = 1; loadPresets(); });
  if (filterPrice) filterPrice.addEventListener('change', () => { currentPage = 1; loadPresets(); });
  if (filterSort) filterSort.addEventListener('change', () => { currentPage = 1; loadPresets(); });

  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', function () {
      const cat = this.querySelector('.name')?.textContent;
      if (cat && filterCategory) {
        filterCategory.value = cat;
        currentPage = 1;
        loadPresets();
        const section = document.getElementById('presetsSection');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      loadPresets(currentPage + 1, true);
    });
  }

  const notificationBtn = document.getElementById('notificationBtn');
  if (notificationBtn) notificationBtn.addEventListener('click', openNotifications);

  const exitBtn = document.getElementById('exitBtn');
  if (exitBtn) exitBtn.addEventListener('click', exitSite);

  // Grid event delegation
  [presetGrid, latestGrid].forEach(grid => {
    if (!grid) return;
    grid.addEventListener('click', function (e) {
      const card = e.target.closest('.preset-card');
      if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.preview-btn')) {
        e.stopPropagation();
        openPresetModal(id);
        return;
      }
      if (e.target.closest('.wishlist-toggle')) {
        e.stopPropagation();
        toggleWishlist(id);
        return;
      }
      if (!e.target.closest('.author')) {
        openPresetModal(id);
      }
    });
  });

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
}

// ============================================================
// ===== OFFLINE QUEUE =====
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
      action,
      url,
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body || null,
      timestamp: Date.now()
    };
    await new Promise((resolve, reject) => {
      const request = store.add(item);
      request.onsuccess = resolve;
      request.onerror = reject;
    });

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register('presethub-sync');
      } catch (err) {
        console.warn('Background Sync not available', err);
      }
    }

    showToast(`⏳ "${action}" saved offline. Will sync when online.`, 'warning');
    return true;
  } catch (err) {
    console.error('Failed to add to queue:', err);
    showToast('❌ Failed to save offline.', 'error');
    return false;
  }
}

// ============================================================
// ===== SERVICE WORKER MESSAGE =====
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SYNC_SUCCESS') {
      showToast(`✅ "${event.data.action}" synced successfully!`, 'success');
      if (['review', 'wishlist', 'upload'].includes(event.data.action)) {
        loadPresets();
        loadLatestPresets();
      }
      if (['download', 'follow', 'order'].includes(event.data.action)) {
        fetchUserProfile();
      }
    }
  });
}

// ============================================================
// ===== DARK MODE =====
// ============================================================
const currentTheme = localStorage.getItem('theme') || 'light';
if (currentTheme === 'dark') {
  document.body.classList.add('dark');
}

// ============================================================
// ===== AUTH =====
// ============================================================
if (token) {
  fetchUserProfile();
}

async function fetchUserProfile() {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      showLoggedInUI(data.user);
    } else {
      logout();
    }
  } catch (err) {
    console.error('Profile fetch error', err);
  }
}

function showLoggedInUI(user) {
  if (authSection) authSection.style.display = 'none';
  if (userSection) userSection.style.display = 'flex';
  if (userAvatar) {
    userAvatar.textContent = user.name.charAt(0).toUpperCase();
    if (user.avatar) {
      userAvatar.style.backgroundImage = `url(${user.avatar})`;
      userAvatar.style.backgroundSize = 'cover';
      userAvatar.textContent = '';
    } else {
      userAvatar.style.backgroundImage = '';
    }
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
  if (authSection) authSection.style.display = 'flex';
  if (userSection) userSection.style.display = 'none';
  wishlist = [];
  notifications = [];
  subscriptionData = {};
  updateWishlistUI();
  if (userDropdown) userDropdown.style.display = 'none';
  showToast('लॉगआउट हो गया', 'info');
}
window.logout = logout;

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
          ${mode === 'login' ? '<i class="fas fa-sign-in-alt"></i> लॉग इन करें' : '<i class="fas fa-user-plus"></i> साइन अप करें'}
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

    let url = `\( {API_URL}/auth/ \){mode}`;
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
        if (window.history?.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
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
    // Backend returns wishlist inside user profile or via dedicated endpoint
    // We use the toggle response + profile
    const res = await fetch(`${API_URL}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const user = await res.json();
      wishlist = user.wishlist || [];
      updateWishlistUI();
    }
  } catch (err) {
    console.error(err);
  }
}

async function toggleWishlist(presetId) {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }

  const url = `\( {API_URL}/users/me/wishlist/ \){presetId}`;
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
      renderPresetsToContainer(allPresets, presetGrid);
      loadLatestPresets();
      return;
    }

    const res = await fetch(url, options);
    if (res.ok) {
      const data = await res.json();
      wishlist = data.wishlist || [];
      updateWishlistUI();
      renderPresetsToContainer(allPresets, presetGrid);
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
  if (!wishlistBtn) return;
  const count = wishlist.length;
  wishlistBtn.innerHTML = `<i class="fa\( {count > 0 ? 's' : 'r'} fa-heart"></i> \){count > 0 ? count : ''}`;
}

async function showWishlist() {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  if (wishlist.length === 0) {
    showToast('आपकी विशलिस्ट खाली है।', 'info');
    return;
  }

  const presets = [];
  for (const id of wishlist) {
    try {
      const res = await fetch(`\( {API_URL}/presets/ \){id}`);
      if (res.ok) presets.push(await res.json());
    } catch (e) {}
  }

  if (presets.length === 0) {
    showToast('कोई प्रीसेट नहीं मिला।', 'info');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:600px;">
      <button class="close">&times;</button>
      <h2><i class="fas fa-heart" style="color:#e74c3c;"></i> आपकी विशलिस्ट</h2>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
        ${presets.map(p => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg,#f8f6f2);border-radius:12px;">
            <div>
              <strong>${p.name}</strong> – ${p.author}
              <span style="margin-left:8px;font-size:0.8rem;color:#6b6b6b;">${p.category}</span>
            </div>
            <button class="btn btn-sm btn-primary" onclick="window.openPresetModal('${p.id}')"><i class="fas fa-eye"></i> देखें</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());
}
window.showWishlist = showWishlist;

// ============================================================
// ===== RENDER PRESETS =====
// ============================================================
function renderPresetsToContainer(presets, container) {
  if (!container) return;
  if (!presets || presets.length === 0) {
    container.innerHTML = `<div class="no-results" style="grid-column:1/-1;text-align:center;padding:30px 15px;color:#7a7a7a;">
      <i class="fas fa-search" style="font-size:2rem;display:block;margin-bottom:10px;"></i>
      😕 कोई प्रीसेट नहीं मिला
    </div>`;
    return;
  }

  container.innerHTML = presets.map(p => {
    const isLiked = wishlist.includes(p.id);
    const priceDisplay = p.price === 0
      ? `<span class="price free">मुफ्त</span>`
      : `<span class="price">₹${p.price}</span>`;
    const stars = '★'.repeat(Math.floor(p.avgRating || 0)) + (p.avgRating % 1 >= 0.5 ? '½' : '');
    const previewImageSrc = p.previewImage
      ? (p.previewImage.startsWith('http') ? p.previewImage : window.location.origin + p.previewImage)
      : null;

    const previewImg = previewImageSrc
      ? `<img src="\( {previewImageSrc}" alt=" \){p.name}" style="width:100%;height:100%;object-fit:contain;background:#e8e0d6;" onerror="this.style.display='none'">`
      : `<div style="width:100%;height:100%;background:#d9d0c4;display:flex;align-items:center;justify-content:center;color:#4a3f35;font-size:0.85rem;">${p.name}</div>`;

    return `
      <div class="preset-card" data-id="${p.id}">
        <div class="thumb" style="height:160px;">
          ${previewImg}
          <div class="overlay">
            <button class="btn btn-sm preview-btn" data-id="${p.id}" style="font-size:0.7rem;padding:5px 12px;"><i class="fas fa-eye"></i> प्रीव्यू</button>
            <button class="btn btn-sm wishlist-toggle" data-id="${p.id}" style="background:#fff;color:#e74c3c;font-size:0.7rem;padding:5px 10px;">
              <i class="fa${isLiked ? 's' : 'r'} fa-heart"></i>
            </button>
          </div>
        </div>
        <div class="info" style="padding:12px 14px 14px;">
          <span class="tag" style="font-size:0.6rem;">${p.category || 'General'}</span>
          <h3 style="font-size:0.95rem;font-weight:700;margin:4px 0 2px;">${p.name}</h3>
          <div class="author" style="cursor:pointer;color:#d4a373;font-size:0.75rem;" onclick="event.stopPropagation(); window.openProfile('${p.authorId}')">
            ${p.author}
          </div>
          <div class="meta" style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border,#f0ebe3);padding-top:8px;margin-top:6px;">
            ${priceDisplay}
            <span class="rating" style="font-size:0.75rem;color:#f4a261;">${stars} ${p.avgRating ? p.avgRating.toFixed(1) : '0'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// ===== LOAD PRESETS =====
// ============================================================
async function loadPresets(page = 1, append = false) {
  try {
    const params = new URLSearchParams();
    const q = searchInput ? searchInput.value.trim() : '';
    if (q) params.append('q', q);
    if (filterCategory?.value) params.append('category', filterCategory.value);
    if (filterPrice?.value) params.append('price', filterPrice.value);
    if (filterSort?.value) params.append('sort', filterSort.value);
    params.append('page', page);
    params.append('limit', 20);

    const res = await fetch(`\( {API_URL}/presets? \){params.toString()}`);
    if (!res.ok) throw new Error('Network error');

    const data = await res.json();
    allPresets = data.presets || [];
    totalPages = data.totalPages || 1;
    currentPage = data.page || 1;

    if (append && presetGrid) {
      const temp = document.createElement('div');
      renderPresetsToContainer(allPresets, temp);
      presetGrid.innerHTML += temp.innerHTML;
    } else {
      renderPresetsToContainer(allPresets, presetGrid);
    }

    if (loadMoreBtn) {
      loadMoreBtn.style.display = currentPage < totalPages ? 'inline-flex' : 'none';
      if (currentPage < totalPages) {
        loadMoreBtn.innerHTML = `<i class="fas fa-plus"></i> और लोड करें (\( {currentPage}/ \){totalPages})`;
      }
    }
  } catch (err) {
    console.warn('Load presets failed:', err);
    if (presetGrid && !append) {
      presetGrid.innerHTML = `<div style="padding:30px;text-align:center;grid-column:1/-1;color:#7a7a7a;">
        <i class="fas fa-triangle-exclamation" style="color:#f39c12;font-size:1.5rem;"></i><br>
        प्रीसेट लोड नहीं हो पाए।
        <br><button class="btn btn-sm btn-outline" style="margin-top:10px;" onclick="loadPresets()"><i class="fas fa-rotate"></i> फिर कोशिश करें</button>
      </div>`;
    }
  }
}

async function loadLatestPresets() {
  try {
    const res = await fetch(`${API_URL}/presets?sort=newest&limit=6`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    renderPresetsToContainer(data.presets || [], latestGrid);
  } catch (err) {
    if (latestGrid) {
      latestGrid.innerHTML = `<div style="padding:20px;text-align:center;color:#7a7a7a;">
        <i class="fas fa-triangle-exclamation" style="color:#f39c12;"></i> प्रीसेट लोड नहीं हो पाए।
      </div>`;
    }
  }
}

// ============================================================
// ===== PRESET MODAL =====
// ============================================================
async function openPresetModal(presetId) {
  try {
    const res = await fetch(`\( {API_URL}/presets/ \){presetId}`);
    if (!res.ok) throw new Error('Preset not found');
    const preset = await res.json();
    const isLiked = wishlist.includes(preset.id);
    const isFree = preset.price === 0;

    if (!viewedPresets.has(presetId) && currentUser && preset.authorId !== currentUser.id) {
      viewedPresets.add(presetId);
      fetch(`\( {API_URL}/presets/ \){presetId}/view`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
      fetch(`\( {API_URL}/presets/ \){presetId}/ad-impression`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }

    const reviews = (preset.reviews || []).sort((a, b) => (b.helpful || 0) - (a.helpful || 0));
    const topReviews = reviews.slice(0, 5);
    const previewImageSrc = preset.previewImage
      ? (preset.previewImage.startsWith('http') ? preset.previewImage : window.location.origin + preset.previewImage)
      : null;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal">
        <button class="close">&times;</button>
        <div class="modal-grid">
          <div class="modal-preview">
            ${previewImageSrc
              ? `<img src="\( {previewImageSrc}" alt=" \){preset.name}" style="width:100%;border-radius:12px;" onerror="this.style.display='none'">`
              : `<div style="background:#d9d0c4;height:200px;border-radius:12px;display:flex;align-items:center;justify-content:center;">${preset.name}</div>`}
          </div>
          <div class="modal-details">
            <h2>${preset.name}</h2>
            <div class="author" style="cursor:pointer;color:#d4a373;" onclick="window.openProfile('\( {preset.authorId}')">by <strong> \){preset.author}</strong></div>
            <div class="desc" style="margin:8px 0 14px;">${preset.description || 'कोई विवरण नहीं'}</div>
            <div class="price-lg \( {isFree ? 'free' : ''}" style="font-size:1.4rem;"> \){isFree ? 'मुफ्त' : '₹' + preset.price}</div>
            <div class="actions" style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
              <button class="btn btn-primary download-btn" data-id="${preset.id}">
                <i class="fas fa-download"></i> ${isFree ? 'डाउनलोड करें' : 'खरीदें'}
              </button>
              <button class="btn btn-outline wishlist-btn" data-id="${preset.id}">
                <i class="fa${isLiked ? 's' : 'r'} fa-heart"></i> ${isLiked ? 'पसंद में' : 'पसंद करें'}
              </button>
            </div>
            <div class="meta-list" style="display:flex;flex-wrap:wrap;gap:12px;font-size:0.8rem;margin-top:14px;">
              <span><i class="fas fa-eye"></i> ${preset.views || 0}</span>
              <span><i class="fas fa-download"></i> ${preset.downloads || 0}</span>
              <span><i class="fas fa-star" style="color:#f4a261;"></i> \( {preset.avgRating ? preset.avgRating.toFixed(1) : '0'} ( \){preset.reviews?.length || 0})</span>
            </div>
            <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px;">
              <h4><i class="fas fa-star" style="color:#f4a261;"></i> समीक्षाएँ (${preset.reviews?.length || 0})</h4>
              <div id="reviewList" style="max-height:200px;overflow-y:auto;">
                ${topReviews.length > 0 ? topReviews.map(r => `
                  <div style="padding:8px 0;border-bottom:1px solid var(--border);">
                    <strong>${r.userName}</strong>
                    <span style="color:#f4a261;">${'★'.repeat(r.rating)}</span>
                    <p style="margin:3px 0 0;font-size:0.85rem;">${r.comment}</p>
                  </div>
                `).join('') : '<p style="color:#888;">अभी कोई समीक्षा नहीं</p>'}
              </div>
              ${currentUser ? `
                <form id="reviewForm" style="margin-top:10px;">
                  <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <input type="number" id="reviewRating" min="1" max="5" placeholder="Rating" required style="width:80px;padding:6px;">
                    <textarea id="reviewComment" placeholder="समीक्षा लिखें..." required style="flex:1;padding:6px;min-height:50px;"></textarea>
                  </div>
                  <button type="submit" class="btn btn-sm btn-primary" style="margin-top:8px;"><i class="fas fa-paper-plane"></i> भेजें</button>
                </form>
              ` : `<p style="color:#888;margin-top:8px;">समीक्षा के लिए <a href="#" onclick="openAuthModal('login');return false;" style="color:#d4a373;">लॉग इन</a> करें</p>`}
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
      if (preset.price > 0) await buyPreset(preset.id);
      else await downloadPreset(preset.id);
    });

    modal.querySelector('.wishlist-btn').addEventListener('click', async () => {
      await toggleWishlist(preset.id);
      modal.remove();
      openPresetModal(preset.id);
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
// ===== REVIEW =====
// ============================================================
async function submitReview(presetId, rating, comment) {
  const url = `\( {API_URL}/reviews/ \){presetId}`;
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
      return;
    }
    const res = await fetch(url, options);
    if (res.ok) {
      showToast('✅ समीक्षा सहेजी गई', 'success');
      const modal = document.querySelector('.modal-overlay.active');
      if (modal) {
        modal.remove();
        openPresetModal(presetId);
      }
      loadPresets();
    } else {
      const err = await res.json();
      showToast(err.error || 'समीक्षा सबमिट नहीं हो पाई', 'error');
    }
  } catch (err) {
    await addToQueue('review', url, options);
  }
}

// ============================================================
// ===== DOWNLOAD =====
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
        <h3><i class="fas fa-ad"></i> Sponsored</h3>
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
        setTimeout(() => skipBtn.click(), 500);
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
  const url = `\( {API_URL}/presets/ \){presetId}/download`;
  const options = { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } };

  try {
    if (!navigator.onLine) {
      await addToQueue('download', url, options);
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
      if (disposition) {
        const match = disposition.match(/filename="?(.+)"?/);
        if (match) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      showToast('✅ प्रीसेट डाउनलोड हो गया!', 'success');
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
// ===== BUY (Razorpay) =====
// ============================================================
async function buyPreset(presetId) {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
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
        email: currentUser.email
      },
      theme: { color: '#d4a373' }
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
        razorpay_signature: response.razorpay_signature
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✅ भुगतान सफल! प्रीसेट डाउनलोड हो रहा है...', 'success');
      await downloadPreset(presetId);
    } else {
      showToast('Payment verification failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (err) {
    showToast('Verification error: ' + err.message, 'error');
  }
}

// ============================================================
// ===== UPLOAD =====
// ============================================================
function openUploadModal() {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:500px;padding:28px;">
      <button class="close">&times;</button>
      <h2><i class="fas fa-cloud-upload-alt"></i> नया प्रीसेट अपलोड करें</h2>
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
        <button type="submit" class="btn btn-primary" style="width:100%;"><i class="fas fa-upload"></i> अपलोड करें</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());

  modal.querySelector('#uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      showToast('⚠️ Offline. Upload ke liye internet chahiye.', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('name', document.getElementById('uploadName').value);
    formData.append('description', document.getElementById('uploadDesc').value);
    formData.append('category', document.getElementById('uploadCategory').value);
    formData.append('tags', document.getElementById('uploadTags').value);
    formData.append('price', document.getElementById('uploadPrice').value || 0);
    const file = document.getElementById('uploadFile').files[0];
    if (file) formData.append('file', file);
    const preview = document.getElementById('uploadPreview').files[0];
    if (preview) formData.append('previewImage', preview);

    try {
      const res = await fetch(`${API_URL}/presets`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
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
      showToast('❌ Upload failed', 'error');
    }
  });
}
window.openUploadModal = openUploadModal;

// ============================================================
// ===== TOP CREATORS =====
// ============================================================
async function loadTopCreators() {
  const grid = document.getElementById('topCreatorsGrid');
  if (!grid) return;
  try {
    const res = await fetch(`${API_URL}/users/top`);
    if (!res.ok) throw new Error('Failed');
    const creators = await res.json();
    if (!creators.length) {
      grid.innerHTML = '<p style="color:var(--text);">कोई क्रिएटर नहीं</p>';
      return;
    }
    grid.innerHTML = creators.map(c => `
      <div class="creator-card" style="cursor:pointer;padding:14px;" onclick="window.openProfile('${c.id}')">
        <div class="avatar" style="width:50px;height:50px;font-size:1.2rem;margin:0 auto 6px;background-image:url(${c.avatar || ''});background-size:cover;">
          ${!c.avatar ? c.name.charAt(0).toUpperCase() : ''}
        </div>
        <div class="name" style="font-size:0.85rem;">${c.name}</div>
        <div class="stats" style="font-size:0.7rem;color:#6b6b6b;">${c.presetCount || 0} प्रीसेट</div>
        <div class="followers" style="font-size:0.7rem;color:#d4a373;"><i class="fas fa-users"></i> ${c.followers || 0}</div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div style="padding:20px;text-align:center;color:#7a7a7a;">
      <i class="fas fa-triangle-exclamation" style="color:#f39c12;"></i> क्रिएटर्स लोड नहीं हो पाए।
    </div>`;
  }
}

// ============================================================
// ===== PROFILE =====
// ============================================================
window.openProfile = async function (userId) {
  try {
    window._currentProfileId = userId;
    const res = await fetch(`\( {API_URL}/users/ \){userId}`);
    if (!res.ok) throw new Error('User not found');
    const user = await res.json();

    const presetsRes = await fetch(`\( {API_URL}/users/ \){userId}/presets`);
    const userPresets = presetsRes.ok ? await presetsRes.json() : [];
    const isFollowing = currentUser ? (user.followers || []).includes(currentUser.id) : false;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:650px;padding:28px;">
        <button class="close">&times;</button>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
          <div style="width:64px;height:64px;border-radius:50%;background:#d4a373;display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:#fff;\( {user.avatar ? `background-image:url( \){user.avatar});background-size:cover;` : ''}">
            ${!user.avatar ? user.name.charAt(0).toUpperCase() : ''}
          </div>
          <div>
            <h2 style="font-size:1.2rem;">${user.name}</h2>
            <div style="color:#6b6b6b;font-size:0.85rem;">@${user.username || ''}</div>
            <div style="margin-top:2px;font-size:0.85rem;">${user.bio || 'कोई बायो नहीं'}</div>
            <div style="display:flex;gap:12px;margin-top:6px;font-size:0.8rem;">
              <span><strong>${user.totalPresets || 0}</strong> प्रीसेट</span>
              <span><strong>${user.totalDownloads || 0}</strong> डाउनलोड</span>
              <span><strong><i class="fas fa-users"></i> ${user.followers || 0}</strong></span>
            </div>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px;">
            ${currentUser && currentUser.id !== userId ? `
              <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" id="followBtn">
                ${isFollowing ? '<i class="fas fa-user-minus"></i> अनफॉलो' : '<i class="fas fa-user-plus"></i> फॉलो'}
              </button>
            ` : ''}
            ${currentUser && currentUser.id === userId ? `
              <button class="btn btn-outline" onclick="window.openEditProfile()"><i class="fas fa-edit"></i> एडिट</button>
              <button class="btn btn-outline" onclick="window.openChangePassword()"><i class="fas fa-key"></i> पासवर्ड</button>
            ` : ''}
          </div>
        </div>
        <h3><i class="fas fa-cubes"></i> प्रीसेट</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:8px;">
          ${userPresets.length === 0
            ? '<p style="grid-column:1/-1;color:#888;">अभी कोई प्रीसेट नहीं</p>'
            : userPresets.map(p => `
              <div style="background:var(--bg,#f8f6f2);padding:12px;border-radius:10px;cursor:pointer;" onclick="window.openPresetModal('${p.id}')">
                <strong style="font-size:0.85rem;">${p.name}</strong>
                <div style="font-size:0.75rem;color:#6b6b6b;">${p.category} • ${p.downloads || 0} डाउनलोड</div>
              </div>
            `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());

    const followBtn = modal.querySelector('#followBtn');
    if (followBtn) {
      followBtn.addEventListener('click', async () => {
        await toggleFollow(userId);
      });
    }
  } catch (err) {
    showToast('प्रोफ़ाइल लोड नहीं हुई', 'error');
  }
};

async function toggleFollow(userId) {
  const url = `\( {API_URL}/users/ \){userId}/follow`;
  const options = { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } };
  try {
    if (!navigator.onLine) {
      await addToQueue('follow', url, options);
      return;
    }
    const res = await fetch(url, options);
    if (res.ok) {
      const data = await res.json();
      showToast(data.following ? '✅ फॉलो कर लिया!' : '❌ अनफॉलो कर दिया', 'info');
      const modal = document.querySelector('.modal-overlay.active');
      if (modal && window._currentProfileId) {
        modal.remove();
        window.openProfile(window._currentProfileId);
      }
    }
  } catch (err) {
    await addToQueue('follow', url, options);
  }
}

// ============================================================
// ===== EDIT PROFILE (FIXED) =====
// ============================================================
window.openEditProfile = async function () {
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
      <div class="modal" style="max-width:500px;padding:28px;">
        <button class="close">&times;</button>
        <h2><i class="fas fa-edit"></i> प्रोफ़ाइल एडिट करें</h2>
        <form id="editProfileForm">
          <div class="form-group">
            <label>अवतार</label>
            <div style="display:flex;align-items:center;gap:12px;">
              <img id="avatarPreview" src="\( {user.avatar || ''}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid #d4a373; \){user.avatar ? '' : 'display:none;'}">
              <input type="file" id="avatarFile" accept="image/*" />
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
          <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px;">
            <h4><i class="fas fa-share-alt"></i> सोशल लिंक्स</h4>
            <div class="form-group"><label>Instagram</label><input type="text" id="editInstagram" value="${user.socialLinks?.instagram || ''}" /></div>
            <div class="form-group"><label>YouTube</label><input type="text" id="editYoutube" value="${user.socialLinks?.youtube || ''}" /></div>
            <div class="form-group"><label>Twitter</label><input type="text" id="editTwitter" value="${user.socialLinks?.twitter || ''}" /></div>
            <div class="form-group"><label>Website</label><input type="text" id="editWebsite" value="${user.socialLinks?.website || ''}" /></div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;"><i class="fas fa-save"></i> सहेजें</button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());

    const avatarFileInput = modal.querySelector('#avatarFile');
    const avatarPreview = modal.querySelector('#avatarPreview');
    avatarFileInput.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          avatarPreview.src = ev.target.result;
          avatarPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });

    modal.querySelector('#editProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      // Avatar upload first
      const avatarFile = avatarFileInput.files[0];
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
          website: document.getElementById('editWebsite').value
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
        showToast('❌ Update failed', 'error');
      }
    });
  } catch (err) {
    showToast('प्रोफ़ाइल लोड नहीं हुई', 'error');
  }
};

// ============================================================
// ===== CHANGE PASSWORD =====
// ============================================================
window.openChangePassword = function () {
  if (!currentUser) {
    showToast('कृपया लॉग इन करें', 'warning');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:450px;padding:28px;">
      <button class="close">&times;</button>
      <h2><i class="fas fa-key"></i> पासवर्ड बदलें</h2>
      <form id="changePasswordForm">
        <div class="form-group">
          <label>मौजूदा पासवर्ड</label>
          <input type="password" id="currentPassword" required />
        </div>
        <div class="form-group">
          <label>नया पासवर्ड</label>
          <input type="password" id="newPassword" required minlength="6" />
        </div>
        <div class="form-group">
          <label>नया पासवर्ड दोबारा</label>
          <input type="password" id="confirmPassword" required />
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;"><i class="fas fa-save"></i> पासवर्ड बदलें</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());

  modal.querySelector('#changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
      showToast('नए पासवर्ड मेल नहीं खाते', 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/auth/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('✅ पासवर्ड बदल गया!', 'success');
        modal.remove();
      } else {
        showToast(data.error || 'पासवर्ड बदलने में विफल', 'error');
      }
    } catch (err) {
      showToast('❌ सर्वर से कनेक्ट नहीं हो पाया', 'error');
    }
  });
};

// ============================================================
// ===== MY PRESETS / DOWNLOADS =====
// ============================================================
window.showMyPresets = async function () {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  try {
    const res = await fetch(`\( {API_URL}/users/ \){currentUser.id}/presets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed');
    const presets = await res.json();
    if (!presets.length) {
      showToast('आपने अभी तक कोई प्रीसेट अपलोड नहीं किया।', 'info');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <button class="close">&times;</button>
        <h2><i class="fas fa-cubes"></i> मेरे प्रीसेट</h2>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
          ${presets.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg,#f8f6f2);border-radius:12px;">
              <div><strong>${p.name}</strong> – \( {p.category} <span style="font-size:0.8rem;color:#888;">( \){p.status})</span></div>
              <button class="btn btn-sm btn-primary" onclick="window.openPresetModal('${p.id}')"><i class="fas fa-eye"></i> देखें</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());
  } catch (err) {
    showToast('प्रीसेट लोड नहीं हुए', 'error');
  }
};

window.showMyDownloads = async function () {
  if (!currentUser) {
    showToast('कृपया पहले लॉग इन करें', 'warning');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/users/me/downloads`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed');
    const presets = await res.json();
    if (!presets.length) {
      showToast('आपने अभी तक कोई प्रीसेट डाउनलोड नहीं किया।', 'info');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <button class="close">&times;</button>
        <h2><i class="fas fa-download"></i> मेरे डाउनलोड</h2>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
          ${presets.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg,#f8f6f2);border-radius:12px;">
              <div><strong>${p.name}</strong> – ${p.author}</div>
              <button class="btn btn-sm btn-primary" onclick="window.openPresetModal('${p.id}')"><i class="fas fa-eye"></i> देखें</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());
  } catch (err) {
    showToast('डाउनलोड लोड नहीं हुए', 'error');
  }
};

// ============================================================
// ===== SUBSCRIPTION / REFERRAL / NOTIFICATIONS =====
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
  } catch (err) {}
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
    const res = await fetch(`${API_URL}/users/ads/watched`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`✅ Ad watched! (${data.adWatchCount} total)`, 'success');
      await fetchSubscription();
    }
  } catch (err) {}
}

async function generateReferral() {
  try {
    const res = await fetch(`${API_URL}/users/referrals/generate`, {
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
  const link = `\( {window.location.origin}/?ref= \){code}`;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:380px;padding:24px;">
      <button class="close">&times;</button>
      <h2><i class="fas fa-link"></i> Referral Program</h2>
      <p>Share your code: <strong>${code}</strong></p>
      <p style="font-size:0.85rem;">Link: <a href="\( {link}" target="_blank" style="color:#d4a373;word-break:break-all;"> \){link}</a></p>
      <p style="font-size:0.85rem;">You have referred ${subscriptionData.referralCount || 0} users.</p>
      <button class="btn btn-primary" onclick="generateReferral()"><i class="fas fa-sync"></i> Generate Code</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());
}
window.showReferral = showReferral;

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
  } catch (err) {}
}

function updateNotificationUI() {
  const badge = document.getElementById('notifBadge');
  const unread = notifications.filter(n => !n.read).length;
  if (badge) {
    badge.style.display = unread > 0 ? 'inline' : 'none';
    badge.textContent = unread;
  }
}

function openNotifications() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:500px;padding:24px;">
      <button class="close">&times;</button>
      <h2><i class="fas fa-bell"></i> Inbox</h2>
      <div style="max-height:300px;overflow-y:auto;">
        ${notifications.length === 0
          ? '<p style="color:#888;">No notifications</p>'
          : notifications.map(n => `
            <div class="notif-item" data-id="\( {n.id}" style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer; \){n.read ? '' : 'background:#fef9e7;'}">
              <div style="font-size:0.9rem;">${n.message}</div>
              <div style="font-size:0.7rem;color:#888;">${new Date(n.createdAt).toLocaleString()}</div>
            </div>
          `).join('')}
      </div>
      <button class="btn btn-sm btn-primary" id="markAllRead" style="margin-top:10px;"><i class="fas fa-check-double"></i> Mark all as read</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close').addEventListener('click', () => modal.remove());

  modal.querySelector('#markAllRead').addEventListener('click', async () => {
    await fetch(`${API_URL}/users/notifications/read-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await fetchNotifications();
    modal.remove();
  });

  modal.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      await fetch(`\( {API_URL}/users/notifications/read/ \){item.dataset.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchNotifications();
    });
  });
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ============================================================
// ===== EARNINGS =====
// ============================================================
window.showEarnings = async function () {
  if (!currentUser) {
    showToast('Please login', 'warning');
    return;
  }
  try {
    const res = await fetch(`\( {API_URL}/users/ \){currentUser.id}/earnings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal" style="max-width:600px;padding:28px;">
        <button class="close">&times;</button>
        <h2><i class="fas fa-rupee-sign"></i> My Earnings</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0;">
          <div style="background:var(--bg);padding:12px;border-radius:10px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:700;color:#d4a373;">${data.totalImpressions}</div>
            <div style="font-size:0.75rem;">Impressions</div>
          </div>
          <div style="background:var(--bg);padding:12px;border-radius:10px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:700;color:#2a9d8f;">₹${data.totalRevenue.toFixed(2)}</div>
            <div style="font-size:0.75rem;">Earnings</div>
          </div>
          <div style="background:var(--bg);padding:12px;border-radius:10px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:700;color:#3498db;">${data.totalDownloads}</div>
            <div style="font-size:0.75rem;">Downloads</div>
          </div>
        </div>
        <h3>Preset Performance</h3>
        <div style="max-height:250px;overflow-y:auto;">
          ${data.presets.length === 0
            ? '<p style="color:#888;">No presets yet.</p>'
            : data.presets.map(p => `
              <div style="display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border);">
                <div><strong>${p.name}</strong></div>
                <div style="font-size:0.75rem;">₹${p.revenue.toFixed(2)}</div>
              </div>
            `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.close').addEventListener('click', () => modal.remove());
  } catch (err) {
    showToast('Failed to load earnings', 'error');
  }
};

// ============================================================
// ===== EXIT + URL ACTIONS =====
// ============================================================
function exitSite() {
  if (confirm('Are you sure you want to leave PresetHub?')) {
    window.close();
    window.location.href = 'about:blank';
  }
}

function handleUrlAction() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (!action) return;

  setTimeout(() => {
    switch (action) {
      case 'search':
        document.getElementById('searchInput')?.focus();
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
    }
    if (window.history?.replaceState) {
      window.history.replaceState({}, document.title, '/');
    }
  }, 500);
}

// ============================================================
// ===== INIT =====
// ============================================================
function init() {
  initDOM();
  loadPresets();
  loadLatestPresets();
  loadTopCreators();
  handleUrlAction();

  if (currentTheme === 'dark' && themeToggle) {
    themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
  }

  if (!navigator.onLine && offlineIndicator) {
    offlineIndicator.style.display = 'inline-block';
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('✅ SW registered'))
      .catch(err => console.error('❌ SW failed', err));
  }

  console.log('🚀 PresetHub frontend loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
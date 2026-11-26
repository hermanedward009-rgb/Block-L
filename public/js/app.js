const RENDER_BACKEND_URL = 'https://YOUR-RENDER-SERVICE.onrender.com';

const API_BASE_URL = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) {
    return '';
  }
  return RENDER_BACKEND_URL.replace(/\/+$/, '');
})();

function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function assetUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  return apiUrl(url);
}

async function apiFetch(path, options = {}) {
  return fetch(apiUrl(path), {
    credentials: 'include',
    ...options
  });
}

let CURRENT_USER = null;
let SOCKET_CLIENT = null;

async function initShell(activePage) {
  const res = await apiFetch('/api/me');
  if (!res.ok) {
    window.location.href = '/index.html';
    return null;
  }
  CURRENT_USER = await res.json();

  const adminLink = CURRENT_USER.role === 'admin'
    ? `<a href="/all-residents.html" class="nav-item ${activePage === 'all-residents' ? 'active' : ''}">All Residents</a>`
    : '';

  const shellHtml = `
    <div id="sidebarOverlay" class="sidebar-overlay" onclick="toggleSidebar(false)"></div>
    <aside id="appSidebar" class="sidebar">
      <div>
        <div class="auth-brand" style="padding-left: 6px;">
          <div class="brand-badge">L</div>
          <div>
            <div style="font-weight: 800; font-size: 17px; line-height: 1.2;">Block L</div>
            <div style="font-size: 12px; color: var(--text-muted);">${CURRENT_USER.role === 'admin' ? 'Administrator' : 'Room ' + CURRENT_USER.room}</div>
          </div>
        </div>
        <nav class="nav-links">
          <a href="/dashboard.html" class="nav-item ${activePage === 'dashboard' ? 'active' : ''}">Dashboard</a>
          ${adminLink}
          <a href="/profile.html" class="nav-item ${activePage === 'profile' ? 'active' : ''}">My Profile</a>
          <a href="/chat.html" class="nav-item ${activePage === 'chat' ? 'active' : ''}">Residents & Chat</a>
          <a href="/schedule.html" class="nav-item ${activePage === 'schedule' ? 'active' : ''}">Toilet Schedule</a>
          <a href="/electricity.html" class="nav-item ${activePage === 'electricity' ? 'active' : ''}">Electricity Bills</a>
          <a href="/announcements.html" class="nav-item ${activePage === 'announcements' ? 'active' : ''}">Announcements & Advice</a>
        </nav>
      </div>
      <button type="button" onclick="logoutUser()" class="btn btn-danger" style="width: 100%;">Logout</button>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <button type="button" class="menu-toggle-btn" onclick="toggleSidebar()" aria-label="Toggle Menu">☰</button>
          <h2 id="pageTitle" style="font-size: 18px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></h2>
        </div>
        <div class="topbar-right">
          <span class="live-pill" title="Real-time connection status">
            <span id="wsDot" class="live-dot" style="background: var(--warning);"></span>
            <span id="wsText">Connecting</span>
          </span>
          <button type="button" class="notif-btn" onclick="toggleNotifications()" title="Notifications">
            🔔
            <span class="notif-dot"></span>
          </button>
          <div id="notifDropdown" class="notif-dropdown">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px;">System Notifications</div>
            <div id="notifList">Loading...</div>
          </div>
          <a href="/profile.html" class="user-chip">
            <img src="${assetUrl(CURRENT_USER.avatar)}" alt="${CURRENT_USER.first_name}" class="user-avatar-sm" />
            <span style="font-size: 13px; font-weight: 600;">${CURRENT_USER.first_name}</span>
          </a>
        </div>
      </header>
      <main id="pageContent" class="content-container"></main>
    </div>

    <nav class="mobile-bottom-nav" aria-label="Quick Mobile Navigation">
      <a href="/dashboard.html" class="mobile-bottom-link ${activePage === 'dashboard' ? 'active' : ''}">Home</a>
      <a href="/chat.html" class="mobile-bottom-link ${activePage === 'chat' ? 'active' : ''}">Chat</a>
      <a href="/electricity.html" class="mobile-bottom-link ${activePage === 'electricity' ? 'active' : ''}">Power</a>
      <a href="/schedule.html" class="mobile-bottom-link ${activePage === 'schedule' ? 'active' : ''}">Toilets</a>
    </nav>
  `;

  document.body.innerHTML = `<div class="app-layout">${shellHtml}</div>`;
  loadNotifications();
  initSocket();
  return CURRENT_USER;
}

async function buildRemindersHtml(currentUser) {
  const [elecRes, schedRes] = await Promise.all([
    apiFetch('/api/electricity'),
    apiFetch('/api/schedule')
  ]);
  const elec = elecRes.ok ? await elecRes.json() : { currentRound: 1, remainingCount: 10, reminderActive: false };
  const slots = schedRes.ok ? await schedRes.json() : [];

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todaySlots = slots.filter(s => s.day_name === todayName);
  const mySlots = currentUser ? slots.filter(s => Number(s.assigned_user_id) === Number(currentUser.id)) : [];

  const toiletText = todaySlots.length
    ? todaySlots.map(s => `${s.toilet_type}: ${s.first_name ? `${s.first_name} (${s.room})` : 'Unassigned'}`).join(' • ')
    : `No cleaning slots set for ${todayName}.`;

  const personalNote = mySlots.length
    ? `Your assigned days: ${mySlots.map(s => `${s.day_name} (${s.toilet_type})`).join(', ')}.`
    : 'Check the weekly schedule for your assigned toilet.';

  const elecText = elec.reminderActive
    ? `Reminder: Only ${elec.remainingCount} room(s) left in Round #${elec.currentRound}.`
    : `Round #${elec.currentRound}: ${elec.remainingCount} of 10 rooms still unpaid.`;

  return `
    <div class="reminder-strip">
      <div class="reminder-card ${elec.reminderActive ? 'alert-mode' : ''}">
        <div>
          <span class="badge ${elec.reminderActive ? 'badge-warning' : 'badge-primary'}">Electricity Reminder</span>
          <div style="font-size: 13px; font-weight: 600; margin-top: 6px;">${elecText}</div>
        </div>
        <a href="/electricity.html" class="btn btn-sm btn-outline">Open</a>
      </div>
      <div class="reminder-card duty-mode">
        <div>
          <span class="badge badge-primary">Toilet Schedule (${todayName})</span>
          <div style="font-size: 13px; font-weight: 600; margin-top: 6px;">${toiletText}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${personalNote}</div>
        </div>
        <a href="/schedule.html" class="btn btn-sm btn-outline">Timetable</a>
      </div>
    </div>
  `;
}

function initSocket() {
  if (typeof io === 'undefined') return;
  const socketTarget = API_BASE_URL || window.location.origin;
  SOCKET_CLIENT = io(socketTarget, {
    withCredentials: true,
    transports: ['websocket', 'polling']
  });

  const dot = document.getElementById('wsDot');
  const txt = document.getElementById('wsText');

  SOCKET_CLIENT.on('connect', () => {
    if (dot) dot.style.background = 'var(--success)';
    if (txt) txt.textContent = 'Live';
    SOCKET_CLIENT.emit('join_block', { userId: CURRENT_USER.id, role: CURRENT_USER.role });
  });

  SOCKET_CLIENT.on('disconnect', () => {
    if (dot) dot.style.background = 'var(--danger)';
    if (txt) txt.textContent = 'Offline';
  });

  SOCKET_CLIENT.on('notification:new', () => {
    loadNotifications();
  });
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar || !overlay) return;
  const open = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
}

async function loadNotifications() {
  const res = await apiFetch('/api/notifications');
  if (!res.ok) return;
  const items = await res.json();
  const list = document.getElementById('notifList');
  if (!list) return;
  list.innerHTML = items.length
    ? items.map(n => `<div class="notif-item">${n.message}</div>`).join('')
    : '<div class="notif-item">No notifications yet.</div>';
}

function toggleNotifications() {
  document.getElementById('notifDropdown').classList.toggle('open');
}

async function logoutUser() {
  await apiFetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
}
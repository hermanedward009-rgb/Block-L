let CURRENT_USER = null;
let SOCKET_CLIENT = null;

async function initShell(activePage) {
  const res = await fetch('/api/me');
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
        <div class="auth-brand" style="margin-bottom: 10px; padding-left: 8px;">
          <div class="brand-badge">L</div>
          <div>
            <div style="font-weight: 800; font-size: 17px;">Block L</div>
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
      <button onclick="logoutUser()" class="btn btn-danger" style="width: 100%;">Logout</button>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <button class="menu-toggle-btn" onclick="toggleSidebar()" aria-label="Toggle Menu">☰</button>
          <h2 id="pageTitle" style="font-size: 18px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></h2>
        </div>
        <div class="topbar-right">
          <span class="live-pill" title="Real-time WebSocket status">
            <span id="wsDot" class="live-dot" style="background: var(--warning);"></span>
            <span id="wsText" class="live-label">Connecting</span>
          </span>
          <button class="notif-btn" onclick="toggleNotifications()" title="Notifications">
            🔔
            <span class="notif-dot"></span>
          </button>
          <div id="notifDropdown" class="notif-dropdown">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px;">System Notifications</div>
            <div id="notifList">Loading...</div>
          </div>
          <a href="/profile.html" class="user-chip">
            <img src="${CURRENT_USER.avatar}" alt="Avatar" class="user-avatar-sm" />
            <span style="font-size: 13px; font-weight: 600;">${CURRENT_USER.first_name}</span>
          </a>
        </div>
      </header>
      <main id="pageContent" class="content-container"></main>
    </div>
  `;

  document.body.innerHTML = `<div class="app-layout">${shellHtml}</div>`;
  loadNotifications();
  initSocket();
  return CURRENT_USER;
}

function initSocket() {
  if (typeof io === 'undefined') return;
  SOCKET_CLIENT = io();

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
  const res = await fetch('/api/notifications');
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
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
}
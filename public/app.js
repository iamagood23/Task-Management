(function () {
  'use strict';

  /* ============================================================
   *  Helpers
   * ============================================================ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const root = $('#root');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function icon(name, cls) {
    return `<svg class="icon${cls ? ' ' + cls : ''}"><use href="#i-${name}"></use></svg>`;
  }

  function todayStr() {
    return dateOffsetStr(0);
  }

  function dateOffsetStr(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    if (!y) return '';
    const dt = new Date(y, m - 1, d);
    const opts = { month: 'short', day: 'numeric' };
    if (y !== new Date().getFullYear()) opts.year = 'numeric';
    return dt.toLocaleDateString('en-US', opts);
  }

  function relTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const diffMin = Math.round((Date.now() - t) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const h = Math.round(diffMin / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function isOverdue(t) {
    return !!t.dueDate && t.dueDate < todayStr() && t.status !== 'done';
  }

  const PALETTE = ['#7b68ee', '#3a7de0', '#2ea36b', '#e8912b', '#e0432b', '#c23fc2', '#0aa3a3', '#c67c2e'];
  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ============================================================
   *  Constants
   * ============================================================ */
  const STATUSES = ['todo', 'in-progress', 'done'];
  const STATUS_LABEL = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
  const STATUS_VAR = { todo: '--status-todo', 'in-progress': '--status-progress', done: '--status-done' };
  const PRIORITIES = ['low', 'medium', 'high', 'critical'];
  const PRIO_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
  const PRIO_VAR = { low: '--prio-low', medium: '--prio-medium', high: '--prio-high', critical: '--prio-critical' };
  const NAV_ITEMS = [
    { id: 'home', label: 'Home', icon: 'inbox' },
    { id: 'all', label: 'My Tasks', icon: 'tasks' },
    { id: 'today', label: 'Today', icon: 'calendar' },
    { id: 'upcoming', label: 'Upcoming', icon: 'clock' },
    { id: 'completed', label: 'Completed', icon: 'check' },
    { id: 'archived', label: 'Archived', icon: 'archive' },
  ];
  const SECTION_TITLE = {
    home: 'Home', all: 'My Tasks', today: 'Today', upcoming: 'Upcoming',
    completed: 'Completed', archived: 'Archived',
  };
  const ACTIVITY_LABEL = {
    'task:created': 'created', 'task:completed': 'completed', 'task:moved': 'moved',
    'task:priority': 'changed priority on', 'task:archived': 'archived',
    'task:unarchived': 'restored', 'task:edited': 'edited', 'task:deleted': 'deleted',
  };
  function activityColor(type) {
    if (type === 'task:completed') return 'var(--success)';
    if (type === 'task:deleted' || type === 'task:archived') return 'var(--danger)';
    if (type === 'task:created') return 'var(--purple-500)';
    return 'var(--info)';
  }

  /* ============================================================
   *  State
   * ============================================================ */
  const state = {
    token: localStorage.getItem('tm_token') || null,
    user: null,
    tasks: [],
    activity: [],
    theme: localStorage.getItem('tm_theme') || 'light',
    authMode: 'login',
    authError: '',
    authBusy: false,
    section: 'home',
    view: 'list',
    search: '',
    collapsed: new Set(),
    panelTaskId: null,
    draft: null,
    modal: null,
    sidebarOpen: false,
    toasts: [],
    es: null,
  };

  document.documentElement.setAttribute('data-theme', state.theme);

  /* ============================================================
   *  API
   * ============================================================ */
  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (res.status === 401 && state.token) {
      forceLogout('Your session expired. Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }

  /* ============================================================
   *  Toasts
   * ============================================================ */
  function toast(message, type) {
    const id = Math.random().toString(36).slice(2);
    state.toasts.push({ id, message, type: type || 'default' });
    renderToasts();
    setTimeout(() => {
      state.toasts = state.toasts.filter((t) => t.id !== id);
      renderToasts();
    }, 3200);
  }

  function renderToasts() {
    const el = $('#toast-stack');
    if (!el) return;
    el.innerHTML = state.toasts.map((t) =>
      `<div class="toast ${t.type}">${esc(t.message)}</div>`
    ).join('');
  }

  /* ============================================================
   *  Boot / auth
   * ============================================================ */
  async function boot() {
    if (!state.token) return renderAuth();
    try {
      const me = await api('/api/me');
      state.user = me.user;
      await afterLogin();
    } catch (_) {
      state.token = null;
      localStorage.removeItem('tm_token');
      renderAuth();
    }
  }

  async function afterLogin() {
    try {
      const [tasksRes, activityRes, settingsRes] = await Promise.all([
        api('/api/tasks'),
        api('/api/activity?limit=100'),
        api('/api/settings'),
      ]);
      state.tasks = tasksRes.tasks;
      state.activity = activityRes.activity;
      if (settingsRes.settings && settingsRes.settings.theme) {
        state.theme = settingsRes.settings.theme;
        localStorage.setItem('tm_theme', state.theme);
        document.documentElement.setAttribute('data-theme', state.theme);
      }
      mountApp();
      connectSSE();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleAuthSubmit(form) {
    state.authError = '';
    state.authBusy = true;
    renderAuth();
    const mode = state.authMode;
    const email = form.email.value.trim();
    const password = form.password.value;
    const name = form.name ? form.name.value.trim() : undefined;
    try {
      const data = mode === 'login'
        ? await api('/api/auth/login', { method: 'POST', body: { email, password } })
        : await api('/api/auth/register', { method: 'POST', body: { name, email, password } });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('tm_token', state.token);
      await afterLogin();
    } catch (err) {
      state.authBusy = false;
      state.authError = err.message;
      renderAuth();
    }
  }

  function logout() {
    if (state.es) { try { state.es.close(); } catch (_) {} }
    state.token = null; state.user = null; state.tasks = []; state.activity = [];
    state.panelTaskId = null; state.draft = null; state.modal = null; state.section = 'home';
    localStorage.removeItem('tm_token');
    renderAuth();
  }

  let loggingOut = false;
  function forceLogout(message) {
    if (loggingOut) return;
    loggingOut = true;
    logout();
    if (message) toast(message, 'error');
    setTimeout(() => { loggingOut = false; }, 500);
  }

  function renderAuth() {
    const mode = state.authMode;
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo"><div class="logo-mark">T</div><div class="name">TaskFlow</div></div>
          <h1>${mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p class="auth-sub">${mode === 'login' ? 'Sign in to keep moving on your tasks.' : 'Start organizing your work in minutes.'}</p>
          ${state.authError ? `<div class="auth-error">${esc(state.authError)}</div>` : ''}
          <form id="auth-form">
            ${mode === 'register' ? `<div class="field"><label>Name</label><input class="input" name="name" required maxlength="80" placeholder="Ada Lovelace" /></div>` : ''}
            <div class="field"><label>Email</label><input class="input" name="email" type="email" required placeholder="you@example.com" /></div>
            <div class="field"><label>Password</label><input class="input" name="password" type="password" required minlength="6" placeholder="${mode === 'login' ? 'Your password' : 'At least 6 characters'}" /></div>
            <button class="btn btn-primary btn-block" type="submit" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Create account')}</button>
          </form>
          <div class="auth-toggle">
            ${mode === 'login'
              ? `Don't have an account? <button type="button" id="auth-switch">Sign up</button>`
              : `Already have an account? <button type="button" id="auth-switch">Sign in</button>`}
          </div>
        </div>
      </div>
    `;
    $('#auth-form').addEventListener('submit', (e) => { e.preventDefault(); handleAuthSubmit(e.target); });
    $('#auth-switch').addEventListener('click', () => {
      state.authMode = mode === 'login' ? 'register' : 'login';
      state.authError = '';
      renderAuth();
    });
  }

  /* ============================================================
   *  Realtime
   * ============================================================ */
  function connectSSE() {
    if (state.es) { try { state.es.close(); } catch (_) {} }
    const es = new EventSource('/api/events?token=' + encodeURIComponent(state.token));
    es.addEventListener('task:create', (e) => upsertTaskLocal(JSON.parse(e.data)));
    es.addEventListener('task:update', (e) => upsertTaskLocal(JSON.parse(e.data)));
    es.addEventListener('task:delete', (e) => removeTaskLocal(JSON.parse(e.data).id));
    es.addEventListener('activity:new', (e) => {
      state.activity.unshift(JSON.parse(e.data));
      state.activity = state.activity.slice(0, 200);
      if (state.section === 'home') renderContent();
    });
    state.es = es;
  }

  function upsertTaskLocal(t) {
    const idx = state.tasks.findIndex((x) => x.id === t.id);
    if (idx === -1) state.tasks.unshift(t); else state.tasks[idx] = t;
    if (state.panelTaskId === t.id) state.draft = { ...t };
    renderSidebar();
    renderContent();
    if (state.panelTaskId === t.id) renderPanel();
  }

  function removeTaskLocal(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (state.panelTaskId === id) { state.panelTaskId = null; state.draft = null; }
    renderSidebar();
    renderContent();
    renderPanel();
  }

  /* ============================================================
   *  Task mutations
   * ============================================================ */
  async function createTask(fields) {
    try {
      const data = await api('/api/tasks', { method: 'POST', body: fields });
      upsertTaskLocal(data.task);
      return data.task;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  }

  async function patchTask(id, patch) {
    try {
      const data = await api('/api/tasks/' + id, { method: 'PATCH', body: patch });
      upsertTaskLocal(data.task);
      return data.task;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  }

  async function deleteTask(id) {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    try {
      await api('/api/tasks/' + id, { method: 'DELETE' });
      state.tasks = state.tasks.filter((t) => t.id !== id);
      if (state.panelTaskId === id) { state.panelTaskId = null; state.draft = null; }
      renderSidebar();
      renderContent();
      renderPanel();
      toast('Task deleted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function nextStatus(cur) {
    return STATUSES[(STATUSES.indexOf(cur) + 1) % STATUSES.length];
  }

  /* ============================================================
   *  Derived data
   * ============================================================ */
  function counts() {
    const active = state.tasks.filter((t) => !t.archived);
    const today = todayStr();
    return {
      all: active.length,
      today: active.filter((t) => t.dueDate === today && t.status !== 'done').length,
      upcoming: active.filter((t) => t.dueDate && t.dueDate > today && t.status !== 'done').length,
      completed: active.filter((t) => t.status === 'done').length,
      archived: state.tasks.length - active.length,
    };
  }

  function tagStats() {
    const map = new Map();
    for (const t of state.tasks) {
      if (t.archived) continue;
      for (const tag of t.tags || []) map.set(tag, (map.get(tag) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function computeVisibleTasks(section, search) {
    let list = state.tasks.slice();
    if (section === 'archived') {
      list = list.filter((t) => t.archived);
    } else {
      list = list.filter((t) => !t.archived);
      const today = todayStr();
      if (section === 'today') list = list.filter((t) => t.dueDate === today && t.status !== 'done');
      else if (section === 'upcoming') list = list.filter((t) => t.dueDate && t.dueDate > today && t.status !== 'done');
      else if (section === 'completed') list = list.filter((t) => t.status === 'done');
      else if (section.startsWith('tag:')) {
        const tag = section.slice(4);
        list = list.filter((t) => (t.tags || []).includes(tag));
      }
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.tags || []).some((tg) => tg.includes(q))
      );
    }
    return list;
  }

  /* ============================================================
   *  Mount + render shell
   * ============================================================ */
  let eventsBound = false;

  function mountApp() {
    root.innerHTML = `
      <div class="app-shell">
        <div class="sidebar-scrim" id="sidebar-scrim" data-action="toggle-sidebar" hidden></div>
        <aside class="sidebar" id="sidebar"></aside>
        <div class="main-col">
          <header class="topbar" id="topbar"></header>
          <main class="content" id="content"></main>
        </div>
      </div>
      <div id="panel-root"></div>
      <div id="modal-root"></div>
    `;
    bindEvents();
    renderSidebar();
    renderTopbar();
    renderContent();
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    document.body.addEventListener('click', onGlobalClick);
    document.body.addEventListener('change', onGlobalChange);
    document.body.addEventListener('keydown', onGlobalKeydown);
    document.body.addEventListener('submit', onGlobalSubmit);
    document.body.addEventListener('input', debounce(onGlobalInput, 150));
    document.body.addEventListener('blur', onGlobalBlur, true);
  }

  /* ============================================================
   *  Sidebar
   * ============================================================ */
  function renderSidebar() {
    const el = $('#sidebar');
    if (!el) return;
    const c = counts();
    const tags = tagStats();
    const initials = (state.user.name || '?').trim().slice(0, 1).toUpperCase();
    el.innerHTML = `
      <div class="sidebar-header">
        <div class="logo-mark">T</div>
        <div class="name">TaskFlow</div>
      </div>
      <div class="sidebar-newtask">
        <button class="btn btn-primary" data-action="open-new-task">${icon('plus')} New Task</button>
      </div>
      <div class="sidebar-search">
        ${icon('search')}
        <input id="sidebar-search-input" placeholder="Search tasks…" value="${esc(state.search)}" />
      </div>
      <nav class="sidebar-nav">
        ${NAV_ITEMS.map((n) => `
          <button class="nav-item ${state.section === n.id ? 'active' : ''}" data-action="nav" data-section="${n.id}">
            ${icon(n.icon)}<span>${n.label}</span>
            ${n.id !== 'home' ? `<span class="count">${c[n.id]}</span>` : ''}
          </button>
        `).join('')}
      </nav>
      <div class="sidebar-section-title">Tags</div>
      <div class="tag-list">
        ${tags.length ? tags.map(([tag, n]) => `
          <button class="tag-item ${state.section === 'tag:' + tag ? 'active' : ''}" data-action="nav" data-section="tag:${esc(tag)}">
            <span class="tag-dot" style="background:${hashColor(tag)}"></span>
            <span>${esc(tag)}</span>
            <span class="count">${n}</span>
          </button>
        `).join('') : `<div class="tag-empty">No tags yet</div>`}
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="avatar" style="background:${hashColor(state.user.email || state.user.name)}">${esc(initials)}</div>
          <div class="who">
            <div class="n">${esc(state.user.name)}</div>
            <div class="e">${esc(state.user.email)}</div>
          </div>
        </div>
        <button class="icon-btn-dark" data-action="toggle-theme" title="Toggle theme">${icon(state.theme === 'dark' ? 'sun' : 'moon')}</button>
        <button class="icon-btn-dark" data-action="logout" title="Log out">${icon('logout')}</button>
      </div>
    `;
  }

  /* ============================================================
   *  Topbar
   * ============================================================ */
  function renderTopbar() {
    const el = $('#topbar');
    if (!el) return;
    const showViewToggle = state.section !== 'home';
    el.innerHTML = `
      <button class="mobile-menu-btn" data-action="toggle-sidebar">${icon('menu')}</button>
      <h2>${esc(SECTION_TITLE[state.section] || (state.section.startsWith('tag:') ? '#' + state.section.slice(4) : ''))}</h2>
      <div class="topbar-spacer"></div>
      ${showViewToggle ? `
      <div class="view-toggle">
        <button class="${state.view === 'list' ? 'active' : ''}" data-action="set-view" data-view="list">${icon('list')} List</button>
        <button class="${state.view === 'board' ? 'active' : ''}" data-action="set-view" data-view="board">${icon('columns')} Board</button>
      </div>` : ''}
      <button class="btn btn-primary" data-action="open-new-task">${icon('plus')} New Task</button>
    `;
  }

  /* ============================================================
   *  Content router
   * ============================================================ */
  function renderContent() {
    const el = $('#content');
    if (!el) return;
    if (state.section === 'home') { el.innerHTML = renderHome(); return; }
    const list = computeVisibleTasks(state.section, state.search);
    if (state.section === 'archived') { el.innerHTML = renderArchived(list); return; }
    el.innerHTML = state.view === 'board' ? renderBoard(list) : renderList(list, state.section);
  }

  /* ---------------- Home ---------------- */
  function renderHome() {
    const active = state.tasks.filter((t) => !t.archived);
    const total = active.length;
    const byStatus = { todo: 0, 'in-progress': 0, done: 0 };
    active.forEach((t) => byStatus[t.status]++);
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    const completionPct = pct(byStatus.done);

    const outstanding = active.filter((t) => t.status !== 'done');
    const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    outstanding.forEach((t) => byPriority[t.priority]++);
    const maxPriority = Math.max(1, ...Object.values(byPriority));

    const today = todayStr();
    const dueToday = active.filter((t) => t.dueDate === today && t.status !== 'done')
      .sort((a, b) => a.priority < b.priority ? 1 : -1);
    const upcoming = active.filter((t) => t.dueDate && t.dueDate > today && t.status !== 'done')
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .slice(0, 5);
    const recentlyCompleted = state.tasks.filter((t) => t.status === 'done' && !t.archived)
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
      .slice(0, 5);
    const recentActivity = state.activity.slice(0, 8);

    const last7 = Array.from({ length: 7 }, (_, i) => dateOffsetStr(6 - i));
    const counts7 = last7.map((day) => state.tasks.filter((t) => (t.completedAt || '').slice(0, 10) === day).length);
    const max7 = Math.max(1, ...counts7);

    return `
      <div class="content-narrow">
        <div class="home-greeting">Hey, ${esc((state.user.name || '').split(' ')[0] || 'there')} 👋</div>
        <p class="home-greeting-sub">Here's what's happening with your tasks.</p>
        <div class="stat-grid">
          <div class="stat-card"><div class="v">${total}</div><div class="l">Total tasks</div></div>
          <div class="stat-card"><div class="v">${byStatus.todo}</div><div class="l">To do</div>
            <div class="bar"><div style="width:${pct(byStatus.todo)}%;background:var(--status-todo)"></div></div></div>
          <div class="stat-card"><div class="v">${byStatus['in-progress']}</div><div class="l">In progress</div>
            <div class="bar"><div style="width:${pct(byStatus['in-progress'])}%;background:var(--status-progress)"></div></div></div>
          <div class="stat-card"><div class="v">${byStatus.done}</div><div class="l">Completed</div>
            <div class="bar"><div style="width:${pct(byStatus.done)}%;background:var(--status-done)"></div></div></div>
        </div>

        <div class="widgets-grid">
          <div class="panel-card">
            <div class="panel-card-head">${icon('flag', 'icon-sm')}&nbsp; Priority overview</div>
            <div class="panel-card-body" style="padding:8px 14px 12px">
              ${outstanding.length ? PRIORITIES.slice().reverse().map((p) => `
                <div class="priority-row">
                  <span class="plabel"><span class="tag-dot" style="background:var(${PRIO_VAR[p]})"></span>${PRIO_LABEL[p]}</span>
                  <span class="pbar-track"><span class="pbar-fill" style="width:${Math.round((byPriority[p] / maxPriority) * 100)}%;background:var(${PRIO_VAR[p]})"></span></span>
                  <span class="pcount">${byPriority[p]}</span>
                </div>
              `).join('') : `<div class="empty-row">No outstanding tasks.</div>`}
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-card-head">${icon('target', 'icon-sm')}&nbsp; Completion progress</div>
            <div class="panel-card-body" style="text-align:center;padding:16px 14px">
              <div class="progress-ring" style="--pct:${completionPct}">
                <div class="progress-ring-inner">
                  <div class="pr-pct">${completionPct}%</div>
                  <div class="pr-label">done</div>
                </div>
              </div>
              <div class="text-dim" style="font-size:12.5px;margin-top:10px">${byStatus.done} of ${total} tasks completed</div>
            </div>
          </div>

          <div class="panel-card widget-wide">
            <div class="panel-card-head">${icon('activity', 'icon-sm')}&nbsp; Productivity — completed per day</div>
            <div class="panel-card-body" style="padding:14px 20px 6px">
              <div class="bar-chart">
                ${last7.map((day, i) => `
                  <div class="bc-col">
                    <span class="bc-count">${counts7[i] || ''}</span>
                    <div class="bc-bar" style="height:${Math.max(4, Math.round((counts7[i] / max7) * 100))}%"></div>
                    <span class="bc-label">${DOW_SHORT[new Date(day + 'T00:00:00').getDay()]}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-card-head">${icon('calendar', 'icon-sm')}&nbsp; Due today</div>
            <div class="panel-card-body">
              ${dueToday.length ? dueToday.map(taskRow).join('') : `<div class="empty-row">Nothing due today. Nice.</div>`}
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-card-head">${icon('clock', 'icon-sm')}&nbsp; Upcoming deadlines</div>
            <div class="panel-card-body">
              ${upcoming.length ? upcoming.map(taskRow).join('') : `<div class="empty-row">Nothing on the horizon.</div>`}
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-card-head">${icon('check', 'icon-sm')}&nbsp; Recently completed</div>
            <div class="panel-card-body">
              ${recentlyCompleted.length ? recentlyCompleted.map(taskRow).join('') : `<div class="empty-row">Nothing completed yet.</div>`}
            </div>
          </div>

          <div class="panel-card widget-wide">
            <div class="panel-card-head">${icon('activity', 'icon-sm')}&nbsp; Recent activity</div>
            <div class="panel-card-body">
              ${recentActivity.length ? recentActivity.map((a) => `
                <div class="activity-row">
                  <span class="activity-dot" style="background:${activityColor(a.type)}"></span>
                  <div>
                    <div>You ${ACTIVITY_LABEL[a.type] || a.type} <strong>${esc(a.taskTitle || 'a task')}</strong></div>
                    <div class="t">${relTime(a.at)}</div>
                  </div>
                </div>
              `).join('') : `<div class="empty-row">No activity yet</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------- List (grouped) ---------------- */
  function taskRow(t) {
    const checked = t.status === 'done';
    return `
      <div class="task-row ${checked ? 'is-done' : ''}" data-action="open-task" data-id="${t.id}">
        <button class="row-check ${checked ? 'checked' : ''} ${t.status === 'in-progress' ? 'inprog' : ''}" data-action="cycle-status" data-id="${t.id}" title="Change status">${checked ? icon('check') : ''}</button>
        <div class="row-title">${esc(t.title)}</div>
        <div class="row-meta">
          ${(t.tags || []).slice(0, 2).map((tag) => `<span class="chip chip-tag">${esc(tag)}</span>`).join('')}
          ${t.checklist && t.checklist.length ? `<span class="cl-chip">${icon('tasks', 'icon-sm')} ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span>` : ''}
          <span class="prio-flag" style="color:var(${PRIO_VAR[t.priority]})" title="${PRIO_LABEL[t.priority]} priority">${icon('flag', 'icon-sm')}</span>
          ${t.dueDate ? `<span class="due-chip ${isOverdue(t) ? 'overdue' : ''}">${icon('calendar', 'icon-sm')} ${fmtDate(t.dueDate)}</span>` : ''}
        </div>
        <div class="row-actions">
          <button class="btn-icon btn-ghost" data-action="archive-task" data-id="${t.id}" title="Archive">${icon('archive', 'icon-sm')}</button>
          <button class="btn-icon btn-ghost" data-action="delete-task" data-id="${t.id}" title="Delete">${icon('trash', 'icon-sm')}</button>
        </div>
      </div>
    `;
  }

  function renderList(list, section) {
    const showQuickAdd = section === 'all';
    let groups = STATUSES.map((s) => ({ status: s, items: list.filter((t) => t.status === s) }));
    if (!showQuickAdd) groups = groups.filter((g) => g.items.length > 0);
    if (!groups.length) return `<div class="empty-row">No tasks here.</div>`;
    return groups.map((g) => {
      const collapsed = state.collapsed.has(g.status);
      return `
        <div class="task-group">
          <div class="task-group-head ${collapsed ? 'collapsed' : ''}" data-action="toggle-group" data-status="${g.status}">
            ${icon('chevron-down', 'chev')}
            <span class="status-dot" style="background:var(${STATUS_VAR[g.status]})"></span>
            <span class="glabel">${STATUS_LABEL[g.status]}</span>
            <span class="gcount">${g.items.length}</span>
          </div>
          ${collapsed ? '' : `
          <div class="task-group-body">
            ${g.items.map(taskRow).join('')}
            ${showQuickAdd ? `
            <div class="quick-add-row">
              ${icon('plus')}
              <input placeholder="Add task to ${STATUS_LABEL[g.status]}…" data-quick-add="${g.status}" />
            </div>` : ''}
          </div>`}
        </div>
      `;
    }).join('');
  }

  /* ---------------- Archived ---------------- */
  function renderArchived(list) {
    if (!list.length) return `<div class="empty-row">Nothing archived.</div>`;
    return `
      <div class="task-group-body">
        ${list.map((t) => `
          <div class="task-row" data-action="open-task" data-id="${t.id}">
            <span class="status-dot" style="background:var(${STATUS_VAR[t.status]})"></span>
            <div class="row-title">${esc(t.title)}</div>
            <div class="row-meta">
              <span class="prio-flag" style="color:var(${PRIO_VAR[t.priority]})">${icon('flag', 'icon-sm')}</span>
            </div>
            <div class="row-actions" style="opacity:1">
              <button class="btn btn-sm" data-action="archive-task" data-id="${t.id}">Restore</button>
              <button class="btn-icon btn-ghost" data-action="delete-task" data-id="${t.id}">${icon('trash', 'icon-sm')}</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /* ---------------- Board ---------------- */
  function boardCard(t) {
    return `
      <div class="board-card ${t.status === 'done' ? 'is-done' : ''}" draggable="true" data-id="${t.id}" data-action="open-task">
        <div class="bc-title">${esc(t.title)}</div>
        ${(t.tags || []).length ? `<div class="bc-tags">${t.tags.slice(0, 3).map((tag) => `<span class="chip chip-tag">${esc(tag)}</span>`).join('')}</div>` : ''}
        <div class="bc-foot">
          <span class="prio-flag" style="color:var(${PRIO_VAR[t.priority]})">${icon('flag', 'icon-sm')}</span>
          ${t.dueDate ? `<span class="due-chip ${isOverdue(t) ? 'overdue' : ''}">${icon('calendar', 'icon-sm')} ${fmtDate(t.dueDate)}</span>` : ''}
          ${t.checklist && t.checklist.length ? `<span class="cl-chip">${icon('tasks', 'icon-sm')} ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span>` : ''}
        </div>
      </div>
    `;
  }

  function renderBoard(list) {
    return `
      <div class="board">
        ${STATUSES.map((s) => {
          const items = list.filter((t) => t.status === s);
          return `
            <div class="board-col" data-status="${s}">
              <div class="board-col-head">
                <span class="status-dot" style="background:var(${STATUS_VAR[s]})"></span>
                ${STATUS_LABEL[s]} <span class="text-faint">${items.length}</span>
              </div>
              <div class="board-col-body" data-dropzone="${s}">
                ${items.map(boardCard).join('')}
              </div>
              <div class="board-add"><input placeholder="+ Add task" data-quick-add="${s}" /></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /* ============================================================
   *  Task detail panel
   * ============================================================ */
  function openPanel(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    state.panelTaskId = id;
    state.draft = { ...t };
    renderPanel();
  }

  function closePanel() {
    state.panelTaskId = null;
    state.draft = null;
    renderPanel();
  }

  function renderPanel() {
    const el = $('#panel-root');
    if (!el) return;
    const t = state.draft;
    if (!t) { el.innerHTML = ''; return; }
    const clDone = (t.checklist || []).filter((c) => c.done).length;
    const clTotal = (t.checklist || []).length;
    const clPct = clTotal ? Math.round((clDone / clTotal) * 100) : 0;

    el.innerHTML = `
      <div class="panel-scrim" id="panel-scrim"></div>
      <div class="task-panel">
        <div class="panel-head">
          <select class="status-select" data-field="status" style="color:var(${STATUS_VAR[t.status]});border-color:var(${STATUS_VAR[t.status]})">
            ${STATUSES.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
          </select>
          <div class="panel-head-spacer"></div>
          <button class="btn-icon btn-ghost" data-action="archive-toggle" title="${t.archived ? 'Restore' : 'Archive'}">${icon(t.archived ? 'reset' : 'archive')}</button>
          <button class="btn-icon btn-ghost" data-action="delete-task" data-id="${t.id}" title="Delete">${icon('trash')}</button>
          <button class="btn-icon btn-ghost" data-action="close-panel" title="Close">${icon('x')}</button>
        </div>
        <div class="panel-body">
          <input class="panel-title-input" data-field="title" value="${esc(t.title)}" placeholder="Task title" />

          <div class="panel-grid">
            <div class="field">
              <label>Priority</label>
              <select class="input" data-field="priority">
                ${PRIORITIES.map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${PRIO_LABEL[p]}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Recurring</label>
              <select class="input" data-field="recurring">
                ${['none', 'daily', 'weekly', 'monthly'].map((r) => `<option value="${r}" ${t.recurring === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Start date</label>
              <input class="input" type="date" data-field="startDate" value="${t.startDate || ''}" />
            </div>
            <div class="field">
              <label>Due date</label>
              <input class="input" type="date" data-field="dueDate" value="${t.dueDate || ''}" />
            </div>
            <div class="field">
              <label>Estimate (min)</label>
              <input class="input" type="number" min="0" data-field="estimateMinutes" value="${t.estimateMinutes || ''}" />
            </div>
          </div>

          <div class="field mb-0">
            <label>Tags</label>
            <div class="tags-editor">
              ${(t.tags || []).map((tag) => `
                <span class="tag-chip" style="background:${hashColor(tag)}22;color:${hashColor(tag)}">
                  ${esc(tag)}<button data-action="remove-tag" data-tag="${esc(tag)}">${icon('x', 'icon-sm')}</button>
                </span>
              `).join('')}
              <input id="tag-input" placeholder="Add tag, press Enter" />
            </div>
          </div>

          <div class="panel-section-title">Description</div>
          <textarea class="input" data-field="description" rows="4" placeholder="Add a description…">${esc(t.description)}</textarea>

          <div class="panel-section-title">Checklist ${clTotal ? `(${clDone}/${clTotal})` : ''}</div>
          ${clTotal ? `<div class="checklist-progress"><div style="width:${clPct}%"></div></div>` : ''}
          ${(t.checklist || []).map((c) => `
            <div class="cl-item ${c.done ? 'done' : ''}">
              <input type="checkbox" data-action="toggle-cl" data-clid="${c.id}" ${c.done ? 'checked' : ''} />
              <span class="txt">${esc(c.text)}</span>
              <button class="del" data-action="remove-cl" data-clid="${c.id}">${icon('x', 'icon-sm')}</button>
            </div>
          `).join('')}
          <div class="add-row">
            <input class="input" id="cl-input" placeholder="Add checklist item, press Enter" />
          </div>

          <div class="panel-section-title">Attachments</div>
          ${(t.attachments || []).map((a) => `
            <div class="attach-item">
              ${icon('copy', 'icon-sm')}
              <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.label || a.url)}</a>
              <button class="del" data-action="remove-attachment" data-atid="${a.id}">${icon('x', 'icon-sm')}</button>
            </div>
          `).join('') || `<div class="text-faint" style="font-size:13px;padding:4px 0 8px">No links attached.</div>`}
          <div class="add-row">
            <input class="input" id="attach-label" placeholder="Label" style="flex:0 0 40%" />
            <input class="input" id="attach-url" placeholder="https://…" />
            <button class="btn btn-sm" data-action="add-attachment">Add</button>
          </div>

          <div class="panel-section-title">Notes</div>
          <textarea class="input" data-field="notes" rows="3" placeholder="Private notes…">${esc(t.notes)}</textarea>

          <div class="panel-footer-meta">
            <span>Created ${fmtDate(t.createdAt && t.createdAt.slice(0, 10))}</span>
            <span>Updated ${fmtDate(t.updatedAt && t.updatedAt.slice(0, 10))}</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ============================================================
   *  New task modal
   * ============================================================ */
  function openNewTaskModal(defaults) {
    state.modal = { type: 'new-task', defaults: defaults || {} };
    renderModal();
  }

  function closeModal() {
    state.modal = null;
    renderModal();
  }

  function renderModal() {
    const el = $('#modal-root');
    if (!el) return;
    if (!state.modal) { el.innerHTML = ''; return; }
    const d = state.modal.defaults;
    el.innerHTML = `
      <div class="modal-scrim" id="modal-scrim">
        <div class="modal-card">
          <h3>New task</h3>
          <form id="new-task-form">
            <div class="field">
              <label>Title</label>
              <input class="input" name="title" required maxlength="200" autofocus placeholder="What needs to be done?" />
            </div>
            <div class="panel-grid">
              <div class="field">
                <label>Status</label>
                <select class="input" name="status">
                  ${STATUSES.map((s) => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label>Priority</label>
                <select class="input" name="priority">
                  ${PRIORITIES.map((p) => `<option value="${p}" ${p === 'medium' ? 'selected' : ''}>${PRIO_LABEL[p]}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label>Due date</label>
              <input class="input" type="date" name="dueDate" />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" data-action="close-modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Create task</button>
            </div>
          </form>
        </div>
      </div>
    `;
    const input = $('#new-task-form input[name="title"]');
    if (input) input.focus();
  }

  /* ============================================================
   *  Global event delegation
   * ============================================================ */
  function onGlobalClick(e) {
    if (e.target.id === 'modal-scrim') { closeModal(); return; }
    if (e.target.id === 'panel-scrim') { closePanel(); return; }
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const act = target.dataset.action;
    const id = target.dataset.id;

    if (act === 'nav') {
      state.section = target.dataset.section;
      state.search = '';
      state.sidebarOpen = false;
      renderSidebar(); renderTopbar(); renderContent();
      $('#sidebar').classList.remove('open');
      $('#sidebar-scrim').hidden = true;
      return;
    }
    if (act === 'toggle-sidebar') {
      state.sidebarOpen = !state.sidebarOpen;
      $('#sidebar').classList.toggle('open', state.sidebarOpen);
      $('#sidebar-scrim').hidden = !state.sidebarOpen;
      return;
    }
    if (act === 'toggle-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      localStorage.setItem('tm_theme', state.theme);
      api('/api/settings', { method: 'PATCH', body: { theme: state.theme } }).catch(() => {});
      renderSidebar();
      return;
    }
    if (act === 'logout') { logout(); return; }
    if (act === 'set-view') { state.view = target.dataset.view; renderTopbar(); renderContent(); return; }
    if (act === 'open-new-task') { openNewTaskModal({ status: state.section === 'all' || state.section === 'home' ? 'todo' : undefined }); return; }
    if (act === 'close-modal') { closeModal(); return; }
    if (act === 'open-task') { openPanel(id || target.dataset.id); return; }
    if (act === 'close-panel') { closePanel(); return; }
    if (act === 'toggle-group') {
      const s = target.dataset.status;
      if (state.collapsed.has(s)) state.collapsed.delete(s); else state.collapsed.add(s);
      renderContent();
      return;
    }
    if (act === 'cycle-status') { patchTask(id, { status: nextStatus(state.tasks.find((t) => t.id === id).status) }); return; }
    if (act === 'archive-task') {
      const t = state.tasks.find((x) => x.id === id);
      patchTask(id, { archived: !(t && t.archived) });
      return;
    }
    if (act === 'delete-task') { deleteTask(id || state.panelTaskId); return; }
    if (act === 'archive-toggle') { patchTask(state.panelTaskId, { archived: !state.draft.archived }); return; }
    if (act === 'remove-tag') {
      const tags = (state.draft.tags || []).filter((t) => t !== target.dataset.tag);
      patchTask(state.panelTaskId, { tags });
      return;
    }
    if (act === 'remove-cl') {
      const checklist = (state.draft.checklist || []).filter((c) => c.id !== target.dataset.clid);
      patchTask(state.panelTaskId, { checklist });
      return;
    }
    if (act === 'remove-attachment') {
      const attachments = (state.draft.attachments || []).filter((a) => a.id !== target.dataset.atid);
      patchTask(state.panelTaskId, { attachments });
      return;
    }
    if (act === 'add-attachment') {
      const label = $('#attach-label').value.trim();
      const url = $('#attach-url').value.trim();
      if (!url) return;
      const attachments = [...(state.draft.attachments || []), { label, url }];
      patchTask(state.panelTaskId, { attachments });
      return;
    }
  }

  function onGlobalChange(e) {
    const field = e.target.closest('[data-field]');
    if (field && state.panelTaskId) {
      const key = field.dataset.field;
      let val = field.value;
      if (key === 'estimateMinutes') val = val ? Number(val) : null;
      if ((key === 'dueDate' || key === 'startDate') && !val) val = null;
      patchTask(state.panelTaskId, { [key]: val });
      return;
    }
    if (e.target.id === 'sidebar-search-input') {
      state.search = e.target.value;
      renderContent();
    }
  }

  function onGlobalInput(e) {
    if (e.target.id === 'sidebar-search-input') {
      state.search = e.target.value;
      renderContent();
    }
  }

  function onGlobalBlur(e) {
    const field = e.target && e.target.closest && e.target.closest('[data-field]');
    if (!field || !state.panelTaskId) return;
    const key = field.dataset.field;
    if (key !== 'title' && key !== 'description' && key !== 'notes') return;
    const t = state.tasks.find((x) => x.id === state.panelTaskId);
    if (t && t[key] === field.value) return;
    if (key === 'title' && !field.value.trim()) { field.value = t ? t.title : ''; return; }
    patchTask(state.panelTaskId, { [key]: field.value });
  }

  function onGlobalKeydown(e) {
    if (e.key === 'Escape') {
      if (state.modal) { closeModal(); return; }
      if (state.panelTaskId) { closePanel(); return; }
    }
    if (e.key !== 'Enter') return;

    if (e.target.matches('[data-quick-add]')) {
      const title = e.target.value.trim();
      if (!title) return;
      e.target.value = '';
      createTask({ title, status: e.target.dataset.quickAdd });
      return;
    }
    if (e.target.id === 'tag-input') {
      const raw = e.target.value.trim().toLowerCase().replace(/\s+/g, '-');
      if (!raw) return;
      e.target.value = '';
      const tags = state.draft.tags || [];
      if (!tags.includes(raw)) patchTask(state.panelTaskId, { tags: [...tags, raw] });
      return;
    }
    if (e.target.id === 'cl-input') {
      const text = e.target.value.trim();
      if (!text) return;
      e.target.value = '';
      const checklist = [...(state.draft.checklist || []), { text, done: false }];
      patchTask(state.panelTaskId, { checklist });
      return;
    }
  }

  function onGlobalSubmit(e) {
    if (e.target.id === 'new-task-form') {
      e.preventDefault();
      const f = e.target;
      const title = f.title.value.trim();
      if (!title) return;
      const fields = { title, status: f.status.value, priority: f.priority.value };
      if (f.dueDate.value) fields.dueDate = f.dueDate.value;
      createTask(fields).then((t) => { if (t) { closeModal(); openPanel(t.id); } });
    }
  }

  document.body.addEventListener('change', (e) => {
    if (e.target.matches('[data-clid]') && e.target.type === 'checkbox') {
      const checklist = (state.draft.checklist || []).map((c) =>
        c.id === e.target.dataset.clid ? { ...c, done: e.target.checked } : c
      );
      patchTask(state.panelTaskId, { checklist });
    }
  });

  /* ---------------- Board drag & drop ---------------- */
  document.body.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.board-card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    card.classList.add('dragging');
  });
  document.body.addEventListener('dragend', (e) => {
    const card = e.target.closest('.board-card');
    if (card) card.classList.remove('dragging');
  });
  document.body.addEventListener('dragover', (e) => {
    const col = e.target.closest('.board-col-body');
    if (!col) return;
    e.preventDefault();
    col.closest('.board-col').classList.add('drag-over');
  });
  document.body.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.board-col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });
  document.body.addEventListener('drop', (e) => {
    const col = e.target.closest('.board-col-body');
    if (!col) return;
    e.preventDefault();
    col.closest('.board-col').classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const status = col.dataset.dropzone;
    const t = state.tasks.find((x) => x.id === id);
    if (t && t.status !== status) patchTask(id, { status });
  });

  /* ============================================================
   *  Go
   * ============================================================ */
  boot();
})();

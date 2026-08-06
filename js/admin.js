import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = id => document.getElementById(id);

const state = {
  supabase: null,
  tasks: [],
  searches: [],
  scrapById: new Map(),
  inventoryById: new Map(),
  activeTab: 'open'
};

function getClient() {
  const config = window.PAGE_STEEL_SUPABASE;
  if (!config?.url || !config?.publishableKey || config.url.includes('PASTE_')) {
    throw new Error('Supabase is not configured.');
  }

  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

async function load() {
  state.supabase = getClient();

  $('adminName').value =
    localStorage.getItem('pageSteelAdminName') || '';

  $('adminName').addEventListener('input', event => {
    localStorage.setItem('pageSteelAdminName', event.target.value.trim());
  });

  $('refreshAdmin').addEventListener('click', refresh);
  $('showOpenTab').addEventListener('click', () => setTab('open'));
  $('showResolvedTab').addEventListener('click', () => setTab('resolved'));
  $('showSearchesTab').addEventListener('click', () => setTab('searches'));

  await refresh();
}

async function refresh() {
  setStatus('Refreshing…');

  const [tasksResult, searchesResult, scrapResult, inventoryResult] =
    await Promise.all([
      state.supabase
        .from('review_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(250),

      state.supabase
        .from('search_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),

      state.supabase
        .from('material_records')
        .select('id,title,image_url,captured_at,updated_at,employee_name')
        .eq('status', 'current'),

      state.supabase
        .from('inventory_records')
        .select('*')
    ]);

  const error =
    tasksResult.error ||
    searchesResult.error ||
    scrapResult.error ||
    inventoryResult.error;

  if (error) throw error;

  state.tasks = tasksResult.data || [];
  state.searches = searchesResult.data || [];
  state.scrapById = new Map(
    (scrapResult.data || []).map(record => [record.id, record])
  );
  state.inventoryById = new Map(
    (inventoryResult.data || []).map(record => [record.id, record])
  );

  renderAll();
  setStatus('Work queue is current.');
}

function renderAll() {
  const openTasks = state.tasks.filter(task => task.status === 'open');
  const resolvedTasks = state.tasks.filter(task =>
    task.status === 'completed' || task.status === 'dismissed'
  );

  renderOpenTasks(openTasks);
  renderResolvedTasks(resolvedTasks);
  renderStaleScrap([...state.scrapById.values()]);
  renderSearches(state.searches);

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  $('openTaskCount').textContent = openTasks.length;
  $('resolvedTaskCount').textContent = resolvedTasks.length;
  $('todaySearchCount').textContent = state.searches.filter(search =>
    new Date(search.created_at).getTime() >= todayStart
  ).length;

  $('openBadge').textContent = openTasks.length;
  $('resolvedBadge').textContent = resolvedTasks.length;
  $('searchBadge').textContent = state.searches.length;
}

function renderOpenTasks(tasks) {
  const container = $('openTasks');
  container.innerHTML = '';

  if (!tasks.length) {
    container.innerHTML =
      '<p class="empty-state">Nothing needs attention.</p>';
    return;
  }

  tasks.forEach(task => {
    container.appendChild(buildTaskCard(task, false));
  });
}

function renderResolvedTasks(tasks) {
  const container = $('resolvedTasks');
  container.innerHTML = '';

  if (!tasks.length) {
    container.innerHTML =
      '<p class="empty-state">No resolved alerts yet.</p>';
    return;
  }

  tasks.forEach(task => {
    container.appendChild(buildTaskCard(task, true));
  });
}

function buildTaskCard(task, resolved) {
  const record = getTaskRecord(task);
  const title =
    record?.inventory_number ||
    record?.title ||
    task.description ||
    'Search alert';

  const card = document.createElement('article');
  card.className =
    `simple-alert-card ${task.priority} ${resolved ? task.status : ''}`;

  const updateLink = getUpdateLink(task, record);

  card.innerHTML = `
    <div class="alert-topline">
      <div>
        <p class="alert-type">${esc(reasonLabel(task.reason))}</p>
        <h3>${esc(title)}</h3>
      </div>
      <span class="freshness-badge ${resolved ? 'current' : task.record_type === 'inventory' ? 'inventory' : 'stale'}">
        ${resolved ? 'Resolved' : esc(task.priority)}
      </span>
    </div>

    <p class="alert-description">${esc(task.description || 'No description was recorded.')}</p>

    <p class="alert-meta">
      Created ${esc(formatDateTime(task.created_at))}
      ${task.created_by ? ` by ${esc(task.created_by)}` : ''}
    </p>

    ${resolved ? `
      <p class="alert-meta">
        Resolved ${esc(formatDateTime(task.completed_at || task.updated_at))}
        ${task.completed_by ? ` by ${esc(task.completed_by)}` : ''}
      </p>
    ` : ''}

    <div class="alert-actions">
      ${updateLink ? `
        <a class="secondary-button" href="${updateLink}">
          ${task.record_type === 'inventory' ? 'Open inventory record' : 'Open photo updater'}
        </a>
      ` : ''}

      ${resolved ? `
        <button type="button" class="primary-button reopen-task">
          Reopen alert
        </button>
      ` : `
        <button type="button" class="primary-button resolve-task">
          Mark resolved
        </button>
      `}
    </div>

    <details class="alert-details">
      <summary>View full details</summary>
      <p><strong>Status:</strong> ${esc(task.status)}</p>
      <p><strong>Priority:</strong> ${esc(task.priority)}</p>
      <p><strong>Photo required:</strong> ${task.requires_photo ? 'Yes' : 'No'}</p>
      <p><strong>Count required:</strong> ${task.requires_count ? 'Yes' : 'No'}</p>
      <p><strong>Record type:</strong> ${esc(task.record_type || 'search')}</p>
      ${record?.location_code ? `<p><strong>Location:</strong> ${esc(record.location_code)}</p>` : ''}
      ${record?.exact_quantity != null ? `<p><strong>Quantity:</strong> ${esc(record.exact_quantity)} ${esc(record.quantity_unit || '')}</p>` : ''}
    </details>
  `;

  const resolveButton = card.querySelector('.resolve-task');
  if (resolveButton) {
    resolveButton.addEventListener('click', () => resolveTask(task.id));
  }

  const reopenButton = card.querySelector('.reopen-task');
  if (reopenButton) {
    reopenButton.addEventListener('click', () => reopenTask(task.id));
  }

  return card;
}

function getTaskRecord(task) {
  if (task.record_type === 'scrap') {
    return state.scrapById.get(task.record_id);
  }

  if (task.record_type === 'inventory') {
    return state.inventoryById.get(task.record_id);
  }

  return null;
}

function getUpdateLink(task, record) {
  if (task.record_type === 'inventory') {
    const number = record?.inventory_number;
    return number
      ? `inventory-add.html?v=11&inventory=${encodeURIComponent(number)}`
      : 'inventory-add.html?v=11';
  }

  if (task.record_type === 'scrap') {
    return 'collect.html?v=11';
  }

  return '';
}

function renderStaleScrap(records) {
  const stale = records
    .map(record => ({
      ...record,
      age: daysOld(record.captured_at || record.updated_at)
    }))
    .filter(record => record.age != null && record.age > 90)
    .sort((a, b) => b.age - a.age);

  const container = $('staleScrap');
  container.innerHTML = '';

  if (!stale.length) {
    container.innerHTML =
      '<p class="empty-state">No scrap photos are older than 90 days.</p>';
    return;
  }

  stale.forEach(record => {
    const card = document.createElement('article');
    card.className = 'simple-alert-card';

    card.innerHTML = `
      <div class="alert-topline">
        <div>
          <p class="alert-type">Old scrap photo</p>
          <h3>${esc(record.title)}</h3>
        </div>
        <span class="freshness-badge stale">${record.age} days</span>
      </div>
      <p class="alert-meta">
        Last updated by ${esc(record.employee_name || 'unknown employee')}.
      </p>
      <div class="alert-actions">
        <a class="secondary-button" href="collect.html?v=11">
          Replace photo
        </a>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderSearches(searches) {
  const container = $('recentSearches');
  container.innerHTML = '';

  if (!searches.length) {
    container.innerHTML =
      '<p class="empty-state">No searches have been recorded.</p>';
    return;
  }

  searches.forEach(search => {
    const terms = [
      search.material,
      search.profile,
      search.query_text
    ].filter(Boolean).join(' / ');

    const card = document.createElement('article');
    card.className = 'simple-alert-card search-history-card';

    card.innerHTML = `
      <div class="alert-topline">
        <div>
          <p class="alert-type">${esc(search.search_mode)} search</p>
          <h3>${esc(search.employee_name)}</h3>
        </div>
        <span class="freshness-badge ${search.completed ? 'current' : search.search_mode === 'inventory' ? 'inventory' : 'stale'}">
          ${search.completed ? 'Completed' : `${search.results_count} result${search.results_count === 1 ? '' : 's'}`}
        </span>
      </div>
      <p class="alert-description">${esc(terms || 'General search')}</p>
      <p class="alert-meta">
        ${esc(formatDateTime(search.created_at))}
        ${search.inventory_action ? ` · Action: ${esc(search.inventory_action)}` : ''}
      </p>
    `;

    container.appendChild(card);
  });
}

async function resolveTask(id) {
  const adminName = requireAdminName();
  if (!adminName) return;

  const now = new Date().toISOString();
  const { error } = await state.supabase
    .from('review_tasks')
    .update({
      status: 'completed',
      completed_at: now,
      completed_by: adminName,
      updated_at: now
    })
    .eq('id', id);

  if (error) {
    setStatus(error.message, true);
    return;
  }

  await refresh();
}

async function reopenTask(id) {
  const adminName = requireAdminName();
  if (!adminName) return;

  const now = new Date().toISOString();
  const { error } = await state.supabase
    .from('review_tasks')
    .update({
      status: 'open',
      completed_at: null,
      completed_by: null,
      updated_at: now
    })
    .eq('id', id);

  if (error) {
    setStatus(error.message, true);
    return;
  }

  setTab('open');
  await refresh();
  setStatus(`Alert reopened by ${adminName}.`);
}

function requireAdminName() {
  const adminName = $('adminName').value.trim();

  if (!adminName) {
    setStatus(
      'Enter the administrator name before resolving or reopening an alert.',
      true
    );
    $('adminName').focus();
    return '';
  }

  localStorage.setItem('pageSteelAdminName', adminName);
  return adminName;
}

function setTab(tab) {
  state.activeTab = tab;

  $('openPanel').classList.toggle('hidden', tab !== 'open');
  $('resolvedPanel').classList.toggle('hidden', tab !== 'resolved');
  $('searchesPanel').classList.toggle('hidden', tab !== 'searches');

  $('showOpenTab').classList.toggle('active', tab === 'open');
  $('showResolvedTab').classList.toggle('active', tab === 'resolved');
  $('showSearchesTab').classList.toggle('active', tab === 'searches');
}

function reasonLabel(reason) {
  const labels = {
    scrap_photo_stale: 'Scrap photo needs replacement',
    scrap_search_no_results: 'Scrap search found nothing',
    inventory_search_requires_update: 'Inventory update not completed',
    inventory_search_no_results: 'Inventory search found nothing'
  };

  return labels[reason] || (reason || 'Alert').replaceAll('_', ' ');
}

function daysOld(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function formatDateTime(value) {
  if (!value) return 'unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

function esc(value) {
  return (value ?? '').toString().replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function setStatus(message, isError = false) {
  $('adminStatus').textContent = message;
  $('adminStatus').classList.toggle('error-status', isError);
}

load().catch(error => {
  console.error(error);
  setStatus(error.message || 'Could not load the work queue.', true);
});

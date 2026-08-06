import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = id => document.getElementById(id);

let supabase;

function getClient() {
  const config = window.PAGE_STEEL_SUPABASE;

  if (
    !config?.url ||
    !config?.publishableKey ||
    config.url.includes('PASTE_')
  ) {
    throw new Error('Supabase is not configured.');
  }

  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

async function load() {
  supabase = getClient();

  $('adminName').value =
    localStorage.getItem('pageSteelAdminName') || '';

  $('adminName').addEventListener('input', event => {
    localStorage.setItem(
      'pageSteelAdminName',
      event.target.value.trim()
    );
  });

  $('refreshAdmin').addEventListener('click', refresh);

  await refresh();
}

async function refresh() {
  setStatus('Refreshing dashboard…');

  const [
    tasksResult,
    searchesResult,
    scrapResult,
    inventoryResult
  ] = await Promise.all([
    supabase
      .from('review_tasks')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false }),

    supabase
      .from('search_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),

    supabase
      .from('material_records')
      .select('id,title,image_url,captured_at,updated_at,employee_name')
      .eq('status', 'current'),

    supabase
      .from('inventory_records')
      .select('*')
      .eq('status', 'current')
  ]);

  const error =
    tasksResult.error ||
    searchesResult.error ||
    scrapResult.error ||
    inventoryResult.error;

  if (error) throw error;

  const tasks = tasksResult.data || [];
  const searches = searchesResult.data || [];
  const scrapRecords = scrapResult.data || [];
  const inventoryRecords = inventoryResult.data || [];

  const scrapById = new Map(
    scrapRecords.map(record => [record.id, record])
  );

  const inventoryById = new Map(
    inventoryRecords.map(record => [record.id, record])
  );

  const staleScrap = scrapRecords
    .map(record => ({
      ...record,
      age: daysOld(record.captured_at || record.updated_at)
    }))
    .filter(record => record.age != null && record.age > 90)
    .sort((a, b) => b.age - a.age);

  renderTasks(tasks, scrapById, inventoryById);
  renderStale(staleScrap);
  renderSearches(searches);

  const now = new Date();

  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const searchesToday = searches.filter(search => (
    new Date(search.created_at).getTime() >= todayStart
  )).length;

  const urgent = tasks.filter(task => (
    task.priority === 'high' ||
    task.priority === 'urgent'
  )).length;

  $('openTaskCount').textContent = tasks.length;
  $('urgentTaskCount').textContent = urgent;
  $('staleScrapCount').textContent = staleScrap.length;
  $('todaySearchCount').textContent = searchesToday;

  $('taskBadge').textContent = tasks.length;
  $('staleBadge').textContent = staleScrap.length;
  $('searchBadge').textContent = searches.length;

  setStatus('Dashboard current.');
}

function renderTasks(tasks, scrapById, inventoryById) {
  const container = $('reviewTasks');
  container.innerHTML = '';

  if (!tasks.length) {
    container.innerHTML =
      '<p class="empty-state">No open alerts.</p>';

    return;
  }

  tasks.forEach(task => {
    const record =
      task.record_type === 'scrap'
        ? scrapById.get(task.record_id)
        : task.record_type === 'inventory'
          ? inventoryById.get(task.record_id)
          : null;

    const title =
      record?.inventory_number ||
      record?.title ||
      'Search alert';

    const updateLink =
      task.record_type === 'inventory'
        ? 'inventory-add.html?v=10'
        : 'collect.html?v=10';

    const card = document.createElement('article');

    card.className =
      `admin-task priority-${task.priority}`;

    card.innerHTML = `
      <div>
        <p class="score">
          ${esc(task.priority.toUpperCase())}
          ·
          ${esc(reasonLabel(task.reason))}
        </p>

        <h3>${esc(title)}</h3>

        <p>${esc(task.description || '')}</p>

        <p>
          Created ${esc(formatDateTime(task.created_at))}
          ${task.created_by
            ? ` by ${esc(task.created_by)}`
            : ''}
        </p>

        <p>
          ${task.requires_photo ? 'Photo required. ' : ''}
          ${task.requires_count ? 'Count required.' : ''}
        </p>

        <div class="button-row">
          <a class="secondary-button" href="${updateLink}">
            Open updater
          </a>

          <button
            type="button"
            class="text-button resolve-task"
          >
            Mark resolved
          </button>
        </div>
      </div>
    `;

    card
      .querySelector('.resolve-task')
      .addEventListener(
        'click',
        () => resolveTask(task.id)
      );

    container.appendChild(card);
  });
}

function renderStale(records) {
  const container = $('staleScrap');
  container.innerHTML = '';

  if (!records.length) {
    container.innerHTML =
      '<p class="empty-state">No stale scrap photographs.</p>';

    return;
  }

  records.forEach(record => {
    const card = document.createElement('article');
    card.className = 'admin-task';

    card.innerHTML = `
      ${record.image_url
        ? `<img src="${esc(record.image_url)}" alt="${esc(record.title)}">`
        : ''}

      <div>
        <h3>${esc(record.title)}</h3>

        <p>
          Photo approximately ${record.age} days old.
        </p>

        <p>
          Last updated by
          ${esc(record.employee_name || 'unknown employee')}.
        </p>

        <a
          class="secondary-button"
          href="collect.html?v=10"
        >
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
      '<p class="empty-state">No searches logged yet.</p>';

    return;
  }

  searches.forEach(search => {
    const card = document.createElement('article');
    card.className = 'search-log-row';

    const terms = [
      search.material,
      search.profile,
      search.query_text
    ].filter(Boolean).join(' / ');

    card.innerHTML = `
      <div>
        <strong>${esc(search.employee_name)}</strong>

        <span class="freshness-badge ${
          search.search_mode === 'inventory'
            ? 'inventory'
            : 'current'
        }">
          ${esc(search.search_mode)}
        </span>

        <p>${esc(terms || 'General search')}</p>

        <p>
          ${search.results_count}
          result${search.results_count === 1 ? '' : 's'}
          ·
          ${esc(formatDateTime(search.created_at))}
          ${search.completed ? ' · completed' : ''}
        </p>
      </div>
    `;

    container.appendChild(card);
  });
}

async function resolveTask(id) {
  const adminName = $('adminName').value.trim();

  if (!adminName) {
    setStatus(
      'Enter the administrator name before resolving alerts.',
      true
    );

    return;
  }

  const now = new Date().toISOString();

  const { error } = await supabase
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

function reasonLabel(reason) {
  const labels = {
    scrap_photo_stale: 'Scrap photo refresh',
    scrap_search_no_results:
      'Scrap search returned no results',
    inventory_search_requires_update:
      'Incomplete inventory update',
    inventory_search_no_results:
      'Inventory search returned no results'
  };

  return labels[reason] || reason.replaceAll('_', ' ');
}

function daysOld(value) {
  if (!value) return null;

  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) return null;

  return Math.max(
    0,
    Math.floor((Date.now() - time) / 86400000)
  );
}

function formatDateTime(value) {
  if (!value) return 'unknown time';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

function esc(value) {
  return (value ?? '')
    .toString()
    .replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
}

function setStatus(message, isError = false) {
  $('adminStatus').textContent = message;
  $('adminStatus').classList.toggle(
    'error-status',
    isError
  );
}

load().catch(error => {
  console.error(error);

  setStatus(
    error.message ||
      'Could not load the admin dashboard.',
    true
  );
});

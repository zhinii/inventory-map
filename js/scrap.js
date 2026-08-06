import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const state = {
  supabase: null,
  site: null,
  taxonomy: null,
  records: [],
  map: null,
  markers: new Map(),
  boundary: null,
  searchEventId: null
};

const $ = id => document.getElementById(id);

const norm = value => (value ?? '')
  .toString()
  .toLowerCase()
  .replace(/[-_/]/g, ' ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function getClient() {
  const config = window.PAGE_STEEL_SUPABASE;
  if (!config?.url || !config?.publishableKey || config.url.includes('PASTE_')) {
    throw new Error('Supabase is not configured.');
  }
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

async function fetchJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

function buildSelects() {
  state.taxonomy.materials.forEach(value => $('material').add(new Option(value, value)));
  state.taxonomy.forms.forEach(value => $('form').add(new Option(value, value)));
}

function initMap(containerId = 'map') {
  const center = state.site.center;
  state.map = L.map(containerId, { zoomControl: true }).setView(
    [center.latitude, center.longitude],
    state.site.zoom || 17
  );

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20, attribution: 'Tiles © Esri' }
  ).addTo(state.map);

  const streets = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
  );

  L.control.layers({ Satellite: satellite, Streets: streets }).addTo(state.map);

  if (state.site.boundary?.length >= 3) {
    state.boundary = L.polygon(
      state.site.boundary.map(point => [point.latitude, point.longitude]),
      {
        color: '#ffd400',
        weight: 5,
        opacity: 1,
        fillColor: '#ffd400',
        fillOpacity: 0.12,
        dashArray: '10 6'
      }
    ).addTo(state.map);
    state.map.fitBounds(state.boundary.getBounds(), { padding: [20, 20] });
  }
}

function scoreText(text, material, form, query) {
  const normalized = norm(text);
  const terms = norm(query).split(' ').filter(Boolean);
  let score = 0;
  let max = 0;

  if (material) {
    max += 40;
    if (normalized.includes(norm(material))) score += 40;
  }

  if (form) {
    max += 40;
    if (normalized.includes(norm(form))) score += 40;
  }

  terms.forEach(term => {
    max += 8;
    if (normalized.includes(term)) score += 8;
  });

  if (!material && !form && !terms.length) return 0;
  return Math.round((score / Math.max(max, 1)) * 100);
}

function clearMarkers() {
  state.markers.forEach(marker => marker.remove());
  state.markers.clear();
}

function fitMatches(matches) {
  const markers = matches.map(record => state.markers.get(record.id)).filter(Boolean);
  if (!markers.length) return;
  const group = L.featureGroup(markers);
  state.map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 19 });
}

function daysOld(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function formatDate(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
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

async function load() {
  state.supabase = getClient();

  [state.site, state.taxonomy] = await Promise.all([
    fetchJson('data/site.json'),
    fetchJson('data/taxonomy.json')
  ]);

  buildSelects();
  initMap();
  bind();

  $('employeeName').value = localStorage.getItem('pageSteelEmployeeName') || '';

  const { data, error } = await state.supabase
    .from('material_records')
    .select('*')
    .eq('status', 'current')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  state.records = (data || []).map(row => ({
    id: row.id,
    title: row.title,
    materials: row.materials || [],
    profiles: row.profiles || [],
    condition: row.condition,
    lengthRange: row.length_range,
    sizeRange: row.size_range,
    quantityRange: row.quantity_range,
    note: row.note || '',
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    imageUrl: row.image_url || '',
    updatedAt: row.updated_at,
    photoAt: row.captured_at || row.updated_at || row.created_at,
    employeeName: row.employee_name
  }));

  setStatus(`${state.records.length} scrap record${state.records.length === 1 ? '' : 's'} loaded.`);
}

function bind() {
  $('employeeName').addEventListener('input', event => {
    localStorage.setItem('pageSteelEmployeeName', event.target.value.trim());
  });

  $('searchButton').addEventListener('click', runSearch);

  $('query').addEventListener('keydown', event => {
    if (event.key === 'Enter') runSearch();
  });

  $('clearSearch').addEventListener('click', clearSearch);
}

function searchableText(record) {
  const aliases = record.profiles.flatMap(profile => state.taxonomy.aliases[norm(profile)] || []);

  return [
    record.title,
    ...record.materials,
    ...record.profiles,
    record.condition,
    record.lengthRange,
    record.sizeRange,
    record.quantityRange,
    record.note,
    ...aliases
  ].filter(Boolean).join(' ');
}

async function runSearch() {
  const employeeName = $('employeeName').value.trim();
  const material = $('material').value;
  const form = $('form').value;
  const query = $('query').value.trim();

  if (!employeeName) {
    setStatus('Enter the employee name before searching.');
    return;
  }

  if (!material && !form && !query) {
    setStatus('Describe at least one material, profile, or search term.');
    return;
  }

  localStorage.setItem('pageSteelEmployeeName', employeeName);
  clearMarkers();

  const matches = state.records
    .map(record => ({
      ...record,
      _score: scoreText(searchableText(record), material, form, query)
    }))
    .filter(record => record._score > 0)
    .sort((a, b) => b._score - a._score);

  const { data: searchEvent, error: eventError } = await state.supabase
    .from('search_events')
    .insert({
      employee_name: employeeName,
      search_mode: 'scrap',
      material: material || null,
      profile: form || null,
      query_text: query || null,
      results_count: matches.length
    })
    .select('id')
    .single();

  if (eventError) console.warn(eventError);
  state.searchEventId = searchEvent?.id || null;

  renderResults(matches);
  matches.forEach(addMarker);
  $('resultCount').textContent = matches.length;

  if (!matches.length) {
    setStatus('No likely scrap locations found. An admin review task was created.');

    await state.supabase
      .from('review_tasks')
      .insert({
        record_type: 'search',
        search_event_id: state.searchEventId,
        reason: 'scrap_search_no_results',
        description: `${employeeName} searched for ${[material, form, query].filter(Boolean).join(' / ')} and received no results.`,
        priority: 'normal',
        requires_photo: true,
        created_by: employeeName
      });

    return;
  }

  fitMatches(matches);
  setStatus(`${matches.length} likely location${matches.length === 1 ? '' : 's'} found.`);

  for (const record of matches) {
    const age = daysOld(record.photoAt);
    if (age != null && age > 90) {
      await ensurePhotoTask(record, employeeName, age);
    }
  }
}

async function ensurePhotoTask(record, employeeName, age) {
  const { data: existing } = await state.supabase
    .from('review_tasks')
    .select('id')
    .eq('record_type', 'scrap')
    .eq('record_id', record.id)
    .eq('reason', 'scrap_photo_stale')
    .eq('status', 'open')
    .maybeSingle();

  if (existing) return;

  await state.supabase
    .from('review_tasks')
    .insert({
      record_type: 'scrap',
      record_id: record.id,
      search_event_id: state.searchEventId,
      reason: 'scrap_photo_stale',
      description: `${record.title} was searched by ${employeeName}. Its current photo is approximately ${age} days old.`,
      priority: age > 180 ? 'high' : 'normal',
      requires_photo: true,
      created_by: employeeName
    });
}

function addMarker(record) {
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) return;

  const marker = L.marker([record.latitude, record.longitude]).addTo(state.map);
  const age = daysOld(record.photoAt);

  marker.bindPopup(`
    <strong>${esc(record.title)}</strong>
    ${record.imageUrl ? `<br><img src="${esc(record.imageUrl)}" alt="${esc(record.title)}">` : ''}
    <br>${esc(record.materials.join(', '))} · ${esc(record.profiles.join(', '))}
    <br><small>Photo ${age == null ? 'age unknown' : `${age} days old`}</small>
  `);

  state.markers.set(record.id, marker);
}

function renderResults(matches) {
  const container = $('results');
  container.innerHTML = '';

  if (!matches.length) {
    container.innerHTML = '<p class="empty-state">No matches found.</p>';
    return;
  }

  matches.forEach(record => {
    const age = daysOld(record.photoAt);
    const stale = age != null && age > 90;

    const card = document.createElement('article');
    card.className = 'result-card';
    card.innerHTML = `
      <img src="${esc(record.imageUrl)}" alt="${esc(record.title)}">
      <div>
        <p class="score">${record._score}% match</p>
        <h3>${esc(record.title)}</h3>
        <p>${esc(record.materials.join(', '))} · ${esc(record.profiles.join(', '))}</p>
        <p>
          ${stale
            ? '<span class="freshness-badge stale">Admin photo refresh queued</span>'
            : '<span class="freshness-badge current">Photo current</span>'}
        </p>
        <p>Photo: ${age == null ? 'unknown age' : `${age} days old`} · updated ${esc(formatDate(record.updatedAt))}</p>
      </div>
    `;

    card.addEventListener('click', async () => {
      const marker = state.markers.get(record.id);

      if (marker) {
        state.map.setView(marker.getLatLng(), 19);
        marker.openPopup();
      }

      if (state.searchEventId) {
        await state.supabase
          .from('search_events')
          .update({ opened_record_id: record.id })
          .eq('id', state.searchEventId);
      }
    });

    container.appendChild(card);
  });
}

function clearSearch() {
  $('material').value = '';
  $('form').value = '';
  $('query').value = '';
  $('resultCount').textContent = '0';
  $('results').innerHTML = '<p class="empty-state">Search results will appear here.</p>';

  clearMarkers();
  setStatus(`${state.records.length} scrap records loaded.`);

  if (state.boundary) {
    state.map.fitBounds(state.boundary.getBounds(), { padding: [20, 20] });
  }
}

function setStatus(message) {
  $('status').textContent = message;
}

load().catch(error => {
  console.error(error);
  setStatus(error.message || 'Could not start scrap search.');
});

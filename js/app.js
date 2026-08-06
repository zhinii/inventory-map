import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const state = {
  site: null,
  taxonomy: null,
  inventory: [],
  map: null,
  markers: new Map(),
  boundary: null,
  source: 'live'
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
    throw new Error('Supabase is not configured yet. Add the project URL and publishable key in js/supabase-config.js.');
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

async function load() {
  const [site, taxonomy] = await Promise.all([
    fetchJson('data/site.json'),
    fetchJson('data/taxonomy.json')
  ]);
  Object.assign(state, { site, taxonomy });
  buildSelects();
  initMap();
  bind();

  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('material_records')
      .select('*')
      .eq('status', 'current')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    state.inventory = (data || []).map(fromDatabaseRecord);
    setStatus(`${state.inventory.length} current live record${state.inventory.length === 1 ? '' : 's'} loaded. Material locations remain hidden until you search.`);
  } catch (error) {
    console.warn('Live database unavailable, using demonstration data.', error);
    state.source = 'fallback';
    try {
      const fallback = await fetchJson('data/inventory.json');
      state.inventory = fallback;
      setStatus(`Live database unavailable. Showing ${fallback.length} local demonstration record${fallback.length === 1 ? '' : 's'}.`);
    } catch {
      setStatus(error.message || 'Could not load the live inventory.');
    }
  }
}

function fromDatabaseRecord(row) {
  return {
    id: row.id,
    title: row.title,
    materials: row.materials || [],
    profiles: row.profiles || [],
    material: (row.materials || [])[0] || 'Unknown',
    form: (row.profiles || [])[0] || 'Unknown',
    condition: row.condition,
    lengthRange: row.length_range,
    sizeRange: row.size_range,
    quantityRange: row.quantity_range,
    description: row.note || '',
    notes: row.note || '',
    employeeName: row.employee_name,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    materialLocation: { latitude: row.latitude, longitude: row.longitude },
    cameraLocation: row.camera_latitude != null && row.camera_longitude != null
      ? { latitude: row.camera_latitude, longitude: row.camera_longitude }
      : null,
    images: row.image_url ? [row.image_url] : [],
    tags: [
      ...(row.materials || []),
      ...(row.profiles || []),
      row.condition,
      row.length_range,
      row.size_range,
      row.quantity_range
    ].filter(Boolean),
    demo: false
  };
}

function buildSelects() {
  state.taxonomy.materials.forEach(value => $('material').add(new Option(value, value)));
  state.taxonomy.forms.forEach(value => $('form').add(new Option(value, value)));
}

function initMap() {
  const center = state.site.center;
  state.map = L.map('map', { zoomControl: true }).setView(
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

function bind() {
  $('searchButton').addEventListener('click', runSearch);
  $('query').addEventListener('keydown', event => {
    if (event.key === 'Enter') runSearch();
  });
  $('clearSearch').addEventListener('click', clearSearch);
}

function recordText(record) {
  const aliases = (record.profiles || [record.form])
    .flatMap(profile => state.taxonomy.aliases[norm(profile)] || []);
  return norm([
    record.title,
    ...(record.materials || [record.material]),
    ...(record.profiles || [record.form]),
    record.condition,
    record.lengthRange,
    record.sizeRange,
    record.quantityRange,
    record.description,
    record.landmark,
    record.notes,
    ...(record.attributes || []),
    ...(record.tags || []),
    ...aliases
  ].filter(Boolean).join(' '));
}

function scoreRecord(record, material, form, query) {
  const text = recordText(record);
  const terms = norm(query).split(' ').filter(Boolean);
  let score = 0;
  let max = 0;

  if (material) {
    max += 40;
    const materials = (record.materials || [record.material]).map(norm);
    if (materials.includes(norm(material))) score += 40;
    else if (text.includes(norm(material))) score += 20;
  }

  if (form) {
    max += 40;
    const profiles = (record.profiles || [record.form]).map(norm);
    if (profiles.includes(norm(form))) score += 40;
    else if (text.includes(norm(form))) score += 22;
  }

  terms.forEach(term => {
    max += 8;
    if (text.includes(term)) score += 8;
  });

  if (!material && !form && !terms.length) return 0;
  return Math.round((score / Math.max(max, 1)) * 100);
}

function runSearch() {
  const material = $('material').value;
  const form = $('form').value;
  const query = $('query').value;

  if (!material && !form && !query.trim()) {
    setStatus('Describe at least one material, profile, or search term.');
    return;
  }

  clearMarkers();
  const matches = state.inventory
    .map(record => ({ ...record, _score: scoreRecord(record, material, form, query) }))
    .filter(record => record._score > 0)
    .sort((a, b) => b._score - a._score);

  renderResults(matches);
  matches.forEach(addMarker);
  $('resultCount').textContent = matches.length;

  if (matches.length) {
    const markerList = matches.map(record => state.markers.get(record.id)).filter(Boolean);
    if (markerList.length) {
      const group = L.featureGroup(markerList);
      state.map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 19 });
    }
    setStatus(`${matches.length} likely location${matches.length === 1 ? '' : 's'} revealed. Select a result to inspect it.`);
  } else {
    setStatus('No likely locations found. Try a broader material, profile, condition, size, or ordinary term.');
  }
}

function setStatus(text) {
  $('status').textContent = text;
}

function clearSearch() {
  $('material').value = '';
  $('form').value = '';
  $('query').value = '';
  clearMarkers();
  $('results').innerHTML = '<p class="empty-state">Search results will appear here with photos and directions.</p>';
  $('resultCount').textContent = '0';
  setStatus(`${state.inventory.length} current live record${state.inventory.length === 1 ? '' : 's'} loaded. Material locations remain hidden until you search.`);
  if (state.boundary) {
    state.map.fitBounds(state.boundary.getBounds(), { padding: [20, 20] });
  } else {
    state.map.setView(
      [state.site.center.latitude, state.site.center.longitude],
      state.site.zoom || 17
    );
  }
}

function clearMarkers() {
  state.markers.forEach(marker => marker.remove());
  state.markers.clear();
}

function addMarker(record) {
  const point = record.materialLocation || record.cameraLocation;
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;

  const marker = L.marker([point.latitude, point.longitude]).addTo(state.map);
  const materials = (record.materials || [record.material]).filter(Boolean).join(', ');
  const profiles = (record.profiles || [record.form]).filter(Boolean).join(', ');
  const updated = record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : 'Unknown';
  const image = record.images?.[0] || '';

  marker.bindPopup(`
    <strong>${esc(record.title || `${materials} · ${profiles}`)}</strong>
    ${record.demo ? '<br><span class="demo-label">DEMO LOCATION</span>' : ''}
    ${image ? `<br><img src="${esc(image)}" alt="${esc(record.title || 'Material photo')}">` : ''}
    <br>${esc(materials)} · ${esc(profiles)}
    <br><small>${esc(record.condition || '')} · ${esc(record.lengthRange || '')} · ${esc(record.sizeRange || '')}</small>
    <br><small>Updated ${esc(updated)}${record.employeeName ? ` by ${esc(record.employeeName)}` : ''}</small>
  `);
  state.markers.set(record.id, marker);
}

function renderResults(matches) {
  const container = $('results');
  container.innerHTML = '';
  if (!matches.length) {
    container.innerHTML = '<p class="empty-state">No matches yet.</p>';
    return;
  }

  matches.forEach(record => {
    const materials = (record.materials || [record.material]).filter(Boolean).join(', ');
    const profiles = (record.profiles || [record.form]).filter(Boolean).join(', ');
    const updated = record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : 'Unknown';
    const card = document.createElement('article');
    card.className = 'result-card';
    card.innerHTML = `
      <img src="${esc(record.images?.[0] || '')}" alt="${esc(record.title || 'Material photo')}">
      <div>
        <p class="score">${record._score}% match${record.demo ? ' · DEMO' : ''}</p>
        <h3>${esc(record.title || `${materials} · ${profiles}`)}</h3>
        <p>${esc(materials)} · ${esc(profiles)}</p>
        <p>${esc(record.condition || '')} · ${esc(record.lengthRange || '')}</p>
        <p>Updated ${esc(updated)}${record.employeeName ? ` by ${esc(record.employeeName)}` : ''}</p>
      </div>`;

    card.addEventListener('click', () => {
      const marker = state.markers.get(record.id);
      if (marker) {
        state.map.setView(marker.getLatLng(), 19);
        marker.openPopup();
      }
    });
    container.appendChild(card);
  });
}

function esc(value) {
  return (value ?? '').toString().replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

load().catch(error => setStatus(error.message || 'Could not start the inventory map.'));

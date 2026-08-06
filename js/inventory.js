import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const state = {
  supabase: null,
  site: null,
  taxonomy: null,
  records: [],
  map: null,
  markers: new Map(),
  boundary: null,
  searchEventId: null,
  activeRecord: null,
  activeTaskId: null
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

  await loadRecords();
}

async function loadRecords() {
  const { data, error } = await state.supabase
    .from('inventory_records')
    .select('*')
    .eq('status', 'current')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  state.records = (data || []).map(row => ({
    id: row.id,
    inventoryNumber: row.inventory_number,
    title: row.title,
    material: row.material,
    profile: row.profile,
    grade: row.grade,
    sizeDescription: row.size_description,
    exactQuantity: Number(row.exact_quantity),
    quantityUnit: row.quantity_unit,
    locationCode: row.location_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    imageUrl: row.image_url || '',
    lastCountedAt: row.last_counted_at,
    lastCountedBy: row.last_counted_by,
    lastVerifiedAt: row.last_verified_at,
    updatedAt: row.updated_at
  }));

  setStatus(`${state.records.length} tracked inventory record${state.records.length === 1 ? '' : 's'} loaded.`);
}

function bind() {
  $('employeeName').addEventListener('input', event => {
    localStorage.setItem('pageSteelEmployeeName', event.target.value.trim());
  });

  $('inventoryAction').addEventListener('change', updateActionPrompt);
  $('searchButton').addEventListener('click', runSearch);

  $('query').addEventListener('keydown', event => {
    if (event.key === 'Enter') runSearch();
  });

  $('clearSearch').addEventListener('click', clearSearch);
  $('completeInventoryUpdate').addEventListener('click', completeUpdate);
  $('cannotVerify').addEventListener('click', cannotVerify);
}

function searchableText(record) {
  return [
    record.inventoryNumber,
    record.title,
    record.material,
    record.profile,
    record.grade,
    record.sizeDescription,
    record.quantityUnit,
    record.locationCode
  ].filter(Boolean).join(' ');
}

async function runSearch() {
  const employeeName = $('employeeName').value.trim();
  const action = $('inventoryAction').value;
  const material = $('material').value;
  const form = $('form').value;
  const query = $('query').value.trim();

  if (!employeeName) {
    setStatus('Enter the employee name before searching.');
    return;
  }

  if (!action) {
    setStatus('Select what you are doing with the inventory.');
    return;
  }

  if (!material && !form && !query) {
    setStatus('Describe the inventory or enter an inventory number.');
    return;
  }

  localStorage.setItem('pageSteelEmployeeName', employeeName);
  closeUpdatePanel();
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
      search_mode: 'inventory',
      inventory_action: action,
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
    setStatus('No tracked inventory was found. An admin alert was created.');

    await state.supabase
      .from('review_tasks')
      .insert({
        record_type: 'search',
        search_event_id: state.searchEventId,
        reason: 'inventory_search_no_results',
        description: `${employeeName} searched tracked inventory for ${[material, form, query].filter(Boolean).join(' / ')} and received no results.`,
        priority: 'high',
        requires_count: true,
        created_by: employeeName
      });

    return;
  }

  fitMatches(matches);
  setStatus(`${matches.length} inventory record${matches.length === 1 ? '' : 's'} found. Open one to complete the required update.`);
}

function addMarker(record) {
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) return;

  const marker = L.marker([record.latitude, record.longitude]).addTo(state.map);

  marker.bindPopup(`
    <strong>${esc(record.inventoryNumber)}</strong>
    ${record.imageUrl ? `<br><img src="${esc(record.imageUrl)}" alt="${esc(record.title)}">` : ''}
    <br>${esc(record.title)}
    <br><small>${esc(displayQuantity(record))} · ${esc(record.locationCode)}</small>
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
    const countAge = daysOld(record.lastCountedAt);

    const card = document.createElement('article');
    card.className = 'result-card inventory-result-card';

    card.innerHTML = `
      <img src="${esc(record.imageUrl)}" alt="${esc(record.title)}">
      <div>
        <p class="score">${record._score}% match · TRACKED</p>
        <h3>${esc(record.inventoryNumber)}</h3>
        <p>${esc(record.title)}</p>
        <p><strong>${esc(displayQuantity(record))}</strong> · ${esc(record.locationCode)}</p>
        <p>
          Last counted:
          ${countAge == null ? 'never' : `${countAge} days ago`}
          ${record.lastCountedBy ? ` by ${esc(record.lastCountedBy)}` : ''}
        </p>
        <button type="button" class="primary-button open-inventory">Open and update</button>
      </div>
    `;

    card.querySelector('.open-inventory').addEventListener('click', event => {
      event.stopPropagation();
      openInventoryRecord(record);
    });

    card.addEventListener('click', () => focusRecord(record));

    container.appendChild(card);
  });
}

function focusRecord(record) {
  const marker = state.markers.get(record.id);

  if (marker) {
    state.map.setView(marker.getLatLng(), 19);
    marker.openPopup();
  }
}

async function openInventoryRecord(record) {
  const employeeName = $('employeeName').value.trim();
  const action = $('inventoryAction').value;

  if (!employeeName || !action) {
    setStatus('Enter your name and select an action first.');
    return;
  }

  state.activeRecord = record;
  focusRecord(record);

  if (state.searchEventId) {
    await state.supabase
      .from('search_events')
      .update({ opened_record_id: record.id })
      .eq('id', state.searchEventId);
  }

  state.activeTaskId = await ensureRequiredTask(record, employeeName, action);

  $('inventoryUpdatePanel').classList.remove('hidden');

  $('inventorySelectedSummary').innerHTML = `
    <strong>${esc(record.inventoryNumber)}</strong><br>
    Expected: ${esc(displayQuantity(record))}<br>
    Location: ${esc(record.locationCode)}<br>
    This task remains open for the administrator until the update is completed.
  `;

  $('inventoryQuantity').value = record.exactQuantity;
  $('inventoryUnit').value = record.quantityUnit;
  $('destinationLocation').value = '';
  $('inventoryNote').value = '';

  updateActionPrompt();

  $('updateStatus').textContent =
    'Complete the form below. Leaving now will leave an open admin alert.';

  $('inventoryUpdatePanel').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

async function ensureRequiredTask(record, employeeName, action) {
  const { data: existing } = await state.supabase
    .from('review_tasks')
    .select('id')
    .eq('record_type', 'inventory')
    .eq('record_id', record.id)
    .eq('reason', 'inventory_search_requires_update')
    .eq('status', 'open')
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data, error } = await state.supabase
    .from('review_tasks')
    .insert({
      record_type: 'inventory',
      record_id: record.id,
      search_event_id: state.searchEventId,
      reason: 'inventory_search_requires_update',
      description: `${employeeName} opened ${record.inventoryNumber} for action: ${action}.`,
      priority: 'high',
      requires_count: true,
      created_by: employeeName
    })
    .select('id')
    .single();

  if (error) throw error;

  return data.id;
}

function updateActionPrompt() {
  const action = $('inventoryAction').value;

  const labels = {
    verify: 'Confirmed quantity now present',
    remove: 'Quantity being removed',
    receive: 'Quantity being received',
    move: 'Complete quantity being moved',
    count: 'Actual counted quantity'
  };

  $('quantityPrompt').textContent = labels[action] || 'Quantity';
  $('destinationField').classList.toggle('hidden', action !== 'move');
}

async function completeUpdate() {
  if (!state.activeRecord) {
    setUpdateStatus('Open an inventory result first.', true);
    return;
  }

  const employeeName = $('employeeName').value.trim();
  const action = $('inventoryAction').value;
  const amount = Number($('inventoryQuantity').value);
  const unit = $('inventoryUnit').value;
  const destination = $('destinationLocation').value.trim();
  const note = $('inventoryNote').value.trim();

  if (!Number.isFinite(amount) || amount < 0) {
    setUpdateStatus('Enter a valid non-negative quantity.', true);
    return;
  }

  if (!unit) {
    setUpdateStatus('Select the inventory unit.', true);
    return;
  }

  if (action === 'move' && !destination) {
    setUpdateStatus('Enter the destination location code.', true);
    return;
  }

  const before = state.activeRecord.exactQuantity;
  let after = before;
  let nextLocation = state.activeRecord.locationCode;

  if (action === 'verify' || action === 'count') {
    after = amount;
  }

  if (action === 'remove') {
    if (amount > before) {
      setUpdateStatus(
        `Cannot remove ${amount}; the recorded quantity is ${before}.`,
        true
      );
      return;
    }

    after = before - amount;
  }

  if (action === 'receive') {
    after = before + amount;
  }

  if (action === 'move') {
    if (Math.abs(amount - before) > 0.0001) {
      setUpdateStatus(
        `This version moves the complete record. Enter the full recorded quantity: ${before}.`,
        true
      );
      return;
    }

    nextLocation = destination;
  }

  const now = new Date().toISOString();

  const updateRow = {
    exact_quantity: after,
    quantity_unit: unit,
    location_code: nextLocation,
    last_verified_at: now,
    updated_at: now
  };

  if (action === 'verify' || action === 'count') {
    updateRow.last_counted_at = now;
    updateRow.last_counted_by = employeeName;
  }

  setUpdateStatus('Saving inventory transaction…');

  const { error: recordError } = await state.supabase
    .from('inventory_records')
    .update(updateRow)
    .eq('id', state.activeRecord.id);

  if (recordError) {
    setUpdateStatus(recordError.message, true);
    return;
  }

  const { error: transactionError } = await state.supabase
    .from('inventory_transactions')
    .insert({
      inventory_record_id: state.activeRecord.id,
      search_event_id: state.searchEventId,
      employee_name: employeeName,
      transaction_type: action,
      quantity: amount,
      quantity_unit: unit,
      quantity_before: before,
      quantity_after: after,
      from_location: state.activeRecord.locationCode,
      to_location: action === 'move'
        ? destination
        : state.activeRecord.locationCode,
      note: note || null
    });

  if (transactionError) {
    setUpdateStatus(transactionError.message, true);
    return;
  }

  if (state.activeTaskId) {
    await state.supabase
      .from('review_tasks')
      .update({
        status: 'completed',
        completed_at: now,
        completed_by: employeeName,
        updated_at: now
      })
      .eq('id', state.activeTaskId);
  }

  if (state.searchEventId) {
    await state.supabase
      .from('search_events')
      .update({ completed: true })
      .eq('id', state.searchEventId);
  }

  state.activeRecord.exactQuantity = after;
  state.activeRecord.quantityUnit = unit;
  state.activeRecord.locationCode = nextLocation;
  state.activeTaskId = null;

  setUpdateStatus(
    `Update complete. New recorded quantity: ${after} ${unit}.`
  );
}

async function cannotVerify() {
  if (!state.activeRecord || !state.activeTaskId) {
    setUpdateStatus('Open an inventory result first.', true);
    return;
  }

  const employeeName = $('employeeName').value.trim();
  const note = $('inventoryNote').value.trim();

  const { error } = await state.supabase
    .from('review_tasks')
    .update({
      priority: 'urgent',
      description:
        `${employeeName} could not verify ${state.activeRecord.inventoryNumber}.` +
        `${note ? ` Note: ${note}` : ''}`,
      updated_at: new Date().toISOString()
    })
    .eq('id', state.activeTaskId);

  if (error) {
    setUpdateStatus(error.message, true);
    return;
  }

  setUpdateStatus(
    'Administrator alerted. The inventory task remains open.',
    true
  );
}

function displayQuantity(record) {
  return `${record.exactQuantity} ${record.quantityUnit}`.trim();
}

function closeUpdatePanel() {
  state.activeRecord = null;
  state.activeTaskId = null;

  $('inventoryUpdatePanel').classList.add('hidden');
  $('updateStatus').textContent = 'Open an inventory result to begin.';
}

function clearSearch() {
  $('material').value = '';
  $('form').value = '';
  $('query').value = '';
  $('resultCount').textContent = '0';
  $('results').innerHTML =
    '<p class="empty-state">Search results will appear here.</p>';

  clearMarkers();
  closeUpdatePanel();

  setStatus(`${state.records.length} tracked inventory records loaded.`);

  if (state.boundary) {
    state.map.fitBounds(state.boundary.getBounds(), {
      padding: [20, 20]
    });
  }
}

function setStatus(message) {
  $('status').textContent = message;
}

function setUpdateStatus(message, isError = false) {
  $('updateStatus').textContent = message;
  $('updateStatus').classList.toggle('error-status', isError);
}

load().catch(error => {
  console.error(error);
  setStatus(error.message || 'Could not start tracked inventory search.');
});

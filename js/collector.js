import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const MATERIALS = [
  'Carbon steel', 'Stainless steel', 'Aluminum', 'Copper', 'Brass',
  'Plastic', 'Lumber', 'Equipment', 'Mixed material', 'Unknown', 'Other'
];

const PROFILES = [
  'Sheet', 'Plate', 'Flat bar', 'Angle', 'Channel', 'I-beam / wide-flange beam',
  'Square tubing', 'Rectangular tubing', 'Round tubing', 'Pipe', 'Round bar',
  'Rebar', 'Wire', 'Mesh', 'Structural assembly', 'Equipment',
  'Miscellaneous scrap', 'Unknown', 'Other'
];

const state = {
  supabase: null,
  site: null,
  map: null,
  boundary: null,
  marker: null,
  file: null,
  resizedBlob: null,
  previewUrl: null,
  capturedAt: null,
  cameraLatitude: null,
  cameraLongitude: null,
  materialLatitude: null,
  materialLongitude: null,
  gpsAccuracyMeters: null,
  currentRecords: [],
  nearbyRecords: [],
  selectedExisting: null,
  saving: false
};

const $ = id => document.getElementById(id);

function getClient() {
  const config = window.PAGE_STEEL_SUPABASE;
  if (!config?.url || !config?.publishableKey || config.url.includes('PASTE_')) {
    throw new Error('Supabase is not configured. Add the project URL and publishable key in js/supabase-config.js.');
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

async function init() {
  try {
    state.supabase = getClient();
    state.site = await fetchJson('data/site.json');
    renderChoiceGrid('materialsGrid', 'materials', MATERIALS);
    renderChoiceGrid('profilesGrid', 'profiles', PROFILES);
    restoreEmployeeName();
    initMap();
    bind();
    await loadCurrentRecords();
    setSaveStatus('Ready. Enter a name and choose a photo.');
  } catch (error) {
    console.error(error);
    setSaveStatus(error.message || 'Could not start the uploader.', true);
  }
}

function renderChoiceGrid(containerId, groupName, values) {
  const container = $(containerId);
  container.innerHTML = values.map(value => `
    <label class="choice-chip">
      <input type="checkbox" name="${groupName}" value="${esc(value)}">
      <span>${esc(value)}</span>
    </label>
  `).join('');
}

function restoreEmployeeName() {
  $('employeeName').value = localStorage.getItem('pageSteelEmployeeName') || '';
}

function initMap() {
  const center = state.site.center;
  state.map = L.map('collectorMap', { zoomControl: true }).setView(
    [center.latitude, center.longitude], state.site.zoom || 17
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
        color: '#ffd400', weight: 5, opacity: 1,
        fillColor: '#ffd400', fillOpacity: 0.12, dashArray: '10 6'
      }
    ).addTo(state.map);
    state.map.fitBounds(state.boundary.getBounds(), { padding: [20, 20] });
  }

  state.map.on('click', event => setMaterialPosition(event.latlng.lat, event.latlng.lng));
  setTimeout(() => state.map.invalidateSize(), 100);
}

function bind() {
  $('employeeName').addEventListener('input', event => {
    localStorage.setItem('pageSteelEmployeeName', event.target.value.trim());
  });
  $('photoInput').addEventListener('change', handlePhoto);
  $('chooseNew').addEventListener('click', chooseNewLocation);
  $('saveRecord').addEventListener('click', saveRecord);
  $('refreshRecords').addEventListener('click', loadCurrentRecords);
}

async function handlePhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  resetPhotoState();
  state.file = file;
  $('photoStatus').textContent = 'Reading photo and preparing a smaller upload…';

  try {
    state.resizedBlob = await resizeImage(file, 1600, 0.82);
    state.previewUrl = URL.createObjectURL(state.resizedBlob);
    $('photoPreview').src = state.previewUrl;
    $('photoPreview').classList.remove('hidden');
  } catch (error) {
    console.error(error);
    state.resizedBlob = file;
    state.previewUrl = URL.createObjectURL(file);
    $('photoPreview').src = state.previewUrl;
    $('photoPreview').classList.remove('hidden');
  }

  let exif = {};
  try {
    exif = await window.exifr.parse(file, {
      gps: true, tiff: true, exif: true, ifd0: true
    }) || {};
  } catch (error) {
    console.warn('EXIF could not be read.', error);
  }

  state.capturedAt = normalizeDate(exif.DateTimeOriginal || exif.CreateDate) || new Date().toISOString();
  const exifLat = Number(exif.latitude);
  const exifLon = Number(exif.longitude);
  const hasExifGps = Number.isFinite(exifLat) && Number.isFinite(exifLon);

  $('photoStatus').textContent = 'Photo ready. Requesting the phone’s current location…';

  const devicePosition = await getDevicePosition();
  if (devicePosition) {
    state.cameraLatitude = devicePosition.latitude;
    state.cameraLongitude = devicePosition.longitude;
    state.gpsAccuracyMeters = devicePosition.accuracy;
    setMaterialPosition(devicePosition.latitude, devicePosition.longitude);
    $('photoStatus').textContent = `Photo ready. Phone GPS found with approximately ±${Math.round(devicePosition.accuracy)} m accuracy.`;
  } else if (hasExifGps) {
    state.cameraLatitude = exifLat;
    state.cameraLongitude = exifLon;
    state.gpsAccuracyMeters = null;
    setMaterialPosition(exifLat, exifLon);
    $('photoStatus').textContent = 'Photo ready. Using GPS stored in the photo.';
  } else {
    $('photoStatus').textContent = 'Photo ready, but no GPS was found. Tap the map to place the material manually.';
  }

  await findNearbyRecords();
}

function resetPhotoState() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null;
  state.resizedBlob = null;
  state.previewUrl = null;
  state.capturedAt = null;
  state.cameraLatitude = null;
  state.cameraLongitude = null;
  state.materialLatitude = null;
  state.materialLongitude = null;
  state.gpsAccuracyMeters = null;
  state.nearbyRecords = [];
  state.selectedExisting = null;
  $('nearbyRecords').innerHTML = '<p class="empty-state">Nearby records will appear here.</p>';
  $('chooseNew').disabled = true;
  $('selectionStatus').textContent = 'No existing location selected.';
  if (state.marker) {
    state.marker.remove();
    state.marker = null;
  }
  updateCoordinateStatus();
}

function getDevicePosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function setMaterialPosition(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  state.materialLatitude = latitude;
  state.materialLongitude = longitude;

  if (!state.marker) {
    state.marker = L.marker([latitude, longitude], { draggable: true }).addTo(state.map);
    state.marker.bindTooltip('Material location', { permanent: false });
    state.marker.on('dragend', () => {
      const point = state.marker.getLatLng();
      state.materialLatitude = point.lat;
      state.materialLongitude = point.lng;
      updateCoordinateStatus();
    });
  } else {
    state.marker.setLatLng([latitude, longitude]);
  }

  state.map.setView([latitude, longitude], 19);
  updateCoordinateStatus();
}

function updateCoordinateStatus() {
  if (!Number.isFinite(state.materialLatitude) || !Number.isFinite(state.materialLongitude)) {
    $('coordinateStatus').textContent = 'No material position yet.';
    return;
  }
  $('coordinateStatus').textContent = `Material pin: ${state.materialLatitude.toFixed(6)}, ${state.materialLongitude.toFixed(6)}`;
}

async function loadCurrentRecords() {
  $('manageRecords').innerHTML = '<p class="empty-state">Loading current records…</p>';
  const { data, error } = await state.supabase
    .from('material_records')
    .select('*')
    .eq('status', 'current')
    .order('updated_at', { ascending: false });

  if (error) {
    $('manageRecords').innerHTML = `<p class="empty-state">${esc(error.message)}</p>`;
    throw error;
  }

  state.currentRecords = data || [];
  renderManageRecords();
}

async function findNearbyRecords() {
  if (!Number.isFinite(state.cameraLatitude) || !Number.isFinite(state.cameraLongitude)) {
    $('gpsSummary').textContent = 'No automatic camera location is available. Tap the map to set a point and choose “None of these.”';
    $('nearbyRecords').innerHTML = '<p class="empty-state">Nearby matching requires GPS.</p>';
    $('chooseNew').disabled = false;
    return;
  }

  if (!state.currentRecords.length) await loadCurrentRecords();

  const radius = Math.min(50, Math.max(15, Number.isFinite(state.gpsAccuracyMeters) ? state.gpsAccuracyMeters * 2 : 30));
  state.nearbyRecords = state.currentRecords
    .map(record => ({
      ...record,
      distanceMeters: haversineMeters(
        state.cameraLatitude,
        state.cameraLongitude,
        Number(record.latitude),
        Number(record.longitude)
      )
    }))
    .filter(record => Number.isFinite(record.distanceMeters) && record.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  $('gpsSummary').textContent = `GPS accuracy: ${Number.isFinite(state.gpsAccuracyMeters) ? `approximately ±${Math.round(state.gpsAccuracyMeters)} m` : 'not reported'}. Checking current records within ${Math.round(radius)} m.`;
  $('chooseNew').disabled = false;
  renderNearbyRecords();
}

function renderNearbyRecords() {
  const container = $('nearbyRecords');
  if (!state.nearbyRecords.length) {
    container.innerHTML = '<p class="empty-state">No current records were found nearby.</p>';
    return;
  }

  container.innerHTML = '';
  state.nearbyRecords.forEach(record => {
    const card = document.createElement('article');
    card.className = `nearby-card${state.selectedExisting?.id === record.id ? ' selected' : ''}`;
    card.innerHTML = `
      <img src="${esc(record.image_url || '')}" alt="Nearby material record">
      <div>
        <h3>${esc(record.title)}</h3>
        <p>${esc((record.materials || []).join(', '))}</p>
        <p>${esc((record.profiles || []).join(', '))}</p>
        <p><strong>${Math.round(record.distanceMeters)} m away</strong> · updated ${esc(formatDate(record.updated_at))}</p>
        <button type="button" class="secondary-button select-nearby">Use this as the record being updated</button>
      </div>`;
    card.querySelector('.select-nearby').addEventListener('click', () => chooseExisting(record));
    container.appendChild(card);
  });
}

function chooseExisting(record) {
  state.selectedExisting = record;
  $('selectionStatus').textContent = `Updating: ${record.title}. The existing labels were copied below; confirm or change them.`;
  prefillFromExisting(record);
  renderNearbyRecords();
  if (Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude))) {
    setMaterialPosition(Number(record.latitude), Number(record.longitude));
  }
}

function chooseNewLocation() {
  state.selectedExisting = null;
  $('selectionStatus').textContent = 'Creating a separate material location.';
  renderNearbyRecords();
  if (Number.isFinite(state.cameraLatitude) && Number.isFinite(state.cameraLongitude)) {
    setMaterialPosition(state.cameraLatitude, state.cameraLongitude);
  }
}

function prefillFromExisting(record) {
  setCheckedValues('materials', record.materials || []);
  setCheckedValues('profiles', record.profiles || []);
  $('condition').value = record.condition || '';
  $('lengthRange').value = record.length_range || '';
  $('sizeRange').value = record.size_range || '';
  $('quantityRange').value = record.quantity_range || '';
  $('note').value = record.note || '';
}

function setCheckedValues(name, values) {
  const wanted = new Set(values || []);
  document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
    input.checked = wanted.has(input.value);
  });
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
}

function validateForm() {
  const employeeName = $('employeeName').value.trim();
  const materials = checkedValues('materials');
  const profiles = checkedValues('profiles');

  if (!employeeName) return 'Enter the employee name.';
  if (!state.resizedBlob) return 'Take or select a photograph.';
  if (!Number.isFinite(state.materialLatitude) || !Number.isFinite(state.materialLongitude)) return 'Confirm the material location on the map.';
  if (!materials.length) return 'Select at least one material.';
  if (!profiles.length) return 'Select at least one profile or form.';
  if (!$('condition').value) return 'Select the condition.';
  if (!$('lengthRange').value) return 'Select the estimated length range.';
  if (!$('sizeRange').value) return 'Select the estimated size range.';
  if (!$('quantityRange').value) return 'Select the estimated quantity.';
  return null;
}

async function saveRecord() {
  if (state.saving) return;
  const validationError = validateForm();
  if (validationError) {
    setSaveStatus(validationError, true);
    return;
  }

  state.saving = true;
  $('saveRecord').disabled = true;
  setSaveStatus('Uploading compressed photo…');

  try {
    const employeeName = $('employeeName').value.trim();
    const materials = checkedValues('materials');
    const profiles = checkedValues('profiles');
    const id = makeUuid();
    const safeName = employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee';
    const now = new Date();
    const path = `${safeName}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.jpg`;

    const { error: uploadError } = await state.supabase.storage
      .from('material-photos')
      .upload(path, state.resizedBlob, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = state.supabase.storage
      .from('material-photos')
      .getPublicUrl(path);

    const title = `${materials.join(' / ')} · ${profiles.join(' / ')}`;
    const row = {
      id,
      employee_name: employeeName,
      title,
      materials,
      profiles,
      condition: $('condition').value,
      length_range: $('lengthRange').value,
      size_range: $('sizeRange').value,
      quantity_range: $('quantityRange').value,
      note: $('note').value.trim() || null,
      latitude: state.materialLatitude,
      longitude: state.materialLongitude,
      camera_latitude: state.cameraLatitude,
      camera_longitude: state.cameraLongitude,
      gps_accuracy_meters: state.gpsAccuracyMeters,
      image_path: path,
      image_url: publicUrlData.publicUrl,
      captured_at: state.capturedAt,
      updated_at: new Date().toISOString(),
      status: 'current',
      replaces_id: state.selectedExisting?.id || null
    };

    setSaveStatus('Saving labels and map location…');
    const { error: insertError } = await state.supabase
      .from('material_records')
      .insert(row);
    if (insertError) {
      await state.supabase.storage.from('material-photos').remove([path]);
      throw insertError;
    }

    if (state.selectedExisting) {
      const { error: updateError } = await state.supabase
        .from('material_records')
        .update({
          status: 'superseded',
          replaced_by: id,
          updated_at: new Date().toISOString()
        })
        .eq('id', state.selectedExisting.id);
      if (updateError) {
        setSaveStatus(`New record saved, but the older record could not be marked superseded: ${updateError.message}`, true);
      }
    }

    localStorage.setItem('pageSteelEmployeeName', employeeName);
    setSaveStatus(`Saved successfully. ${state.selectedExisting ? 'The older record is now hidden from public search.' : 'A new material location was created.'}`);
    await loadCurrentRecords();
    resetAfterSave();
  } catch (error) {
    console.error(error);
    setSaveStatus(error.message || 'Upload failed.', true);
  } finally {
    state.saving = false;
    $('saveRecord').disabled = false;
  }
}

function resetAfterSave() {
  $('photoInput').value = '';
  $('photoPreview').src = '';
  $('photoPreview').classList.add('hidden');
  $('photoStatus').textContent = 'No photo selected.';
  setCheckedValues('materials', []);
  setCheckedValues('profiles', []);
  $('condition').value = '';
  $('lengthRange').value = '';
  $('sizeRange').value = '';
  $('quantityRange').value = '';
  $('note').value = '';
  resetPhotoState();
}

function renderManageRecords() {
  const container = $('manageRecords');
  if (!state.currentRecords.length) {
    container.innerHTML = '<p class="empty-state">No current records have been uploaded yet.</p>';
    return;
  }

  container.innerHTML = '';
  state.currentRecords.forEach(record => {
    const card = document.createElement('article');
    card.className = 'manage-card';
    card.innerHTML = `
      <img src="${esc(record.image_url || '')}" alt="Current material record">
      <div>
        <h3>${esc(record.title)}</h3>
        <p>${esc(record.employee_name)} · ${esc(formatDate(record.updated_at))}</p>
        <p>${esc(record.condition)} · ${esc(record.length_range)} · ${esc(record.quantity_range)}</p>
        <div class="button-row">
          <button type="button" class="text-button locate-record">Show on map</button>
          <button type="button" class="text-button danger delete-record">Delete</button>
        </div>
      </div>`;

    card.querySelector('.locate-record').addEventListener('click', () => {
      setMaterialPosition(Number(record.latitude), Number(record.longitude));
      document.getElementById('collectorMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    card.querySelector('.delete-record').addEventListener('click', () => deleteRecord(record));
    container.appendChild(card);
  });
}

async function deleteRecord(record) {
  const confirmed = window.confirm(`Delete the current record “${record.title}”? This will remove its photo from storage and hide it from search.`);
  if (!confirmed) return;

  setSaveStatus(`Deleting ${record.title}…`);
  const { error: storageError } = await state.supabase.storage
    .from('material-photos')
    .remove([record.image_path]);

  const { error: updateError } = await state.supabase
    .from('material_records')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', record.id);

  if (storageError || updateError) {
    setSaveStatus(storageError?.message || updateError?.message || 'Delete failed.', true);
    return;
  }

  setSaveStatus('Record deleted.');
  await loadCurrentRecords();
}

function setSaveStatus(message, isError = false) {
  $('saveStatus').textContent = message;
  $('saveStatus').classList.toggle('error-status', isError);
}

async function resizeImage(file, maxDimension, quality) {
  let source;
  let width;
  let height;
  let cleanup = () => {};

  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    width = source.width;
    height = source.height;
    cleanup = () => source.close();
  } catch {
    try {
      source = await createImageBitmap(file);
      width = source.width;
      height = source.height;
      cleanup = () => source.close();
    } catch {
      const objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('This photo format cannot be resized by the browser. Use a JPG photo.'));
        image.src = objectUrl;
      });
      width = source.naturalWidth;
      height = source.naturalHeight;
      cleanup = () => URL.revokeObjectURL(objectUrl);
    }
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(source, 0, 0, outputWidth, outputHeight);
  cleanup();

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not compress the photo.')), 'image/jpeg', quality);
  });
}

function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    const value = character === 'x' ? random : (random & 3) | 8;
    return value.toString(16);
  });
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const earthRadius = 6371000;
  const toRad = degrees => degrees * Math.PI / 180;
  const deltaLat = toRad(lat2 - lat1);
  const deltaLon = toRad(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDate(value) {
  if (!value) return 'unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function esc(value) {
  return (value ?? '').toString().replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

init();

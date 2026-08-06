import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const state = {
  supabase: null,
  site: null,
  taxonomy: null,
  map: null,
  boundary: null,
  marker: null,
  file: null,
  blob: null,
  previewUrl: null,
  latitude: null,
  longitude: null,
  saving: false
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

  state.taxonomy.materials.forEach(value => {
    $('material').add(new Option(value, value));
  });

  state.taxonomy.forms.forEach(value => {
    $('profile').add(new Option(value, value));
  });

  initMap('inventoryMap');

  state.map.on('click', event => {
    setPosition(event.latlng.lat, event.latlng.lng);
  });

  $('employeeName').value =
    localStorage.getItem('pageSteelEmployeeName') || '';

  $('employeeName').addEventListener('input', event => {
    localStorage.setItem(
      'pageSteelEmployeeName',
      event.target.value.trim()
    );
  });

  $('photoInput').addEventListener('change', handlePhoto);
  $('saveInventory').addEventListener('click', saveInventory);
}

async function handlePhoto(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  state.file = file;
  $('photoStatus').textContent =
    'Reading the photo and preparing the upload…';

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);

  try {
    state.blob = await resizeImage(file, 1600, 0.82);
  } catch (error) {
    console.warn(error);
    state.blob = file;
  }

  state.previewUrl = URL.createObjectURL(state.blob);
  $('photoPreview').src = state.previewUrl;
  $('photoPreview').classList.remove('hidden');

  let exif = {};

  try {
    exif = await window.exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      ifd0: true
    }) || {};
  } catch (error) {
    console.warn('EXIF could not be read.', error);
  }

  const exifLatitude = Number(exif.latitude);
  const exifLongitude = Number(exif.longitude);

  if (
    Number.isFinite(exifLatitude) &&
    Number.isFinite(exifLongitude)
  ) {
    setPosition(exifLatitude, exifLongitude);
    $('photoStatus').textContent =
      'Photo ready. Using GPS stored in the photo.';
    return;
  }

  $('photoStatus').textContent =
    'Photo ready. No photo GPS found; requesting the phone location…';

  const phone = await getPhonePosition();

  if (phone) {
    setPosition(phone.latitude, phone.longitude);
    $('photoStatus').textContent =
      `Photo ready. Using phone GPS with approximately ±${Math.round(phone.accuracy)} m accuracy.`;
  } else {
    $('photoStatus').textContent =
      'Photo ready, but no GPS was available. Tap the map to set the inventory location.';
  }
}

function getPhonePosition() {
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
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}

function setPosition(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  state.latitude = latitude;
  state.longitude = longitude;

  if (!state.marker) {
    state.marker = L.marker(
      [latitude, longitude],
      { draggable: true }
    ).addTo(state.map);

    state.marker.on('dragend', () => {
      const point = state.marker.getLatLng();
      state.latitude = point.lat;
      state.longitude = point.lng;
      updateCoordinateStatus();
    });
  } else {
    state.marker.setLatLng([latitude, longitude]);
  }

  state.map.setView([latitude, longitude], 19);
  updateCoordinateStatus();
}

function updateCoordinateStatus() {
  if (
    !Number.isFinite(state.latitude) ||
    !Number.isFinite(state.longitude)
  ) {
    $('coordinateStatus').textContent = 'No location selected.';
    return;
  }

  $('coordinateStatus').textContent =
    `Inventory pin: ${state.latitude.toFixed(6)}, ${state.longitude.toFixed(6)}`;
}

function validate() {
  if (!$('employeeName').value.trim()) return 'Enter the employee name.';
  if (!$('inventoryNumber').value.trim()) return 'Enter the inventory number.';
  if (!$('material').value) return 'Select the material.';
  if (!$('profile').value) return 'Select the profile or form.';

  const quantity = Number($('exactQuantity').value);

  if (!Number.isFinite(quantity) || quantity < 0) {
    return 'Enter a valid non-negative quantity.';
  }

  if (!$('quantityUnit').value) return 'Select the quantity unit.';
  if (!$('locationCode').value.trim()) return 'Enter the location code.';
  if (!state.blob) return 'Take or select a current inventory photo.';

  if (
    !Number.isFinite(state.latitude) ||
    !Number.isFinite(state.longitude)
  ) {
    return 'Confirm the inventory location on the map.';
  }

  return null;
}

async function saveInventory() {
  if (state.saving) return;

  const validationError = validate();

  if (validationError) {
    setSaveStatus(validationError, true);
    return;
  }

  state.saving = true;
  $('saveInventory').disabled = true;

  try {
    const employeeName = $('employeeName').value.trim();
    const inventoryNumber = $('inventoryNumber').value.trim().toUpperCase();
    const material = $('material').value;
    const profile = $('profile').value;
    const grade = $('grade').value.trim() || null;
    const sizeDescription =
      $('sizeDescription').value.trim() || null;
    const exactQuantity = Number($('exactQuantity').value);
    const quantityUnit = $('quantityUnit').value;
    const locationCode = $('locationCode').value.trim().toUpperCase();
    const now = new Date().toISOString();

    setSaveStatus('Checking for an existing inventory number…');

    const { data: existing, error: lookupError } = await state.supabase
      .from('inventory_records')
      .select('*')
      .eq('inventory_number', inventoryNumber)
      .maybeSingle();

    if (lookupError) throw lookupError;

    const id = existing?.id || makeUuid();
    const safeNumber = inventoryNumber
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const path =
      `inventory/${safeNumber}/${Date.now()}-${makeUuid()}.jpg`;

    setSaveStatus('Uploading the current inventory photo…');

    const { error: uploadError } = await state.supabase.storage
      .from('material-photos')
      .upload(path, state.blob, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = state.supabase.storage
      .from('material-photos')
      .getPublicUrl(path);

    const row = {
      inventory_number: inventoryNumber,
      employee_name: employeeName,
      title:
        `${inventoryNumber} · ${material} · ${profile}` +
        `${sizeDescription ? ` · ${sizeDescription}` : ''}`,
      material,
      profile,
      grade,
      size_description: sizeDescription,
      exact_quantity: exactQuantity,
      quantity_unit: quantityUnit,
      location_code: locationCode,
      latitude: state.latitude,
      longitude: state.longitude,
      image_path: path,
      image_url: publicUrlData.publicUrl,
      last_counted_at: now,
      last_counted_by: employeeName,
      last_verified_at: now,
      updated_at: now,
      status: 'current'
    };

    let saveError;

    if (existing) {
      const result = await state.supabase
        .from('inventory_records')
        .update(row)
        .eq('id', existing.id);

      saveError = result.error;
    } else {
      const result = await state.supabase
        .from('inventory_records')
        .insert({
          id,
          ...row,
          created_at: now
        });

      saveError = result.error;
    }

    if (saveError) {
      await state.supabase.storage
        .from('material-photos')
        .remove([path]);

      throw saveError;
    }

    const before = existing
      ? Number(existing.exact_quantity)
      : 0;

    await state.supabase
      .from('inventory_transactions')
      .insert({
        inventory_record_id: id,
        employee_name: employeeName,
        transaction_type: existing ? 'adjust' : 'count',
        quantity: exactQuantity,
        quantity_unit: quantityUnit,
        quantity_before: before,
        quantity_after: exactQuantity,
        from_location: existing?.location_code || null,
        to_location: locationCode,
        note: existing
          ? 'Inventory record replaced through the inventory setup page.'
          : 'Initial inventory count.'
      });

    if (existing?.image_path) {
      await state.supabase.storage
        .from('material-photos')
        .remove([existing.image_path]);
    }

    localStorage.setItem('pageSteelEmployeeName', employeeName);

    setSaveStatus(
      existing
        ? `Updated ${inventoryNumber} successfully.`
        : `Created ${inventoryNumber} successfully.`
    );

    resetForm();
  } catch (error) {
    console.error(error);
    setSaveStatus(error.message || 'Could not save inventory.', true);
  } finally {
    state.saving = false;
    $('saveInventory').disabled = false;
  }
}

function resetForm() {
  $('inventoryNumber').value = '';
  $('material').value = '';
  $('profile').value = '';
  $('grade').value = '';
  $('sizeDescription').value = '';
  $('exactQuantity').value = '';
  $('quantityUnit').value = '';
  $('locationCode').value = '';
  $('photoInput').value = '';
  $('photoPreview').src = '';
  $('photoPreview').classList.add('hidden');
  $('photoStatus').textContent = 'No photo selected.';

  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
  }

  state.file = null;
  state.blob = null;
  state.previewUrl = null;
}

function setSaveStatus(message, isError = false) {
  $('saveStatus').textContent = message;
  $('saveStatus').classList.toggle('error-status', isError);
}

async function resizeImage(file, maxDimension, quality) {
  let image;

  try {
    image = await createImageBitmap(file, {
      imageOrientation: 'from-image'
    });
  } catch {
    image = await createImageBitmap(file);
  }

  const scale = Math.min(
    1,
    maxDimension / Math.max(image.width, image.height)
  );

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  canvas
    .getContext('2d', { alpha: false })
    .drawImage(image, 0, 0, width, height);

  image.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob);
        else reject(new Error('Could not resize the photo.'));
      },
      'image/jpeg',
      quality
    );
  });
}

function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, character => {
      const random =
        crypto.getRandomValues(new Uint8Array(1))[0] & 15;

      const value =
        character === 'x'
          ? random
          : (random & 3) | 8;

      return value.toString(16);
    });
}

load().catch(error => {
  console.error(error);
  setSaveStatus(error.message || 'Could not start the inventory form.', true);
});

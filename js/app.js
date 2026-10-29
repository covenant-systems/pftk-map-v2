'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  const params = new URLSearchParams(location.search);

  const LIST_LIMIT = 150;
  const SIZE_LABELS = { XS: 'Extra small', S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' };
  const RATING_LABELS = { 3: 'Great fit', 2: 'Good fit', 1: 'Moderate' };
  const STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
  };
  const SEMINARY_ICONS = {
    'ABCUSA': ['baptist.png', 'American Baptist'],
    'ELCA': ['lutheran.png', 'ELCA (Lutheran)'],
    'PC(USA)': ['presby.png', 'PC(USA)'],
    'RCA': ['dutchref.png', 'Reformed Church in America'],
    'TEC': ['anglican.png', 'Episcopal Church'],
    'UCC': ['congregational.png', 'United Church of Christ'],
    'UMC': ['methodist.png', 'United Methodist'],
    'Interdenominational': ['handshake_interdenominational.png', 'Interdenominational']
  };

  // ---------- Safe output helpers ----------

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only ever returns an http(s) URL or ''. Parsing (rather than a prefix
  // regex) means "javascript:" or "data:" can't sneak through.
  function safeHttpUrl(input) {
    if (!input) return '';
    const candidate = /^https?:\/\//i.test(input) ? input : 'https://' + input;
    try {
      const url = new URL(candidate);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function displayHost(url) {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  function directionsUrl(c) {
    if (c.maps && /^\d+$/.test(c.maps)) return 'https://www.google.com/maps?cid=' + c.maps;
    return safeHttpUrl(c.maps) ||
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.name + ', ' + (c.address || c.lat + ',' + c.lon));
  }

  function normalize(s) {
    return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }

  function milesBetween(a, b) {
    const R = 3958.8;
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- Map ----------

  const map = L.map('map', {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 3,
    zoomSnap: 0.5
  });
  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const US_BOUNDS = [[24.5, -124.8], [49.4, -66.9]];

  // Leaves room for the region chip at the top and, on phones, the sheet.
  function mapPadding() {
    return mobileQuery.matches
      ? { paddingTopLeft: [16, 60], paddingBottomRight: [16, 190] }
      : { paddingTopLeft: [32, 64], paddingBottomRight: [32, 32] };
  }

  // fitBounds on a zero-size container (hidden iframe, background tab)
  // zooms to max, so the first fit waits until the map has real dimensions.
  map.setView([38.5, -96.5], 4);
  let fitted = false;
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!fitted && map.getSize().x > 0) {
      fitted = true;
      // Linked churches, synods and presbyteries set their own view once data loads.
      if (!['church', 'synod', 'presbytery'].some((k) => params.get(k))) map.fitBounds(US_BOUNDS, mapPadding());
    }
  }).observe($('map'));

  map.createPane('affiliates');
  map.getPane('affiliates').style.zIndex = 640;
  map.createPane('seminaries');
  map.getPane('seminaries').style.zIndex = 630;
  map.createPane('presbyteries');
  map.getPane('presbyteries').style.zIndex = 385;
  map.createPane('synods');
  map.getPane('synods').style.zIndex = 390;
  map.createPane('synodLabels');
  map.getPane('synodLabels').style.zIndex = 620;

  const icons = {};
  function iconFor(c) {
    const key = c.affiliate ? 'aff' : 'r' + (c.rating || 0);
    if (!icons[key]) {
      icons[key] = c.affiliate
        ? L.icon({ iconUrl: 'denominational-seals/pftk.png', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14], className: 'pin pin-aff' })
        : L.icon({ iconUrl: 'denominational-seals/presby.png', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -11], className: 'pin pin-' + key });
    }
    return icons[key];
  }

  const clusters = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 12,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    chunkedLoading: true,
    iconCreateFunction(cluster) {
      const n = cluster.getChildCount();
      const tier = n >= 100 ? 'l' : n >= 20 ? 'm' : 's';
      const px = tier === 'l' ? 46 : tier === 'm' ? 40 : 34;
      return L.divIcon({
        html: n,
        className: 'cluster cluster-' + tier,
        iconSize: L.point(px, px)
      });
    }
  }).addTo(map);

  // Affiliates stay unclustered, on their own pane above the clusters.
  const affiliateLayer = L.layerGroup().addTo(map);

  // ---------- Popups ----------

  function buildPopup(c) {
    const tags = [];
    if (c.affiliate) tags.push('<span class="tag aff">PftK affiliate</span>');
    if (RATING_LABELS[c.rating]) tags.push(`<span class="tag r${c.rating}">${c.rating} · ${RATING_LABELS[c.rating]}</span>`);
    if (c.size) tags.push(`<span class="tag">${esc(SIZE_LABELS[c.size] || c.size)}</span>`);

    const site = safeHttpUrl(c.url);
    return `<div class="pop">
      <h2>${esc(c.name)}</h2>
      ${c.address ? `<p class="pop-addr">${esc(c.address)}</p>` : ''}
      ${regionLine(c)}
      ${tags.length ? `<div class="pop-tags">${tags.join('')}</div>` : ''}
      ${site ? `<a class="pop-site" href="${esc(site)}" target="_blank" rel="noopener">${esc(displayHost(site))}</a>` : ''}
      <div class="pop-actions">
        <a class="primary" href="${esc(directionsUrl(c))}" target="_blank" rel="noopener">Directions</a>
        ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">Website</a>` : ''}
        <button type="button" data-share="${esc(c.id)}">Share</button>
      </div>
    </div>`;
  }

  function regionLine(c) {
    const names = [regions.presbytery.get(c.presbytery), regions.synod.get(c.synod)]
      .filter(Boolean).map((r) => esc(r.name));
    return names.length ? `<p class="pop-region">${names.join(' · ')}</p>` : '';
  }

  const popupOptions = {
    maxWidth: 320,
    autoPanPaddingTopLeft: L.point(16, 16),
    autoPanPaddingBottomRight: L.point(16, 16)
  };

  // ---------- Data ----------

  let churches = [];
  const byId = new Map();
  let activeId = null;
  let userLoc = null;
  let userMarker = null;

  function parseChurches(payload) {
    const fields = payload.fields;
    const ix = (name) => fields.indexOf(name);
    const iId = ix('id'), iName = ix('name'), iLat = ix('lat'), iLon = ix('lon'), iRating = ix('rating'),
      iAddr = ix('address'), iUrl = ix('url'), iMaps = ix('maps'), iSize = ix('size'), iAff = ix('affiliate'), iSynod = ix('synod'), iPresbytery = ix('presbytery');

    const out = [];
    for (const row of payload.rows) {
      const lat = row[iLat], lon = row[iLon];
      if (typeof row[iName] !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const address = row[iAddr] || '';
      // Puerto Rico ZIPs arrive without their leading zeros ("PR 901").
      const m = address.match(/,\s*([A-Z]{2})\s+(\d{3,5})/);
      const state = m ? m[1] : '';
      const c = {
        id: String(row[iId]),
        name: row[iName],
        lat, lon,
        rating: row[iRating],
        address,
        url: row[iUrl],
        maps: row[iMaps],
        size: row[iSize] || '',
        affiliate: !!row[iAff],
        synod: iSynod >= 0 ? row[iSynod] || '' : '',
        presbytery: iPresbytery >= 0 ? row[iPresbytery] || '' : '',
        state: state.toLowerCase(),
        haystack: normalize(row[iName] + ' ' + address + ' ' + (STATES[state] || '')),
        marker: null
      };
      const marker = L.marker([lat, lon], {
        icon: iconFor(c),
        title: c.name,
        riseOnHover: true,
        pane: c.affiliate ? 'affiliates' : 'markerPane'
      });
      marker.bindPopup(() => buildPopup(c), popupOptions);
      marker.on('popupopen', () => setActive(c.id));
      marker.on('popupclose', () => { if (activeId === c.id) setActive(null); });
      c.marker = marker;
      out.push(c);
      byId.set(c.id, c);
    }
    return out;
  }

  // ---------- Filtering & search ----------

  const filters = {
    ratings: new Set(['3', '2', '1']),
    sizes: new Set(['XS', 'S', 'M', 'L', 'XL', '']),
    affiliatesOnly: false,
    synod: '',
    presbytery: '',
    tokens: []
  };
  const allRatingsChecked = () => document.querySelectorAll('input[name="rating"]:not(:checked)').length === 0;

  function tokenMatches(c, token) {
    // Two-letter tokens that are state codes ("tx", "pa") match the state,
    // or a whole word, never a prefix: otherwise "pa" would match "Paul".
    if (token.length === 2 && STATES[token.toUpperCase()]) {
      return c.state === token || c.haystack.includes(' ' + token + ' ');
    }
    return c.haystack.includes(' ' + token);
  }

  function passes(c) {
    if (filters.affiliatesOnly && !c.affiliate) return false;
    if (filters.synod && c.synod !== filters.synod) return false;
    if (filters.presbytery && c.presbytery !== filters.presbytery) return false;
    if (RATING_LABELS[c.rating] ? !filters.ratings.has(String(c.rating)) : !allRatingsChecked()) return false;
    if (!filters.sizes.has(c.size)) return false;
    for (const t of filters.tokens) if (!tokenMatches(c, t)) return false;
    return true;
  }

  let visible = [];

  function applyFilters(fit) {
    visible = churches.filter(passes);
    const clustered = [];
    const pinned = [];
    for (const c of visible) (c.affiliate ? pinned : clustered).push(c.marker);

    clusters.clearLayers();
    clusters.addLayers(clustered);
    affiliateLayer.clearLayers();
    for (const m of pinned) affiliateLayer.addLayer(m);

    const isDefault = !filters.tokens.length && !filters.affiliatesOnly && !filters.synod && !filters.presbytery &&
      filters.sizes.size === 6 && allRatingsChecked();
    $('reset').hidden = isDefault;
    updateRegions();
    updateRegionChip();

    if (fit && visible.length && visible.length < churches.length) {
      const bounds = L.latLngBounds(visible.map((c) => [c.lat, c.lon]));
      map.flyToBounds(bounds, Object.assign({ maxZoom: 12, duration: 0.6 }, mapPadding()));
    }
    renderList();
  }

  // ---------- Results list ----------

  function renderList() {
    const searching = filters.tokens.length > 0;
    let items = visible;
    if (!searching) {
      const bounds = map.getBounds();
      items = visible.filter((c) => bounds.contains([c.lat, c.lon]));
    }
    const origin = userLoc || (searching ? null : { lat: map.getCenter().lat, lon: map.getCenter().lng });
    if (origin) {
      for (const c of items) c.dist = milesBetween(origin, c);
      items = items.slice().sort((a, b) => a.dist - b.dist);
    }

    const n = items.length;
    let label;
    if (searching) label = n === 1 ? '1 match' : n.toLocaleString() + ' matches';
    else label = (n === 1 ? '1 church' : n.toLocaleString() + ' churches') + ' in view';
    if (userLoc && n) label += ', nearest first';
    $('count').textContent = label;
    $('sheet-label').textContent = label;

    if (!n) {
      $('results').innerHTML = `<li class="results-empty">${searching
        ? 'No churches match your search and filters.'
        : 'No churches in this area. Zoom out or adjust the filters.'}</li>`;
      return;
    }

    const html = [];
    for (const c of items.slice(0, LIST_LIMIT)) {
      const badge = c.affiliate
        ? '<img src="denominational-seals/pftk.png" alt="PftK affiliate" width="26" height="26">'
        : `<span class="badge r${esc(c.rating)}" title="${esc(RATING_LABELS[c.rating] || '')}">${esc(c.rating || '?')}</span>`;
      const dist = userLoc ? `<span class="result-dist">${c.dist < 10 ? c.dist.toFixed(1) : Math.round(c.dist)} mi</span>` : '<span></span>';
      html.push(`<li><button type="button" class="result${c.id === activeId ? ' is-active' : ''}" data-id="${esc(c.id)}">
        ${badge}
        <span><span class="result-name">${esc(c.name)}</span><span class="result-addr">${esc(c.address)}</span></span>
        ${dist}
      </button></li>`);
    }
    if (n > LIST_LIMIT) {
      html.push(`<li class="results-more">Showing the ${LIST_LIMIT} ${origin ? 'closest' : 'first'}. Zoom in or search to narrow the list.</li>`);
    }
    $('results').innerHTML = html.join('');
  }

  let listFrame = 0;
  function scheduleList() {
    if (filters.tokens.length) return; // search results don't depend on the viewport
    cancelAnimationFrame(listFrame);
    listFrame = requestAnimationFrame(renderList);
  }
  map.on('moveend', scheduleList);

  // ---------- Selection & URL state ----------

  function setActive(id) {
    if (activeId && byId.has(activeId)) {
      const el = byId.get(activeId).marker.getElement();
      if (el) el.classList.remove('is-active');
    }
    activeId = id;
    if (id && byId.has(id)) {
      const el = byId.get(id).marker.getElement();
      if (el) el.classList.add('is-active');
    }
    for (const el of document.querySelectorAll('.result.is-active')) el.classList.remove('is-active');
    if (id) {
      const row = document.querySelector(`.result[data-id="${CSS.escape(id)}"]`);
      if (row) row.classList.add('is-active');
    }
    setUrlParam('church', id);
  }

  function setUrlParam(name, value) {
    if (value) params.set(name, value);
    else params.delete(name);
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function focusChurch(c) {
    if (mobileQuery.matches) setSheet('peek');
    // From the synod overview, jump in past the switch point first so the
    // pins are on the map before the popup opens.
    if (map.getZoom() < PIN_ZOOM) map.setView([c.lat, c.lon], 10, { animate: false });
    if (c.affiliate) {
      map.setView([c.lat, c.lon], Math.max(map.getZoom(), 13));
      c.marker.openPopup();
    } else if (clusters.hasLayer(c.marker)) {
      clusters.zoomToShowLayer(c.marker, () => c.marker.openPopup());
    }
  }

  function shareUrl(id) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('church', id);
    return url.href;
  }

  async function share(id) {
    const c = byId.get(id);
    const url = shareUrl(id);
    if (navigator.share && mobileQuery.matches) {
      try {
        await navigator.share({ title: c ? c.name : 'The PftK Map', url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  $('map').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-share]');
    if (btn) share(btn.getAttribute('data-share'));
  });

  $('results').addEventListener('click', (e) => {
    const btn = e.target.closest('.result');
    if (btn && byId.has(btn.dataset.id)) focusChurch(byId.get(btn.dataset.id));
  });

  // Highlights the pin while hovering its row (when the pin isn't clustered).
  $('results').addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.result');
    const c = btn && byId.get(btn.dataset.id);
    const el = c && c.marker.getElement();
    if (el) el.classList.add('is-active');
  });
  $('results').addEventListener('mouseout', (e) => {
    const btn = e.target.closest('.result');
    const c = btn && byId.get(btn.dataset.id);
    const el = c && c.id !== activeId && c.marker.getElement();
    if (el) el.classList.remove('is-active');
  });

  // ---------- Controls ----------

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.tokens = normalize(e.target.value).trim().split(' ').filter(Boolean);
      applyFilters(filters.tokens.length > 0);
    }, 150);
  });
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = $('results').querySelector('.result');
      if (first) first.click();
      e.target.blur();
    }
  });
  $('search').addEventListener('focus', () => { if (mobileQuery.matches) setSheet('full'); });

  for (const input of document.querySelectorAll('input[name="rating"], input[name="size"]')) {
    input.addEventListener('change', () => {
      const set = input.name === 'rating' ? filters.ratings : filters.sizes;
      if (input.checked) set.add(input.value);
      else set.delete(input.value);
      applyFilters(false);
    });
  }
  $('affiliates-only').addEventListener('change', (e) => {
    filters.affiliatesOnly = e.target.checked;
    applyFilters(e.target.checked);
  });

  $('reset').addEventListener('click', () => {
    $('search').value = '';
    filters.tokens = [];
    filters.affiliatesOnly = false;
    $('affiliates-only').checked = false;
    filters.synod = '';
    filters.presbytery = '';
    $('synod').value = '';
    fillPresbyterySelect();
    setUrlParam('synod', null);
    setUrlParam('presbytery', null);
    for (const input of document.querySelectorAll('input[name="rating"], input[name="size"]')) {
      input.checked = true;
      (input.name === 'rating' ? filters.ratings : filters.sizes).add(input.value);
    }
    applyFilters(false);
  });

  $('near-me').addEventListener('click', () => {
    if (!navigator.geolocation) {
      toast('Location isn’t available in this browser');
      return;
    }
    const btn = $('near-me');
    btn.setAttribute('aria-busy', 'true');
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.removeAttribute('aria-busy');
      userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) userMarker.setLatLng([userLoc.lat, userLoc.lon]);
      else {
        userMarker = L.circleMarker([userLoc.lat, userLoc.lon], {
          radius: 8, weight: 3, color: '#fff', fillColor: '#3d7bff', fillOpacity: 1
        }).bindTooltip('You are here').addTo(map);
      }
      const nearest = visible.slice().sort((a, b) => milesBetween(userLoc, a) - milesBetween(userLoc, b)).slice(0, 6);
      const bounds = L.latLngBounds([[userLoc.lat, userLoc.lon]]);
      for (const c of nearest) bounds.extend([c.lat, c.lon]);
      map.flyToBounds(bounds, Object.assign({ maxZoom: 13, duration: 0.8 }, mapPadding()));
      renderList();
    }, () => {
      btn.removeAttribute('aria-busy');
      toast('Couldn’t get your location');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  // ---------- Seminaries (loaded on first use) ----------

  let seminaryLayer = null;
  async function setSeminaries(on) {
    if (on && !seminaryLayer) {
      seminaryLayer = L.layerGroup();
      try {
        const res = await fetch('data/seminaries.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const payload = await res.json();
        const f = (name) => payload.fields.indexOf(name);
        const semIcons = {};
        for (const row of payload.rows) {
          const denom = row[f('denomination')];
          const meta = SEMINARY_ICONS[denom];
          const lat = row[f('lat')], lon = row[f('lon')];
          if (!meta || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          semIcons[denom] = semIcons[denom] || L.icon({
            iconUrl: 'denominational-seals/' + meta[0], iconSize: [28, 28], iconAnchor: [14, 14],
            popupAnchor: [0, -12], className: 'pin pin-sem'
          });
          const s = { name: row[f('name')], city: row[f('city')], address: row[f('address')], lat, lon };
          L.marker([lat, lon], { icon: semIcons[denom], pane: 'seminaries', title: s.name })
            .bindPopup(() => `<div class="pop">
              <h2>${esc(s.name)}</h2>
              <p class="pop-addr">${esc([s.address, s.city].filter(Boolean).join(', '))}</p>
              <div class="pop-tags"><span class="tag">Seminary</span><span class="tag">${esc(meta[1])}</span></div>
              <div class="pop-actions"><a class="primary" target="_blank" rel="noopener" href="${esc(
                'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.name + ', ' + (s.city || '')))}">Directions</a></div>
            </div>`, popupOptions)
            .addTo(seminaryLayer);
        }
      } catch (err) {
        console.error(err);
        seminaryLayer = null;
        $('show-seminaries').checked = false;
        toast('Couldn’t load seminaries');
        return;
      }
    }
    if (seminaryLayer) {
      if (on) seminaryLayer.addTo(map);
      else seminaryLayer.remove();
    }
    setUrlParam('seminaries', on ? '1' : null);
  }
  $('show-seminaries').addEventListener('change', (e) => setSeminaries(e.target.checked));

  // ---------- Mobile bottom sheet ----------

  const panel = $('panel');
  function setSheet(state) {
    panel.dataset.state = state;
    $('sheet-handle').setAttribute('aria-expanded', String(state !== 'peek'));
  }
  $('sheet-handle').addEventListener('click', () => {
    setSheet(panel.dataset.state === 'peek' ? 'half' : panel.dataset.state === 'half' ? 'full' : 'peek');
  });

  let dragStartY = null;
  $('sheet-handle').addEventListener('pointerdown', (e) => { dragStartY = e.clientY; });
  window.addEventListener('pointerup', (e) => {
    if (dragStartY === null) return;
    const dy = e.clientY - dragStartY;
    dragStartY = null;
    if (Math.abs(dy) < 30) return;
    const order = ['peek', 'half', 'full'];
    const i = order.indexOf(panel.dataset.state);
    setSheet(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
    // Swallow the click that follows a drag so it doesn't toggle again.
    $('sheet-handle').addEventListener('click', (ev) => ev.stopImmediatePropagation(), { capture: true, once: true });
  });
  map.on('dragstart', () => { if (mobileQuery.matches && panel.dataset.state !== 'peek') setSheet('peek'); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      map.closePopup();
      if (mobileQuery.matches) setSheet('peek');
    }
  });

  // ---------- Synods and presbyteries ----------
  //
  // Three levels: synod outlines with count badges when zoomed all the way
  // out, presbytery outlines from about state level, and pins from about
  // metro level in. Outlines are shaded by the average rating of their
  // churches. Searching, "Affiliates only" or picking a presbytery always
  // shows pins.

  const PRESBYTERY_ZOOM = 5; // below this: synods
  const PIN_ZOOM = 7.5;      // from this: pins
  const MIN_RATED = 5;       // fewer rated churches than this: faded color
  const regionLayer = L.layerGroup().addTo(map);
  const badgeLayer = L.layerGroup().addTo(map);
  const regions = { synod: new Map(), presbytery: new Map() };
  const KIND_OF_MODE = { synods: 'synod', presbyteries: 'presbytery' };
  let mode = null;
  let badgesDirty = true;

  function buildRegions(kind, list, pane) {
    const totals = {};
    for (const c of churches) totals[c[kind]] = (totals[c[kind]] || 0) + 1;
    for (const r of list) {
      const entry = {
        kind, id: r.id, name: r.name, short: r.short, synod: r.synod || null,
        total: totals[r.id] || 0, count: 0, avg: null, rated: 0, shape: null, badge: null
      };
      if (Array.isArray(r.rings) && r.rings.length && r.label) {
        entry.shape = L.polygon(r.rings, { pane, className: `region-shape ${kind}-shape`, smoothFactor: 1.5 });
        // Zoom target: the outline ring holding the badge, so Alaska-Northwest
        // zooms to Washington rather than to the whole of Alaska.
        let focus = null;
        for (const ring of r.rings) {
          const b = L.latLngBounds(ring);
          if (b.contains(r.label) && (!focus || b.getNorthEast().distanceTo(b.getSouthWest()) >
            focus.getNorthEast().distanceTo(focus.getSouthWest()))) focus = b;
        }
        entry.focus = focus || entry.shape.getBounds();
        entry.badge = L.marker(r.label, {
          pane: 'synodLabels',
          keyboard: true,
          title: r.name,
          icon: L.divIcon({ className: 'synod-badge-wrap', html: '', iconSize: null })
        });
        entry.shape.on('click', () => selectRegion(entry));
        entry.badge.on('click', () => selectRegion(entry));
        entry.shape.on('mouseover', () => styleRegion(entry, true));
        entry.shape.on('mouseout', () => styleRegion(entry));
        entry.shape.addTo(regionLayer);
      }
      regions[kind].set(r.id, entry);
    }
  }

  // Clicking a synod or presbytery (or picking one from the dropdowns)
  // filters the map and list to its churches. This is the one place that
  // sets those two filters, so the dropdowns, URL and on-map chip agree.
  function selectRegion(r) {
    if (r.kind === 'synod') setRegionFilter(r.id, '', true);
    else setRegionFilter(r.synod, r.id, true);
  }

  function setRegionFilter(synod, presbytery, frame) {
    const p = regions.presbytery.get(presbytery);
    filters.presbytery = p ? p.id : '';
    filters.synod = (p && p.synod) || synod || '';
    $('synod').value = filters.synod;
    fillPresbyterySelect();
    setUrlParam('synod', filters.synod || null);
    setUrlParam('presbytery', filters.presbytery || null);
    applyFilters(false);
    if (frame) frameRegion();
  }

  // Frames the chosen region's main outline (so Alaska-Northwest frames
  // Washington), its churches if it has no outline, or the whole country.
  function frameRegion() {
    const r = regions.presbytery.get(filters.presbytery) || regions.synod.get(filters.synod);
    let bounds = r && r.focus;
    if (!bounds && r && visible.length) bounds = L.latLngBounds(visible.map((c) => [c.lat, c.lon]));
    map.flyToBounds(bounds || US_BOUNDS, Object.assign({ maxZoom: 10, duration: 0.6 }, mapPadding()));
  }

  function updateRegionChip() {
    const p = regions.presbytery.get(filters.presbytery);
    const s = regions.synod.get(filters.synod);
    const chip = $('region-chip');
    chip.hidden = !p && !s;
    if (chip.hidden) return;
    $('region-crumb').hidden = $('region-sep').hidden = !(p && s);
    if (p && s) {
      $('region-crumb').textContent = s.name;
      $('region-crumb').title = `Show all of ${s.name}`;
    }
    $('region-name').textContent = (p || s).name;
  }

  $('region-crumb').addEventListener('click', () => setRegionFilter(filters.synod, '', true));
  $('region-close').addEventListener('click', () => setRegionFilter('', '', true));

  // Average rating -> color, on a fixed 2 (Good fit, blue) to 3 (Great fit,
  // green) scale so a color means the same thing whatever the others
  // average. Anything below 2 (rating 1 churches) stays full blue.
  // Interpolating hue rather than RGB keeps the middle of the scale a
  // clear teal instead of a muddy grey, so nearby averages stay distinct.
  const RAMP_HUE_LOW = 215;
  const RAMP_HUE_HIGH = 145;
  function rampColor(avg) {
    const t = Math.max(0, Math.min(1, avg - 2));
    return `hsl(${Math.round(RAMP_HUE_LOW + (RAMP_HUE_HIGH - RAMP_HUE_LOW) * t)}, 62%, 44%)`;
  }

  function styleRegion(r, hover) {
    if (!r.shape) return;
    const selected = filters[r.kind] === r.id;
    const dimmed = filters[r.kind] && !selected;
    let style;
    if (KIND_OF_MODE[mode] === r.kind) {
      // The level being shown: filled by average rating.
      const faded = r.rated < MIN_RATED;
      style = {
        color: '#fff', weight: r.kind === 'synod' ? 1.5 : 1, opacity: 0.9,
        fillColor: r.avg ? rampColor(r.avg) : '#9a9cb0',
        fillOpacity: !r.count ? 0 : (faded ? 0.22 : 0.55) + (hover ? 0.15 : 0)
      };
    } else if (mode === 'presbyteries') {
      // Synod borders drawn over the presbyteries for context.
      style = { color: '#0B0924', weight: selected ? 2.5 : 1.6, opacity: 0.6, fillOpacity: 0 };
    } else {
      // Pins: faint borders, with the chosen synod or presbytery picked out.
      const base = r.kind === 'synod' ? { weight: 1, opacity: 0.3 } : { weight: 0.6, opacity: 0.18 };
      style = {
        color: '#0B0924',
        weight: selected ? 2.5 : base.weight,
        opacity: selected ? 0.85 : dimmed ? 0.12 : base.opacity,
        fillColor: '#0B0924',
        fillOpacity: dimmed ? 0.06 : 0
      };
    }
    r.shape.setStyle(style);
  }

  // Counts, averages and colors follow the rating and size filters.
  function updateRegions() {
    if (!regions.synod.size && !regions.presbytery.size) return;
    for (const kind of ['synod', 'presbytery']) {
      const stats = {};
      for (const c of visible) {
        const s = stats[c[kind]] || (stats[c[kind]] = { n: 0, sum: 0, rated: 0 });
        s.n += 1;
        if (RATING_LABELS[c.rating]) {
          s.sum += c.rating;
          s.rated += 1;
        }
      }
      for (const r of regions[kind].values()) {
        const s = stats[r.id] || { n: 0, sum: 0, rated: 0 };
        r.count = s.n;
        r.rated = s.rated;
        r.avg = s.rated ? s.sum / s.rated : null;
        if (!r.badge) continue;
        const tip = `${r.name}: ${s.n.toLocaleString()} ${s.n === 1 ? 'church' : 'churches'}` +
          (r.avg ? `, average rating ${r.avg.toFixed(2)}` : '') +
          (r.rated && r.rated < MIN_RATED ? ' (few ratings)' : '');
        r.badge.setIcon(L.divIcon({
          className: 'synod-badge-wrap',
          iconSize: null,
          html: `<span class="synod-badge" title="${esc(tip)}"><b>${s.n.toLocaleString()}</b><span>${esc(r.short)}</span></span>`
        }));
      }
    }
    badgesDirty = true;
    updateMode();
  }

  function setMode(next) {
    const changed = next !== mode;
    mode = next;
    if (changed) {
      $('map').classList.toggle('mode-synods', mode === 'synods');
      $('map').classList.toggle('mode-presbyteries', mode === 'presbyteries');
      if (mode === 'pins') {
        clusters.addTo(map);
        affiliateLayer.addTo(map);
      } else {
        clusters.remove();
        affiliateLayer.remove();
      }
    }
    if (changed || badgesDirty) {
      badgesDirty = false;
      badgeLayer.clearLayers();
      const kind = KIND_OF_MODE[mode];
      if (kind) for (const r of regions[kind].values()) if (r.badge && r.count) badgeLayer.addLayer(r.badge);
      for (const k of ['synod', 'presbytery']) for (const r of regions[k].values()) styleRegion(r);
    }
    declutterBadges();
  }

  // Busiest regions first: a badge keeps its name if it has room, shrinks
  // to just its count if not, and (presbyteries only; there are just 16
  // synods) is hidden if even that would overlap. The shading still shows,
  // and zooming in brings it back. Relative positions only change with
  // zoom, not panning.
  const FULL_BADGE = { w: 104, h: 42 };
  const COMPACT_BADGE = { w: 38, h: 24 };
  function declutterBadges() {
    const kind = KIND_OF_MODE[mode];
    if (!kind) return;
    const shown = [...regions[kind].values()]
      .filter((r) => r.badge && r.count && r.badge.getElement())
      .sort((a, b) => b.count - a.count);
    const placed = [];
    const fits = (p, size) => !placed.some((q) =>
      Math.abs(q.x - p.x) < (q.w + size.w) / 2 && Math.abs(q.y - p.y) < (q.h + size.h) / 2);
    for (const r of shown) {
      const p = map.latLngToLayerPoint(r.badge.getLatLng());
      const size = fits(p, FULL_BADGE) ? FULL_BADGE
        : fits(p, COMPACT_BADGE) || kind === 'synod' ? COMPACT_BADGE : null;
      const el = r.badge.getElement();
      el.classList.toggle('is-compact', size === COMPACT_BADGE);
      el.classList.toggle('is-hidden', !size);
      if (size) placed.push({ x: p.x, y: p.y, w: size.w, h: size.h });
    }
  }

  function updateMode() {
    const z = map.getZoom();
    let next = 'pins';
    const overview = !filters.tokens.length && !filters.affiliatesOnly && !filters.presbytery;
    if (overview && z < PIN_ZOOM) {
      if (z < PRESBYTERY_ZOOM && !filters.synod && regions.synod.size) next = 'synods';
      else if (regions.presbytery.size) next = 'presbyteries';
    }
    setMode(next);
  }
  map.on('zoomend', updateMode);

  function fillPresbyterySelect() {
    const select = $('presbytery');
    select.textContent = '';
    select.appendChild(new Option(filters.synod ? 'All in this synod' : 'All presbyteries', ''));
    const list = [...regions.presbytery.values()]
      .filter((p) => p.total && (!filters.synod || p.synod === filters.synod))
      .sort((a, b) => a.name.localeCompare(b.name));
    const synodName = (id) => (regions.synod.get(id) || { name: id || '' }).name;
    const groups = new Map();
    for (const p of list) {
      const key = filters.synod ? '' : p.synod;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const [key, items] of [...groups].sort((a, b) => synodName(a[0]).localeCompare(synodName(b[0])))) {
      const parent = key
        ? select.appendChild(Object.assign(document.createElement('optgroup'), { label: synodName(key) }))
        : select;
      for (const p of items) parent.appendChild(new Option(`${p.name} (${p.total.toLocaleString()})`, p.id));
    }
    select.value = filters.presbytery;
  }

  function fillSynodSelect() {
    const select = $('synod');
    for (const s of [...regions.synod.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      if (s.total) select.appendChild(new Option(`${s.name} (${s.total.toLocaleString()})`, s.id));
    }
    select.value = filters.synod;
  }

  $('synod').addEventListener('change', (e) => setRegionFilter(e.target.value, '', true));
  $('presbytery').addEventListener('change', (e) => setRegionFilter(filters.synod, e.target.value, true));

  function addLegend() {
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'synod-legend');
      div.innerHTML = '<p>Average PftK rating</p><span class="synod-legend-bar" aria-hidden="true"></span>' +
        '<div class="synod-legend-ends"><span>2 · Good fit</span><span>3 · Great fit</span></div>' +
        `<p class="legend-faded">Paler: fewer than ${MIN_RATED} rated churches</p>`;
      return div;
    };
    legend.addTo(map);
  }

  // ---------- Boot ----------

  // Outlines are optional: without them the map still works with pins only.
  const getJson = (url, optional) => fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
      return res.json();
    })
    .catch((err) => {
      if (!optional) throw err;
      console.error(err);
      return null;
    });

  Promise.all([
    getJson('data/churches.json'),
    getJson('data/synods.json', true),
    getJson('data/presbyteries.json', true)
  ])
    .then(([payload, synodPayload, presbyteryPayload]) => {
      if (!payload || !Array.isArray(payload.fields) || !Array.isArray(payload.rows)) {
        throw new Error('unexpected data shape');
      }
      churches = parseChurches(payload);
      if (churches.some((c) => c.rating === 1)) document.querySelector('.chip-r1').hidden = false;
      if (presbyteryPayload && Array.isArray(presbyteryPayload.presbyteries)) {
        buildRegions('presbytery', presbyteryPayload.presbyteries, 'presbyteries');
      }
      if (synodPayload && Array.isArray(synodPayload.synods)) buildRegions('synod', synodPayload.synods, 'synods');
      if (regions.synod.size || regions.presbytery.size) addLegend();

      fillSynodSelect();
      const linkedSynod = regions.synod.has(params.get('synod')) ? params.get('synod') : '';
      setRegionFilter(linkedSynod, params.get('presbytery'), !params.get('church') &&
        !!(linkedSynod || regions.presbytery.has(params.get('presbytery'))));

      const linked = params.get('church');
      if (linked && byId.has(linked)) focusChurch(byId.get(linked));
      else if (linked) setActive(null);
    })
    .catch((err) => {
      console.error(err);
      $('count').textContent = 'Couldn’t load church data. Please refresh to try again.';
      $('sheet-label').textContent = 'Couldn’t load church data';
    });

  if (params.get('seminaries') === '1') {
    $('show-seminaries').checked = true;
    setSeminaries(true);
  }
})();

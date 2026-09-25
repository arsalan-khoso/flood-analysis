/* Data layers, chapter callbacks and inline charts for the flood story.
   Layer ids here are what Chapter.on_chapter_enter / on_chapter_exit reference in the admin.

   Performance notes:
   - Raster layers (satellite, MODIS) keep downloading tiles even at opacity 0, so they are
     created with visibility:none and only switched on for the chapters that use them.
   - 3D terrain is enabled per chapter (steep camera angles only) instead of for the whole story.
   - The district and flood-extent payloads load in the background after the first paint. */
(function () {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const GIBS = (layer, date) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  const EMPTY = { type: 'FeatureCollection', features: [] };

  // Layers that cost real bandwidth/GPU when visible - toggled with visibility, not just opacity.
  const HEAVY = ['satellite', 'gibs-2021', 'gibs-2022', 'flood-extent'];
  const TERRAIN_MIN_PITCH = 55;   // below this the story reads fine flat, and flat is much cheaper

  const EXPOSURE_STOPS = [0, 'rgba(120,140,170,0.08)', 0.02, '#4b3f72', 0.1, '#8f3f8f', 0.25, '#d9486f', 0.5, '#ff7a45', 0.8, '#ffd166'];
  const exposureColor = (week) => ['interpolate', ['linear'], ['get', `s${week}`], ...EXPOSURE_STOPS];

  const state = { data: {}, week: 1, recessionTimer: null, map: null, terrainOn: false, needed: new Set() };
  let districtsReady, resolveDistricts;
  districtsReady = new Promise((r) => { resolveDistricts = r; });

  const chapterLayers = (chapter) =>
    new Set((chapter?.onChapterEnter || []).filter((l) => l.opacity > 0).map((l) => l.layer));

  const FloodStory = {
    state,
    exposureColor,
    EXPOSURE_STOPS,
    districtsReady: () => districtsReady,

    async addLayers(map) {
      state.map = map;
      // Small payloads block the first paint; the heavy ones stream in afterwards.
      const [provinces, exposure, event] = await Promise.all(
        [APP.api.provinces, APP.api.exposure + '?n=10', APP.api.event].map((u) => fetch(u).then((r) => r.json())));
      Object.assign(state.data, { provinces, exposure, event });

      map.setFog({ color: 'rgb(14,20,32)', 'high-color': 'rgb(28,52,96)', 'horizon-blend': 0.06,
        'space-color': 'rgb(4,7,14)', 'star-intensity': 0.5 });
      const beforeId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

      map.addSource('satellite', { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 });
      map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite',
        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0 } }, beforeId);

      [['gibs-2021', GIBS('MODIS_Terra_CorrectedReflectance_Bands721', '2021-09-05')],
       ['gibs-2022', GIBS('MODIS_Aqua_CorrectedReflectance_Bands721', '2022-09-04')]].forEach(([id, url]) => {
        map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, minzoom: 3, maxzoom: 8,
          attribution: 'NASA GIBS / MODIS' });
        map.addLayer({ id, type: 'raster', source: id, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0 } }, beforeId);
      });

      map.addSource('provinces', { type: 'geojson', data: provinces });
      // Filled in by loadDistricts() / loadExtent() once the story is already interactive.
      map.addSource('districts', { type: 'geojson', data: EMPTY, promoteId: 'pcode', buffer: 32, tolerance: 0.6 });
      map.addSource('flood-extent', { type: 'geojson', data: EMPTY, buffer: 0, tolerance: 1, attribution: 'UNOSAT / VIIRS' });

      map.addLayer({ id: 'rain-anomaly', type: 'fill', source: 'provinces', paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'rainfall_anomaly_pct'], 0, 'rgba(0,0,0,0)', 500, '#1f6fd1', 750, '#5fd4ff'],
        'fill-opacity': 0 } }, beforeId);

      map.addLayer({ id: 'exposure-fill', type: 'fill', source: 'districts', paint: {
        'fill-color': exposureColor(state.week), 'fill-opacity': 0, 'fill-color-transition': { duration: 600 } } }, beforeId);
      map.addLayer({ id: 'exposure-outline', type: 'line', source: 'districts', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', 'rgba(210,225,255,0.35)'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0.6], 'line-opacity': 0 } }, beforeId);

      map.addLayer({ id: 'flood-extent', type: 'fill', source: 'flood-extent',
        layout: { visibility: 'none' }, paint: { 'fill-color': '#3fb4ff', 'fill-opacity': 0 } }, beforeId);

      map.addLayer({ id: 'province-outline', type: 'line', source: 'provinces', paint: {
        'line-color': '#9fc3ff', 'line-width': 1.2, 'line-opacity': 0 } }, beforeId);

      map.addLayer({ id: 'deaths-3d', type: 'fill-extrusion', source: 'provinces', paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'deaths'], 0, '#2b3a67', 200, '#c2417a', 800, '#ff6b4a'],
        'fill-extrusion-height': 0, 'fill-extrusion-height-transition': { duration: 2000 }, 'fill-extrusion-opacity': 0 } });

      map.addSource('province-labels', { type: 'geojson', data: {
        type: 'FeatureCollection',
        features: provinces.features.filter((f) => f.properties.deaths > 5).map((f) => ({
          type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: f.properties.label } })) } });
      map.addLayer({ id: 'deaths-labels', type: 'symbol', source: 'province-labels', layout: {
        'text-field': ['format', ['to-string', ['get', 'deaths']], { 'font-scale': 1.4 }, '\n', {}, ['upcase', ['get', 'name']], { 'font-scale': 0.7 }],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 15, 'text-allow-overlap': true }, paint: {
        'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.5, 'text-opacity': 0 } });

      map.addSource('incidents', { type: 'geojson', data: { type: 'FeatureCollection', features: event.incidents.map((i) => ({
        type: 'Feature', properties: i, geometry: { type: 'Point', coordinates: [i.lng, i.lat] } })) } });
      map.addLayer({ id: 'incident-dots', type: 'circle', source: 'incidents', paint: {
        'circle-radius': 7, 'circle-color': '#ff5a4e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        'circle-opacity': 0, 'circle-stroke-opacity': 0 } });
      map.addLayer({ id: 'incident-labels', type: 'symbol', source: 'incidents', layout: {
        'text-field': ['get', 'name'], 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-size': 13,
        'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: {
        'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.4, 'text-opacity': 0 } });

      map.on('click', 'incident-dots', (e) => {
        const p = e.features[0].properties;
        new mapboxgl.Popup({ offset: 12, maxWidth: '280px' }).setLngLat(e.lngLat)
          .setHTML(`<b>${p.name}</b><div class="pop-date">${p.date_label}</div><p>${p.description}</p>`).addTo(map);
      });

      renderCharts();
      $('#swipe-range').addEventListener('input', applySwipe);

      loadDistricts();   // background, does not block the story starting
    },

    beforeChapter(chapter, index) {
      clearInterval(state.recessionTimer);
      $('#swipe').hidden = chapter.callback !== 'showSwipe';
      $('#progress-bar').style.width = `${((index + 1) / config.chapters.length) * 100}%`;

      const needed = chapterLayers(chapter);
      state.needed = needed;
      applyVisibility(needed);
      applyTerrain(chapter, needed);
      if (needed.has('flood-extent')) loadExtent();
      renderLegend(needed);
    },

    setWeek(i) {
      state.week = i;
      if (state.map?.getLayer('exposure-fill')) state.map.setPaintProperty('exposure-fill', 'fill-color', exposureColor(i));
      document.dispatchEvent(new CustomEvent('flood:week', { detail: i }));
    },

    renderLegend,

    /** Show/hide one of the bandwidth-heavy layers outside the chapter flow (explore mode). */
    setHeavy(id, on) {
      const map = state.map;
      if (!map.getLayer(id)) return;
      if (on) {
        state.needed.add(id);
        map.setLayoutProperty(id, 'visibility', 'visible');
        if (id === 'flood-extent') loadExtent();
      } else {
        state.needed.delete(id);
        setTimeout(() => {
          if (!state.needed.has(id) && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }, 1400);
      }
    },
  };

  // ---------------------------------------------------------------- cost control

  function applyVisibility(needed) {
    const map = state.map;
    HEAVY.forEach((id) => {
      if (!map.getLayer(id)) return;
      const visible = map.getLayoutProperty(id, 'visibility') !== 'none';
      if (needed.has(id) && !visible) {
        map.setLayoutProperty(id, 'visibility', 'visible');
      } else if (!needed.has(id) && visible) {
        // let the opacity fade finish, then stop the layer fetching tiles
        setTimeout(() => {
          if (!state.needed.has(id) && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }, 1400);
      }
    });
  }

  function applyTerrain(chapter, needed) {
    const map = state.map;
    if (!config.use3dTerrain || !map.getSource('mapbox-dem')) return;
    // Terrain is the most expensive thing on the map: only the steep, close-up chapters need it,
    // and it fights with the extruded province columns.
    const want = (chapter.location.pitch || 0) >= TERRAIN_MIN_PITCH && !needed.has('deaths-3d');
    if (want === state.terrainOn) return;
    state.terrainOn = want;
    map.setTerrain(want ? { source: 'mapbox-dem', exaggeration: 1.3 } : null);
  }

  let districtsLoading = false;
  function loadDistricts() {
    if (districtsLoading) return districtsReady;
    districtsLoading = true;
    fetch(APP.api.districts).then((r) => r.json()).then((districts) => {
      state.data.districts = districts;
      state.map.getSource('districts').setData(districts);
      const peak = districts.periods.findIndex((p) => p.label === state.data.exposure.peak_label);
      state.week = Math.max(0, peak);
      state.map.setPaintProperty('exposure-fill', 'fill-color', exposureColor(state.week));
      // the chapter on screen may already want these layers
      const chapter = config.chapters[StoryEngine.current()];
      (chapter.onChapterEnter || []).filter((l) => l.layer.startsWith('exposure')).forEach(setLayerOpacity);
      document.dispatchEvent(new CustomEvent('flood:data'));
      resolveDistricts(districts);
    }).catch((e) => console.error('districts failed', e));
    return districtsReady;
  }

  let extentLoaded = false;
  function loadExtent() {
    if (extentLoaded) return;
    extentLoaded = true;
    fetch(APP.floodExtentUrl).then((r) => r.json())
      .then((fc) => state.map.getSource('flood-extent').setData(fc))
      .catch((e) => { extentLoaded = false; console.error('flood extent failed', e); });
  }

  // ---------------------------------------------------------------- callbacks (Chapter.callback)

  window.showSwipe = function () {
    const r = $('#swipe-range');
    r.value = 0; applySwipe();
    let v = 0;
    setTimeout(function step() {
      v += 2; r.value = v; applySwipe();
      if (v < 100 && !$('#swipe').hidden) requestAnimationFrame(step);
    }, 2500);
  };

  window.showExposureWeek1 = function () {
    districtsReady.then(() => FloodStory.setWeek(state.week));
  };

  window.playRecession = function () {
    districtsReady.then((districts) => {
      const n = districts.periods.length;
      let i = 1;
      FloodStory.setWeek(i);
      clearInterval(state.recessionTimer);
      state.recessionTimer = setInterval(() => {
        i = i >= n - 1 ? 1 : i + 1;
        FloodStory.setWeek(i);
        document.querySelectorAll('.timeline-chart .pt').forEach((el, j) => el.classList.toggle('on', j === i));
      }, 1400);
    });
  };

  window.raiseColumns = function () {
    const m = state.map;
    m.setPaintProperty('deaths-3d', 'fill-extrusion-height', 0);
    setTimeout(() => m.setPaintProperty('deaths-3d', 'fill-extrusion-height', ['*', ['get', 'deaths'], 450]), 300);
  };

  function applySwipe() {
    const m = state.map;
    if (!m?.getLayer('gibs-2022') || $('#swipe').hidden) return;
    m.setPaintProperty('gibs-2022', 'raster-opacity-transition', { duration: 0 });
    m.setPaintProperty('gibs-2022', 'raster-opacity', Number($('#swipe-range').value) / 100);
  }

  // ---------------------------------------------------------------- legend

  function renderLegend(layers) {
    const out = [];
    if (layers.has('exposure-fill')) {
      const p = state.data.districts?.periods[state.week];
      out.push(`<div class="lg-title">Population exposed${p ? ` · <span id="lg-week">${p.label}</span>` : ''}</div>
        <div class="lg-grad" style="background:linear-gradient(90deg,#4b3f72,#8f3f8f,#d9486f,#ff7a45,#ffd166)"></div>
        <div class="lg-scale"><span>2%</span><span>25%</span><span>80%+</span></div>`);
    }
    if (layers.has('flood-extent')) out.push('<div class="lg-row"><i style="background:#3fb4ff"></i>Flood water (VIIRS, Jul–Aug)</div>');
    if (layers.has('deaths-3d')) out.push(`<div class="lg-title">Deaths by province (NDMA)</div>
        <div class="lg-grad" style="background:linear-gradient(90deg,#2b3a67,#c2417a,#ff6b4a)"></div>
        <div class="lg-scale"><span>fewer</span><span>more</span></div>`);
    if (layers.has('rain-anomaly')) out.push(`<div class="lg-title">August rain vs normal (PMD)</div>
        <div class="lg-grad" style="background:linear-gradient(90deg,#1f6fd1,#5fd4ff)"></div>
        <div class="lg-scale"><span>+500%</span><span>+750%</span></div>`);
    if (layers.has('incident-dots')) out.push('<div class="lg-row"><i class="dot"></i>Key flood event</div>');
    $('#legend').innerHTML = out.join('');
    $('#legend').hidden = !out.length;
  }
  document.addEventListener('flood:week', (e) => {
    const el = document.getElementById('lg-week');
    if (el && state.data.districts) el.textContent = state.data.districts.periods[e.detail].label;
  });

  // ---------------------------------------------------------------- inline charts in chapter descriptions

  function renderCharts() {
    const { exposure, provinces } = state.data;
    document.querySelectorAll('[data-chart="top-districts"]').forEach((el) => {
      const rows = exposure.top_districts;
      const max = rows[0]?.exposed || 1;
      el.innerHTML = `<div class="chart-title">Most people exposed, ${exposure.peak_label} (UNOSAT)</div>` +
        rows.map((r) => `<div class="bar-row" title="${r.name}: ${fmt(r.exposed)} people, ${(r.exposed_share * 100).toFixed(0)}% of population">
          <span class="bar-label">${r.name}</span>
          <span class="bar"><i style="width:${(r.exposed / max) * 100}%"></i></span>
          <span class="bar-value">${short(r.exposed)}</span></div>`).join('');
    });

    document.querySelectorAll('[data-chart="flood-timeline"]').forEach((el) => {
      const weeks = exposure.timeline.filter((t) => t.weekly);
      const W = 320, H = 120, P = 8, max = Math.max(...weeks.map((w) => w.exposed));
      const x = (i) => P + (i / (weeks.length - 1)) * (W - 2 * P);
      const y = (v) => H - 22 - (v / max) * (H - 36);
      const line = weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w.exposed).toFixed(1)}`).join('');
      el.innerHTML = `<div class="chart-title">People in flooded areas, by satellite week (UNOSAT)</div>
        <svg class="timeline-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Exposed population fell from ${short(weeks[0].exposed)} to ${short(weeks.at(-1).exposed)}">
          <path d="${line}L${x(weeks.length - 1)},${H - 22}L${x(0)},${H - 22}Z" class="area"/>
          <path d="${line}" class="line"/>
          ${weeks.map((w, i) => `<g class="pt" data-i="${i}"><circle cx="${x(i)}" cy="${y(w.exposed)}" r="3.5"/>
            <title>${w.label}: ${fmt(w.exposed)} people, ${fmt(w.flood_km2)} km²</title></g>`).join('')}
          <text x="${x(0)}" y="${H - 6}" class="axis">${weeks[0].label}</text>
          <text x="${x(weeks.length - 1)}" y="${H - 6}" class="axis" text-anchor="end">${weeks.at(-1).label}</text>
          <text x="${x(0) + 6}" y="${y(weeks[0].exposed) - 6}" class="val">${short(weeks[0].exposed)}</text>
          <text x="${x(weeks.length - 1) - 4}" y="${y(weeks.at(-1).exposed) - 8}" class="val" text-anchor="end">${short(weeks.at(-1).exposed)}</text>
        </svg>`;
    });

    document.querySelectorAll('[data-chart="province-deaths"]').forEach((el) => {
      const rows = provinces.features.map((f) => f.properties).sort((a, b) => b.deaths - a.deaths);
      const max = rows[0].deaths;
      el.innerHTML = '<div class="chart-title">Deaths by province (NDMA)</div>' + rows.map((r) => `
        <div class="bar-row"><span class="bar-label">${r.name}</span>
        <span class="bar deaths"><i style="width:${(r.deaths / max) * 100}%"></i></span>
        <span class="bar-value">${fmt(r.deaths)}</span></div>`).join('');
    });
  }

  window.FloodStory = FloodStory;
})();

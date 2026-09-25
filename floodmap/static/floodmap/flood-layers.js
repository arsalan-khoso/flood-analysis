/* Data layers, chapter callbacks and inline charts for the flood story.
   Layer ids here are what Chapter.on_chapter_enter / on_chapter_exit reference in the admin. */
(function () {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const GIBS = (layer, date) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;

  // Sequential scale for "share of population exposed"
  const EXPOSURE_STOPS = [0, 'rgba(120,140,170,0.08)', 0.02, '#4b3f72', 0.1, '#8f3f8f', 0.25, '#d9486f', 0.5, '#ff7a45', 0.8, '#ffd166'];
  const exposureColor = (week) => ['interpolate', ['linear'], ['get', `s${week}`], ...EXPOSURE_STOPS];

  const state = { data: {}, week: 1, recessionTimer: null, map: null };

  const FloodStory = {
    state,
    exposureColor,
    EXPOSURE_STOPS,

    async addLayers(map) {
      state.map = map;
      const [districts, provinces, exposure, event, extent] = await Promise.all(
        [APP.api.districts, APP.api.provinces, APP.api.exposure + '?n=10', APP.api.event, APP.floodExtentUrl]
          .map((u) => fetch(u).then((r) => r.json())));
      Object.assign(state.data, { districts, provinces, exposure, event, extent });
      state.week = Math.max(0, districts.periods.findIndex((p) => p.label === exposure.peak_label));

      map.setFog({ color: 'rgb(14,20,32)', 'high-color': 'rgb(28,52,96)', 'horizon-blend': 0.06,
        'space-color': 'rgb(4,7,14)', 'star-intensity': 0.5 });
      const beforeId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

      if (map.getSource('mapbox-dem')) {
        map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'mapbox-dem',
          paint: { 'hillshade-shadow-color': '#04060b', 'hillshade-highlight-color': '#36445e', 'hillshade-exaggeration': 0.55 } }, beforeId);
      }

      map.addSource('satellite', { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 });
      map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 0 } }, beforeId);

      [['gibs-2021', GIBS('MODIS_Terra_CorrectedReflectance_Bands721', '2021-09-05')],
       ['gibs-2022', GIBS('MODIS_Aqua_CorrectedReflectance_Bands721', '2022-09-04')]].forEach(([id, url]) => {
        map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 9, attribution: 'NASA GIBS / MODIS' });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0 } }, beforeId);
      });

      map.addSource('provinces', { type: 'geojson', data: provinces });
      map.addSource('districts', { type: 'geojson', data: districts, promoteId: 'pcode' });
      map.addSource('flood-extent', { type: 'geojson', data: extent, attribution: 'UNOSAT / VIIRS' });

      map.addLayer({ id: 'rain-anomaly', type: 'fill', source: 'provinces', paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'rainfall_anomaly_pct'], 0, 'rgba(0,0,0,0)', 500, '#1f6fd1', 750, '#5fd4ff'],
        'fill-opacity': 0 } }, beforeId);

      map.addLayer({ id: 'exposure-fill', type: 'fill', source: 'districts', paint: {
        'fill-color': exposureColor(state.week), 'fill-opacity': 0, 'fill-color-transition': { duration: 600 } } }, beforeId);
      map.addLayer({ id: 'exposure-outline', type: 'line', source: 'districts', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffffff', 'rgba(210,225,255,0.35)'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0.6], 'line-opacity': 0 } }, beforeId);

      map.addLayer({ id: 'flood-extent', type: 'fill', source: 'flood-extent', paint: {
        'fill-color': '#3fb4ff', 'fill-opacity': 0 } }, beforeId);

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
    },

    beforeChapter(chapter, index) {
      clearInterval(state.recessionTimer);
      $('#swipe').hidden = chapter.callback !== 'showSwipe';
      $('#progress-bar').style.width = `${((index + 1) / config.chapters.length) * 100}%`;
      const layers = new Set(chapter.onChapterEnter.filter((l) => l.opacity > 0).map((l) => l.layer));
      renderLegend(layers);
    },

    setWeek(i) {
      state.week = i;
      if (state.map?.getLayer('exposure-fill')) state.map.setPaintProperty('exposure-fill', 'fill-color', exposureColor(i));
      document.dispatchEvent(new CustomEvent('flood:week', { detail: i }));
    },

    renderLegend,
  };

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
    FloodStory.setWeek(state.week = Math.max(0, state.data.districts.periods.findIndex((p) => p.label === state.data.exposure.peak_label)));
  };

  window.playRecession = function () {
    const n = state.data.districts.periods.length;
    let i = 1;
    FloodStory.setWeek(i);
    state.recessionTimer = setInterval(() => {
      i = i >= n - 1 ? 1 : i + 1;
      FloodStory.setWeek(i);
      document.querySelectorAll('.timeline-chart .pt').forEach((el, j) => el.classList.toggle('on', j === i));
    }, 1400);
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
    if (el) el.textContent = state.data.districts.periods[e.detail].label;
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

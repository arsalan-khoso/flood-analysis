/* Explore mode: free map navigation, weekly exposure slider, district profiles. */
(function () {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const pct = (v) => (v * 100).toFixed(v < 0.01 && v > 0 ? 1 : 0) + '%';
  let exploring = false, selected = null, wired = false;

  const EXPLORE_LAYERS = [
    { layer: 'exposure-fill', opacity: 0.8, duration: 800 },
    { layer: 'exposure-outline', opacity: 0.7, duration: 800 },
    { layer: 'province-outline', opacity: 0.8 },
    { layer: 'incident-dots', opacity: 1 }, { layer: 'incident-labels', opacity: 1 },
  ];
  const STORY_ONLY = ['satellite', 'gibs-2021', 'gibs-2022', 'rain-anomaly', 'deaths-3d', 'deaths-labels', 'flood-extent'];

  async function enter() {
    if (typeof map === 'undefined') return;
    if (!FloodStory.state.data.districts) {
      $('#btn-explore').textContent = 'Loading…';
      await FloodStory.districtsReady();
    }
    exploring = true;
    StoryEngine.setAuto(false); updateAutoButton();
    document.body.classList.add('exploring');
    $('#explore').hidden = false; $('#swipe').hidden = true;
    $('#btn-explore').textContent = '← Back to story';
    StoryEngine.setInteractive(true);
    map.stop();
    STORY_ONLY.forEach((l) => { setLayerOpacity({ layer: l, opacity: 0, duration: 400 }); FloodStory.setHeavy(l, false); });
    EXPLORE_LAYERS.forEach(setLayerOpacity);
    if (!wired) wire();
    $('#week-range').value = FloodStory.state.week;
    FloodStory.setWeek(FloodStory.state.week);
    FloodStory.renderLegend(new Set(['exposure-fill', 'incident-dots', ...($('#toggle-extent').checked ? ['flood-extent'] : [])]));
    map.flyTo({ center: [69.3, 29.8], zoom: 4.9, pitch: 30, bearing: 0, duration: 2500 });
    renderNational();
  }

  function exit() {
    exploring = false;
    document.body.classList.remove('exploring');
    $('#explore').hidden = true;
    $('#btn-explore').textContent = 'Explore map';
    StoryEngine.setInteractive(false);
    clearSelection();
    [...EXPLORE_LAYERS.map((l) => l.layer), 'flood-extent'].forEach((l) => setLayerOpacity({ layer: l, opacity: 0, duration: 400 }));
    FloodStory.setHeavy('flood-extent', false);
    const ch = config.chapters[StoryEngine.current()];
    ch.onChapterEnter.forEach(setLayerOpacity);
    FloodStory.beforeChapter(ch, StoryEngine.current());
    StoryEngine.returnToChapter();
  }

  function wire() {
    wired = true;
    const periods = FloodStory.state.data.districts.periods;
    $('#week-range').max = periods.length - 1;
    $('#week-range').addEventListener('input', (e) => FloodStory.setWeek(Number(e.target.value)));
    document.addEventListener('flood:week', (e) => {
      $('#week-label').textContent = periods[e.detail].label + (periods[e.detail].weekly ? '' : ' (monthly max)');
      $('#week-range').value = e.detail;
      if (exploring) renderNational();
      if (selected) showDistrict(selected.pcode, false);
    });
    $('#toggle-extent').addEventListener('change', (e) => {
      FloodStory.setHeavy('flood-extent', e.target.checked);
      setLayerOpacity({ layer: 'flood-extent', opacity: e.target.checked ? 0.6 : 0, duration: 500 });
      FloodStory.renderLegend(new Set(['exposure-fill', 'incident-dots', ...(e.target.checked ? ['flood-extent'] : [])]));
    });

    const features = FloodStory.state.data.districts.features;
    $('#district-list').innerHTML = features.map((f) => `<option value="${f.properties.name}">${f.properties.province}</option>`).join('');
    $('#district-search').addEventListener('change', (e) => {
      const f = features.find((x) => x.properties.name.toLowerCase() === e.target.value.trim().toLowerCase());
      if (f) { showDistrict(f.properties.pcode, true); }
    });

    map.on('click', 'exposure-fill', (e) => {
      if (!exploring) return;
      showDistrict(e.features[0].properties.pcode, false);
    });
    map.on('mousemove', 'exposure-fill', () => { if (exploring) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'exposure-fill', () => { map.getCanvas().style.cursor = ''; });
  }

  function renderNational() {
    const w = FloodStory.state.week;
    const t = FloodStory.state.data.exposure.timeline[w];
    $('#national-stats').innerHTML = `
      <div><b>${fmt(t.flood_km2)} km²</b><span>flood water</span></div>
      <div><b>${(t.exposed / 1e6).toFixed(1)}M</b><span>people exposed</span></div>`;
  }

  function clearSelection() {
    if (selected) map.setFeatureState({ source: 'districts', id: selected.pcode }, { selected: false });
    selected = null;
  }

  async function showDistrict(pcode, fly) {
    const feature = FloodStory.state.data.districts.features.find((f) => f.properties.pcode === pcode);
    if (!feature) return;
    if (!selected || selected.pcode !== pcode) {
      clearSelection();
      selected = feature.properties;
      map.setFeatureState({ source: 'districts', id: pcode }, { selected: true });
    }
    if (fly) {
      const b = new mapboxgl.LngLatBounds();
      const walk = (c) => (typeof c[0] === 'number' ? b.extend(c) : c.forEach(walk));
      walk(feature.geometry.coordinates);
      map.fitBounds(b, { padding: { top: 80, bottom: 80, left: 80, right: 420 }, pitch: 45, maxZoom: 9, duration: 2500 });
    }
    const d = await fetch(APP.api.district.replace('PCODE', pcode)).then((r) => r.json());
    const w = FloodStory.state.week;
    const cur = d.weeks[w];
    const weekly = d.weeks.filter((_, i) => FloodStory.state.data.districts.periods[i].weekly);
    const max = Math.max(1, ...weekly.map((x) => x.exposed));
    $('#district-card').innerHTML = `
      <div class="dc-name">${d.name}</div>
      <div class="dc-sub">${d.province} · population ${fmt(d.population)} · ${fmt(d.area_km2)} km²</div>
      <div class="dc-stats">
        <div><b>${fmt(cur.exposed)}</b><span>people exposed<br>(${pct(cur.exposed_share)})</span></div>
        <div><b>${fmt(cur.flood_km2)} km²</b><span>flood water<br>(${pct(cur.flooded_share)} of area)</span></div>
      </div>
      <div class="chart-title">Exposed population by satellite week</div>
      <div class="spark">${weekly.map((x) => `<i style="height:${Math.max(2, (x.exposed / max) * 100)}%" title="${x.label}: ${fmt(x.exposed)}"></i>`).join('')}</div>
      <div class="spark-axis"><span>${weekly[0].label}</span><span>${weekly.at(-1).label}</span></div>
      ${d.province_deaths != null ? `<p class="muted">${d.province} recorded ${fmt(d.province_deaths)} deaths (NDMA, province total).</p>` : ''}
      <button class="btn accent" id="dc-ai">✦ AI risk brief for ${d.name}</button>`;
    $('#dc-ai').addEventListener('click', () => FloodChat.ask(
      `Give me a flood exposure and risk brief for ${d.name} district.`, `${d.name} district, ${d.province}`));
  }

  function updateAutoButton() {
    $('#btn-auto').textContent = config.auto ? '❚❚ Pause' : '▶ Auto-play';
  }

  $('#btn-explore').addEventListener('click', () => (exploring ? exit() : enter()));
  $('#explore-close').addEventListener('click', exit);
  $('#btn-auto').addEventListener('click', () => {
    if (exploring) exit();
    StoryEngine.setAuto(!config.auto); updateAutoButton();
  });
  ['wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => {
    if (config.auto) { StoryEngine.setAuto(false); updateAutoButton(); }
  }, { passive: true }));
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'explore') enter();
    if (action === 'ai') FloodChat.open();
  });

  window.FloodExplore = { enter, exit, showDistrict, isExploring: () => exploring };
})();

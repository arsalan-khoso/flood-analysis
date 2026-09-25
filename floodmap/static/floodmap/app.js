(() => {
  const CFG = window.APP_CONFIG;
  const $ = (s) => document.querySelector(s);
  const GIBS = (layer, date) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  const PROVINCE_LABELS = {
    Sindh: [68.6, 25.9], Balochistan: [65.6, 28.2], "Khyber Pakhtunkhwa": [71.9, 34.6],
    Punjab: [72.4, 30.6], "Azad Kashmir": [73.9, 34.2], "Gilgit-Baltistan": [75.2, 36.0],
  };
  const LAYER_GROUPS = {
    provinces: ["prov-line"],
    districts: ["dist-fill", "dist-line"],
    extrusion: ["prov-extrusion"],
    gibs: ["gibs-2021", "gibs-2022"],
    satellite: ["sat-hi"],
    rainfall: ["prov-rain"],
  };

  let D, chapters, map, current = -1, playing = false, playTimer = null, rotating = false;
  const incidentMarkers = [], provinceMarkers = [];
  const chatHistory = [];

  if (!CFG.mapboxToken) { $("#no-token").hidden = false; }

  init().catch((err) => { console.error(err); });

  async function init() {
    const [data, adm1, adm2] = await Promise.all(
      [CFG.dataUrl, CFG.adm1Url, CFG.adm2Url].map((u) => fetch(u).then((r) => r.json())));
    D = data;
    chapters = window.STORY(D);
    enrich(adm1, adm2);
    renderChapters();
    renderSources();
    setupChat();
    if (!CFG.mapboxToken) return;

    mapboxgl.accessToken = CFG.mapboxToken;
    map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/dark-v11",
      center: [69.4, 30.0], zoom: 3.6, pitch: 20,
      projection: "globe",
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.on("style.load", () => {
      addLayers(adm1, adm2);
      setupInteractions();
      observeChapters();
      activate(0);
    });
  }

  // ---------------------------------------------------------------- data

  function enrich(adm1, adm2) {
    const maxDeaths = Math.max(...Object.values(D.provinces).map((p) => p.deaths));
    adm1.features.forEach((f) => {
      const p = D.provinces[f.properties.shapeName] || { deaths: 0 };
      f.properties.deaths = p.deaths;
      f.properties.deathShare = p.deaths / maxDeaths;
      f.properties.rain = { Sindh: D.rainfall.august_sindh_pct_above_normal,
        Balochistan: D.rainfall.august_balochistan_pct_above_normal }[f.properties.shapeName] || 0;
    });
    const severe = new Set(D.districts.severe), affected = new Set(D.districts.affected);
    adm2.features.forEach((f, i) => {
      const n = f.properties.shapeName;
      f.id = i;
      f.properties.impact = severe.has(n) ? 2 : affected.has(n) ? 1 : 0;
    });
    window.__geo = { adm1, adm2 };
  }

  // ---------------------------------------------------------------- map layers

  function addLayers(adm1, adm2) {
    map.setFog({
      color: "rgb(14, 20, 32)", "high-color": "rgb(28, 52, 96)", "horizon-blend": 0.06,
      "space-color": "rgb(4, 7, 14)", "star-intensity": 0.5,
    });
    map.addSource("dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
    map.addSource("dem-hs", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
    map.setTerrain({ source: "dem", exaggeration: 1.2 });

    const beforeId = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs",
      paint: { "hillshade-shadow-color": "#05070c", "hillshade-highlight-color": "#3a4a66", "hillshade-exaggeration": 0.6 } }, beforeId);

    map.addSource("sat-hi", { type: "raster", url: "mapbox://mapbox.satellite", tileSize: 256 });
    map.addLayer({ id: "sat-hi", type: "raster", source: "sat-hi",
      paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 1500 } } }, beforeId);

    [["gibs-2021", GIBS("MODIS_Terra_CorrectedReflectance_Bands721", "2021-09-05")],
     ["gibs-2022", GIBS("MODIS_Aqua_CorrectedReflectance_Bands721", "2022-09-04")]].forEach(([id, url]) => {
      map.addSource(id, { type: "raster", tiles: [url], tileSize: 256, maxzoom: 9,
        attribution: "Imagery: NASA GIBS / MODIS" });
      map.addLayer({ id, type: "raster", source: id,
        paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 1200 } } }, beforeId);
    });

    map.addSource("adm1", { type: "geojson", data: adm1 });
    map.addSource("adm2", { type: "geojson", data: adm2 });

    map.addLayer({ id: "prov-rain", type: "fill", source: "adm1",
      paint: {
        "fill-color": ["interpolate", ["linear"], ["get", "rain"], 0, "rgba(0,0,0,0)", 500, "#1f6fd1", 750, "#5fd4ff"],
        "fill-opacity": 0, "fill-opacity-transition": { duration: 1000 },
      } }, beforeId);

    map.addLayer({ id: "dist-fill", type: "fill", source: "adm2",
      paint: {
        "fill-color": ["match", ["get", "impact"], 2, "#ff5a4e", 1, "#ffb547", "rgba(120,140,170,0.15)"],
        "fill-opacity": 0, "fill-opacity-transition": { duration: 1000 },
      } }, beforeId);
    map.addLayer({ id: "dist-line", type: "line", source: "adm2",
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(220,230,255,0.35)"],
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0.5],
        "line-opacity": 0, "line-opacity-transition": { duration: 1000 },
      } }, beforeId);
    map.addLayer({ id: "prov-line", type: "line", source: "adm1",
      paint: { "line-color": "#9fc3ff", "line-width": 1.2, "line-opacity": 0, "line-opacity-transition": { duration: 1000 } } }, beforeId);

    map.addLayer({ id: "prov-extrusion", type: "fill-extrusion", source: "adm1",
      paint: {
        "fill-extrusion-color": ["interpolate", ["linear"], ["get", "deathShare"], 0, "#2b3a67", 0.3, "#c2417a", 1, "#ff6b4a"],
        "fill-extrusion-height": 0,
        "fill-extrusion-height-transition": { duration: 1800 },
        "fill-extrusion-opacity": 0.88,
      }, layout: { visibility: "none" } });

    // HTML markers: incidents (pulsing) and province death labels
    D.incidents.forEach((inc) => {
      const el = document.createElement("div");
      el.className = "incident";
      el.innerHTML = `<span class="pulse"></span><span class="incident-label">${inc.name}</span>`;
      const m = new mapboxgl.Marker({ element: el })
        .setLngLat([inc.lng, inc.lat])
        .setPopup(new mapboxgl.Popup({ offset: 14, maxWidth: "280px" })
          .setHTML(`<b>${inc.name}</b><div class="pop-date">${inc.date}</div><p>${inc.text}</p>`));
      incidentMarkers.push(m);
    });
    Object.entries(PROVINCE_LABELS).forEach(([name, ll]) => {
      const el = document.createElement("div");
      el.className = "prov-label";
      el.innerHTML = `<b>${D.provinces[name].deaths.toLocaleString()}</b><span>${name}</span>`;
      provinceMarkers.push(new mapboxgl.Marker({ element: el }).setLngLat(ll));
    });
  }

  function setLayers(visible) {
    const show = (id, on, prop, value = 1) => map.getLayer(id) && map.setPaintProperty(id, prop, on ? value : 0);
    show("prov-line", visible.provinces, "line-opacity", 0.8);
    show("prov-rain", visible.rainfall, "fill-opacity", 0.55);
    show("dist-fill", visible.districts, "fill-opacity", 0.5);
    show("dist-line", visible.districts, "line-opacity", 1);
    show("sat-hi", visible.satellite, "raster-opacity", 1);
    show("gibs-2021", visible.gibs, "raster-opacity", 1);
    show("gibs-2022", visible.gibs, "raster-opacity", visible.gibs ? Number($("#swipe-range").value) / 100 : 0);

    map.setLayoutProperty("prov-extrusion", "visibility", visible.extrusion ? "visible" : "none");
    map.setPaintProperty("prov-extrusion", "fill-extrusion-height",
      visible.extrusion ? ["*", ["get", "deaths"], 420] : 0);

    incidentMarkers.forEach((m) => (visible.incidents ? m.addTo(map) : m.remove()));
    provinceMarkers.forEach((m) => (visible.extrusion ? m.addTo(map) : m.remove()));
    renderLegend(visible);
  }

  // ---------------------------------------------------------------- story

  function renderChapters() {
    $("#chapters").innerHTML = chapters.map((c, i) => `
      <section class="chapter" id="ch-${c.id}" data-index="${i}">
        <div class="kicker">${c.kicker}</div>
        <h2>${c.title}</h2>
        <p>${c.body}</p>
        ${c.stats ? `<div class="stats">${c.stats}</div>` : ""}
        ${c.chart ? deathChart() : ""}
        ${c.cta ? `<div class="cta"><button class="btn accent" data-open-ai>✦ Ask the AI analyst</button>
                    <button class="btn ghost" data-explore>Free explore</button></div>` : ""}
      </section>`).join("");
    document.querySelectorAll("[data-open-ai]").forEach((b) => b.addEventListener("click", () => openChat()));
    document.querySelectorAll("[data-explore]").forEach((b) => b.addEventListener("click", explore));
  }

  function deathChart() {
    const pts = D.death_timeline.map((p) => ({ t: new Date(p.date).getTime(), v: p.deaths }));
    const W = 300, H = 90, P = 6;
    const t0 = pts[0].t, t1 = pts.at(-1).t, vMax = Math.max(...pts.map((p) => p.v));
    const xy = pts.map((p) => [P + ((p.t - t0) / (t1 - t0)) * (W - 2 * P), H - P - (p.v / vMax) * (H - 2 * P)]);
    const line = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const area = `${line}L${xy.at(-1)[0]},${H - P}L${xy[0][0]},${H - P}Z`;
    return `<figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative deaths rising from zero in June to ${vMax} by November 2022">
        <path d="${area}" class="chart-area"/><path d="${line}" class="chart-line"/>
        ${xy.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" class="chart-dot"><title>${D.death_timeline[i].date}: ${pts[i].v}</title></circle>`).join("")}
      </svg>
      <figcaption><span>14 Jun</span><span>Cumulative deaths (NDMA sitreps)</span><span>Nov</span></figcaption>
    </figure>`;
  }

  function observeChapters() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) activate(Number(e.target.dataset.index)); });
    }, { root: $("#story"), threshold: 0.6 });
    document.querySelectorAll(".chapter").forEach((el) => io.observe(el));
  }

  function activate(i) {
    if (i === current || !map) return;
    current = i;
    const c = chapters[i];
    document.querySelectorAll(".chapter").forEach((el, j) => el.classList.toggle("active", j === i));
    $("#progress-bar").style.width = `${((i + 1) / chapters.length) * 100}%`;
    $("#swipe").hidden = !c.swipe;
    setLayers(c.layers || {});
    map.setTerrain({ source: "dem", exaggeration: c.exaggeration || 1.2 });
    rotating = false;
    map.flyTo({ ...c.camera, duration: 4200, essential: true, curve: 1.6 });
    if (c.swipe) animateSwipe();
    if (c.rotate) map.once("moveend", () => { rotating = true; spin(); });
  }

  function spin() {
    if (!rotating) return;
    map.easeTo({ bearing: map.getBearing() + 12, duration: 6000, easing: (t) => t });
    map.once("moveend", spin);
  }

  function animateSwipe() {
    const r = $("#swipe-range");
    let v = 0;
    const step = () => {
      v += 2;
      r.value = v; applySwipe();
      if (v < 100) requestAnimationFrame(step);
    };
    r.value = 0; applySwipe();
    setTimeout(() => requestAnimationFrame(step), 2500);
  }
  function applySwipe() {
    if (map.getLayer("gibs-2022")) {
      map.setPaintProperty("gibs-2022", "raster-opacity-transition", { duration: 0 });
      map.setPaintProperty("gibs-2022", "raster-opacity", Number($("#swipe-range").value) / 100);
    }
  }
  $("#swipe-range").addEventListener("input", applySwipe);

  // ---------------------------------------------------------------- controls

  function scrollToChapter(i) {
    document.querySelector(`.chapter[data-index="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function togglePlay(force) {
    playing = force ?? !playing;
    $("#btn-play").textContent = playing ? "❚❚ Pause" : "▶ Play cinematic";
    clearInterval(playTimer);
    if (!playing) return;
    document.body.classList.remove("exploring");
    const next = () => {
      if (current >= chapters.length - 1) { togglePlay(false); return; }
      scrollToChapter(current + 1);
    };
    if (current >= chapters.length - 1) scrollToChapter(0); else next();
    playTimer = setInterval(next, 9000);
  }

  function explore() {
    togglePlay(false);
    rotating = false;
    document.body.classList.toggle("exploring");
    const on = document.body.classList.contains("exploring");
    $("#btn-explore").textContent = on ? "Back to story" : "Explore map";
    if (on) { setLayers({ districts: true, provinces: true, incidents: true }); $("#swipe").hidden = true; }
    else { const c = current; current = -1; activate(c); }
  }

  $("#btn-play").addEventListener("click", () => togglePlay());
  $("#btn-explore").addEventListener("click", explore);
  $("#btn-ai").addEventListener("click", () => openChat());
  $("#story").addEventListener("wheel", () => playing && togglePlay(false), { passive: true });
  $("#story").addEventListener("touchstart", () => playing && togglePlay(false), { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") scrollToChapter(Math.min(current + 1, chapters.length - 1));
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") scrollToChapter(Math.max(current - 1, 0));
  });

  // ---------------------------------------------------------------- interactions

  function setupInteractions() {
    let hoverId = null;
    map.on("mousemove", "dist-fill", (e) => {
      if (!e.features.length) return;
      map.getCanvas().style.cursor = "pointer";
      if (hoverId !== null) map.setFeatureState({ source: "adm2", id: hoverId }, { hover: false });
      hoverId = e.features[0].id;
      map.setFeatureState({ source: "adm2", id: hoverId }, { hover: true });
    });
    map.on("mouseleave", "dist-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoverId !== null) map.setFeatureState({ source: "adm2", id: hoverId }, { hover: false });
      hoverId = null;
    });
    map.on("click", "dist-fill", (e) => {
      if (map.getPaintProperty("dist-fill", "fill-opacity") === 0) return;
      const { shapeName, impact } = e.features[0].properties;
      const label = ["Not on calamity lists", "Flood-affected", "Severely affected"][impact];
      const cls = ["none", "mid", "high"][impact];
      const html = `<div class="pop">
        <b>${shapeName}</b><div class="badge ${cls}">${label}</div>
        <button class="btn accent small" data-ask="${shapeName}">✦ AI impact brief</button></div>`;
      const popup = new mapboxgl.Popup({ offset: 6 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
      popup.getElement().querySelector("[data-ask]").addEventListener("click", () => {
        popup.remove();
        openChat();
        sendQuestion(`Give me a flood impact and risk brief for ${shapeName} district.`, `${shapeName} district`);
      });
    });
  }

  function renderLegend(v) {
    const items = [];
    if (v.districts) items.push(`<div class="lg-title">District impact (2022)</div>
      <div class="lg-row"><i style="background:#ff5a4e"></i>Severely affected</div>
      <div class="lg-row"><i style="background:#ffb547"></i>Flood-affected</div>`);
    if (v.extrusion) items.push(`<div class="lg-title">Deaths by province</div>
      <div class="lg-grad" style="background:linear-gradient(90deg,#2b3a67,#c2417a,#ff6b4a)"></div>
      <div class="lg-scale"><span>fewer</span><span>more</span></div>`);
    if (v.rainfall) items.push(`<div class="lg-title">August rain vs normal</div>
      <div class="lg-grad" style="background:linear-gradient(90deg,#1f6fd1,#5fd4ff)"></div>
      <div class="lg-scale"><span>+500%</span><span>+750%</span></div>`);
    if (v.incidents) items.push(`<div class="lg-row"><i class="lg-dot"></i>Key flood event (click)</div>`);
    $("#legend").innerHTML = items.join("");
    $("#legend").hidden = !items.length;
  }

  function renderSources() {
    $("#source-list").innerHTML = D.sources
      .map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a></li>`).join("");
  }

  // ---------------------------------------------------------------- AI chat

  function setupChat() {
    const labels = { groq: "Groq · Llama 3.3 70B (free tier)", claude: "Anthropic Claude", offline: "Offline mode · answers from dataset" };
    $("#chat-provider").textContent = labels[CFG.aiProvider] || CFG.aiProvider;
    const chips = ["Why was Sindh hit hardest?", "How many people died?", "What did the floods cost?",
      "What happened at Manchar Lake?", "How can Pakistan reduce future flood risk?"];
    $("#chat-chips").innerHTML = chips.map((c) => `<button class="chip">${c}</button>`).join("");
    $("#chat-chips").addEventListener("click", (e) => {
      if (e.target.classList.contains("chip")) sendQuestion(e.target.textContent);
    });
    $("#chat-close").addEventListener("click", () => ($("#chat").hidden = true));
    $("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#chat-input").value.trim();
      if (q) { $("#chat-input").value = ""; sendQuestion(q); }
    });
    addMsg("assistant", "Hi! I'm your flood analyst. Ask me about casualties, damage, rainfall, any province or district, or how to reduce future risk.");
  }

  function openChat() { $("#chat").hidden = false; $("#chat-input").focus(); }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function mdLite(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^\s*[-*] (.+)$/gm, "• $1")
      .replace(/\n/g, "<br>");
  }
  function addMsg(role, text, extraClass = "") {
    const el = document.createElement("div");
    el.className = `msg ${role} ${extraClass}`;
    el.innerHTML = mdLite(text);
    $("#chat-log").appendChild(el);
    $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
    return el;
  }

  async function sendQuestion(question, focus) {
    addMsg("user", question);
    const pending = addMsg("assistant", "Analysing…", "pending");
    try {
      const res = await fetch(CFG.askUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json",
          "X-CSRFToken": document.querySelector('meta[name="csrf-token"]').content },
        body: JSON.stringify({ question, focus, history: chatHistory }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      pending.remove();
      addMsg("assistant", json.answer);
      chatHistory.push({ role: "user", content: question }, { role: "assistant", content: json.answer });
      flyToMention(question + " " + (focus || ""));
    } catch (err) {
      pending.remove();
      addMsg("assistant", `Sorry, something went wrong: ${err.message}`, "error");
    }
  }

  // Fly the camera to a district or province the user asked about.
  function flyToMention(text) {
    if (!map || !window.__geo) return;
    const t = text.toLowerCase();
    const f = [...window.__geo.adm2.features, ...window.__geo.adm1.features]
      .find((x) => new RegExp(`\\b${x.properties.shapeName.toLowerCase()}\\b`).test(t));
    if (!f) return;
    const b = new mapboxgl.LngLatBounds();
    const walk = (c) => (typeof c[0] === "number" ? b.extend(c) : c.forEach(walk));
    walk(f.geometry.coordinates);
    rotating = false;
    map.fitBounds(b, { padding: 120, pitch: 50, duration: 3000, maxZoom: 9 });
  }
})();

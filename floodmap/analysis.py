"""Exposure analysis and serializers built on the database."""
from django.db.models import Sum
from django.template import Context, Engine
from django.templatetags.static import static

from .models import District, ExposureSnapshot, HazardEvent, Province

_engine = Engine(libraries={"humanize": "django.contrib.humanize.templatetags.humanize"},
                 builtins=["django.contrib.humanize.templatetags.humanize"])


def periods(event):
    rows = (ExposureSnapshot.objects.filter(event=event)
            .values("period_label", "period_start", "period_end").distinct()
            .order_by("period_start", "period_end"))
    return [{"label": r["period_label"], "start": r["period_start"].isoformat(), "end": r["period_end"].isoformat(),
             "weekly": (r["period_end"] - r["period_start"]).days <= 7} for r in rows]


def national_timeline(event):
    rows = (ExposureSnapshot.objects.filter(event=event)
            .values("period_label", "period_start", "period_end")
            .annotate(flood_km2=Sum("flood_km2"), exposed=Sum("exposed_population"))
            .order_by("period_start", "period_end"))
    return [{"label": r["period_label"], "start": r["period_start"].isoformat(), "end": r["period_end"].isoformat(),
             "weekly": (r["period_end"] - r["period_start"]).days <= 7,
             "flood_km2": round(r["flood_km2"]), "exposed": r["exposed"]} for r in rows]


def exposure_summary(event):
    timeline = national_timeline(event)
    if not timeline:
        return {}
    weekly = [t for t in timeline if t["weekly"]] or timeline
    monthly = next((t for t in timeline if not t["weekly"]), timeline[0])
    peak = max(weekly, key=lambda t: t["exposed"])
    return {
        "aug_flood_km2": monthly["flood_km2"], "aug_exposed": monthly["exposed"],
        "peak_label": peak["label"], "peak_flood_km2": peak["flood_km2"], "peak_exposed": peak["exposed"],
        "last_label": weekly[-1]["label"], "last_flood_km2": weekly[-1]["flood_km2"],
        "last_exposed": weekly[-1]["exposed"], "timeline": timeline,
    }


def top_districts(event, period_label=None, n=10):
    if period_label is None:
        period_label = exposure_summary(event).get("peak_label")
    qs = (ExposureSnapshot.objects.filter(event=event, period_label=period_label)
          .select_related("district__province").order_by("-exposed_population")[:n])
    return [district_row(s) for s in qs]


def district_row(s):
    d = s.district
    return {"pcode": d.pcode, "name": d.name, "province": d.province.name, "population": d.population,
            "area_km2": round(d.area_km2), "period": s.period_label, "flood_km2": round(s.flood_km2, 1),
            "exposed": s.exposed_population, "exposed_share": round(s.exposed_share, 4),
            "flooded_share": round(s.flooded_share, 4)}


def districts_geojson(event):
    """All districts with per-period exposure arrays (index-aligned with periods())."""
    per = periods(event)
    index = {(p["start"], p["end"]): i for i, p in enumerate(per)}
    series = {}
    for s in ExposureSnapshot.objects.filter(event=event).values(
            "district_id", "period_start", "period_end", "flood_km2", "exposed_population"):
        row = series.setdefault(s["district_id"], {"exposed": [0] * len(per), "flood": [0] * len(per)})
        i = index[(s["period_start"].isoformat(), s["period_end"].isoformat())]
        row["exposed"][i] = s["exposed_population"]
        row["flood"][i] = round(s["flood_km2"], 1)

    features = []
    for d in District.objects.select_related("province"):
        row = series.get(d.pcode, {"exposed": [0] * len(per), "flood": [0] * len(per)})
        props = {"pcode": d.pcode, "name": d.name, "province": d.province.name,
                 "population": d.population, "area_km2": round(d.area_km2)}
        for i in range(len(per)):
            props[f"e{i}"] = row["exposed"][i]
            props[f"f{i}"] = row["flood"][i]
            props[f"s{i}"] = round(row["exposed"][i] / d.population, 4) if d.population else 0
        features.append({"type": "Feature", "id": int(d.pcode[2:]), "properties": props, "geometry": d.geometry})
    return {"type": "FeatureCollection", "periods": per, "features": features}


def provinces_geojson(event):
    impacts = {i.province_id: i for i in event.province_impacts.all()}
    features = []
    for p in Province.objects.all():
        imp = impacts.get(p.pcode)
        features.append({"type": "Feature", "properties": {
            "pcode": p.pcode, "name": p.name, "deaths": imp.deaths if imp else 0,
            "rainfall_anomaly_pct": (imp.rainfall_anomaly_pct or 0) if imp else 0,
            "label": _label_point(p.geometry)}, "geometry": p.geometry})
    return {"type": "FeatureCollection", "features": features}


def _label_point(geom):
    """Centroid of the largest outer ring (good enough for a label)."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    ring = max((poly[0] for poly in polys), key=lambda r: abs(_area(r)))
    a = _area(ring) or 1e-12
    cx = sum((x0 + x1) * (x0 * y1 - x1 * y0) for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / (6 * a)
    cy = sum((y0 + y1) * (x0 * y1 - x1 * y0) for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / (6 * a)
    return [round(cx, 3), round(cy, 3)]


def _area(ring):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / 2


def district_detail(event, pcode):
    d = District.objects.select_related("province").get(pcode=pcode)
    snaps = list(ExposureSnapshot.objects.filter(event=event, district=d).select_related("district"))
    impact = event.province_impacts.filter(province=d.province).first()
    return {
        "pcode": d.pcode, "name": d.name, "province": d.province.name, "population": d.population,
        "area_km2": round(d.area_km2),
        "province_deaths": impact.deaths if impact else None,
        "weeks": [{"label": s.period_label, "flood_km2": round(s.flood_km2, 1), "exposed": s.exposed_population,
                   "exposed_share": round(s.exposed_share, 4), "flooded_share": round(s.flooded_share, 4)}
                  for s in snaps],
    }


def story_context(event):
    x = exposure_summary(event)
    p = {i.province.name.replace(" ", "_"): i for i in event.province_impacts.select_related("province")}
    dadu = (ExposureSnapshot.objects.filter(event=event, district__name="Dadu", period_label="1–7 Sep").first())
    return {"e": event, "x": x, "p": p, "dadu": dadu,
            "total_cost": f"{event.damage_usd_bn + event.loss_usd_bn:.1f}"}


def render_text(text, ctx):
    return _engine.from_string(text).render(Context(ctx)) if "{" in text else text


def story_config(story, mapbox_token=""):
    """Serialize to the exact config shape of the Mapbox Storytelling template."""
    ctx = story_context(story.event)
    chapters = []
    for c in story.chapters.all():
        cfg = c.to_config()
        cfg["title"] = render_text(cfg["title"], ctx)
        cfg["description"] = render_text(cfg["description"], ctx)
        if cfg["image"].startswith("/static/"):
            cfg["image"] = static(cfg["image"][len("/static/"):])
        chapters.append(cfg)
    return {
        "style": story.style, "accessToken": mapbox_token, "showMarkers": story.show_markers,
        "markerColor": story.marker_color, "projection": story.projection, "inset": story.inset,
        "insetOptions": {"markerColor": "orange"}, "insetPosition": "bottom-right", "theme": story.theme,
        "use3dTerrain": story.use_3d_terrain, "auto": story.auto, "title": render_text(story.title, ctx),
        "subtitle": render_text(story.subtitle, ctx), "byline": render_text(story.byline, ctx),
        "footer": render_text(story.footer, ctx), "chapters": chapters,
    }


def ai_context(event, question=""):
    """Compact, grounded facts for the AI analyst; adds full detail for any district mentioned."""
    x = exposure_summary(event)
    q = question.lower()
    mentioned = [d for d in District.objects.select_related("province") if d.name.lower() in q][:3]
    return {
        "event": {f: getattr(event, f) for f in (
            "name", "start_date", "end_date", "summary", "deaths", "injured", "people_affected",
            "people_displaced", "houses_damaged", "houses_destroyed", "livestock_lost", "roads_damaged_km",
            "bridges_damaged", "calamity_districts", "damage_usd_bn", "loss_usd_bn", "needs_usd_bn")},
        "province_impacts_NDMA": [{"province": i.province.name, "deaths": i.deaths,
                                   "august_rain_vs_normal_pct": i.rainfall_anomaly_pct, "note": i.note}
                                  for i in event.province_impacts.select_related("province")],
        "exposure_UNOSAT_national_by_period": x.get("timeline", []),
        "top_exposed_districts_at_peak_UNOSAT": top_districts(event, n=15),
        "incidents": list(event.incidents.values("name", "date_label", "description")),
        "districts_mentioned": [district_detail(event, d.pcode) for d in mentioned],
        "sources": list(event.sources.values("name", "publisher")),
    }


def get_event(slug=None):
    qs = HazardEvent.objects.all()
    return qs.get(slug=slug) if slug else qs.first()

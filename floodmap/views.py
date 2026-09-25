import json
import os

from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET, require_POST

from . import ai, analysis
from .models import District, HazardEvent, Story


def _event(slug):
    return get_object_or_404(HazardEvent, slug=slug)


@require_GET
def index(request, slug=None):
    event = analysis.get_event(slug) if slug else analysis.get_event()
    if event is None:
        raise Http404("No event loaded. Run: python manage.py load_flood_data")
    story = get_object_or_404(Story, event=event)
    token = os.environ.get("MAPBOX_TOKEN", "")
    return render(request, "floodmap/story.html", {
        "event": event,
        "config": analysis.story_config(story, token),
        "ai_provider": ai.provider_name(),
    })


@require_GET
def story_api(request, slug):
    story = get_object_or_404(Story, event=_event(slug))
    return JsonResponse(analysis.story_config(story))


@require_GET
@cache_page(60 * 15)
def districts_geojson(request, slug):
    return JsonResponse(analysis.districts_geojson(_event(slug)))


@require_GET
@cache_page(60 * 15)
def provinces_geojson(request, slug):
    return JsonResponse(analysis.provinces_geojson(_event(slug)))


@require_GET
def exposure_summary(request, slug):
    event = _event(slug)
    return JsonResponse({
        **analysis.exposure_summary(event),
        "top_districts": analysis.top_districts(event, request.GET.get("period"), int(request.GET.get("n", 10))),
    })


@require_GET
def district_detail(request, slug, pcode):
    event = _event(slug)
    get_object_or_404(District, pcode=pcode)
    return JsonResponse(analysis.district_detail(event, pcode))


@require_GET
def event_detail(request, slug):
    event = _event(slug)
    return JsonResponse({
        "event": {f.name: getattr(event, f.name) for f in HazardEvent._meta.fields},
        "province_impacts": list(event.province_impacts.values("province__name", "deaths", "rainfall_anomaly_pct", "note")),
        "incidents": list(event.incidents.values("name", "date_label", "lng", "lat", "description")),
        "sources": list(event.sources.values("name", "publisher", "url", "used_for")),
    })


@require_POST
def ask(request):
    try:
        body = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    question = str(body.get("question", "")).strip()[:1000]
    if not question:
        return JsonResponse({"error": "Question is required"}, status=400)
    answer, provider = ai.ask(question, body.get("history"), str(body.get("focus") or "")[:200])
    return JsonResponse({"answer": answer, "provider": provider})

import json
import os

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET, require_POST

from . import ai, data


@require_GET
def index(request):
    return render(request, "floodmap/index.html", {
        "mapbox_token": os.environ.get("MAPBOX_TOKEN", ""),
        "ai_provider": ai.provider_name(),
    })


@require_GET
def dataset(request):
    return JsonResponse(data.as_dict())


@require_POST
def ask(request):
    try:
        body = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    question = str(body.get("question", "")).strip()[:1000]
    if not question:
        return JsonResponse({"error": "Question is required"}, status=400)
    answer, provider = ai.ask(question, body.get("history"), body.get("focus"))
    return JsonResponse({"answer": answer, "provider": provider})

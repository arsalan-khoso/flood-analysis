"""List the chat models the configured Groq account can actually use.

    python manage.py groq_models

Groq retires model names from time to time; run this if the analyst falls back to
offline mode, then set GROQ_MODEL in .env to one of the listed ids.
"""
import os

import requests
from django.core.management.base import BaseCommand, CommandError

from floodmap.ai import GROQ_MODELS

SKIP = ("whisper", "prompt-guard", "orpheus", "safeguard", "tts")


class Command(BaseCommand):
    help = "List Groq chat models available to this API key."

    def handle(self, *args, **opts):
        key = os.environ.get("GROQ_API_KEY")
        if not key:
            raise CommandError("GROQ_API_KEY is not set (see .env).")
        resp = requests.get("https://api.groq.com/openai/v1/models",
                            headers={"Authorization": f"Bearer {key}"}, timeout=30)
        resp.raise_for_status()
        ids = sorted(m["id"] for m in resp.json().get("data", []))
        chat = [i for i in ids if not any(s in i.lower() for s in SKIP)]

        self.stdout.write("Chat models available to this key:")
        for i in chat:
            mark = "  <- in use" if i == next((m for m in GROQ_MODELS if m in chat), None) else ""
            self.stdout.write(f"  {i}{mark}")
        self.stdout.write(f"\nPreference order in floodmap/ai.py: {', '.join(GROQ_MODELS)}")
        if not any(m in chat for m in GROQ_MODELS):
            self.stdout.write(self.style.WARNING(
                "None of the preferred models are available - set GROQ_MODEL in .env to one above."))

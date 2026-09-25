import io
import json
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from .models import AIQuery, District, ExposureSnapshot, HazardEvent

SLUG = "pakistan-floods-2022"


@override_settings(STORAGES={
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
})
class FloodDataTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("load_flood_data", stdout=io.StringIO())

    def test_seed_loaded(self):
        event = HazardEvent.objects.get(slug=SLUG)
        self.assertEqual(event.deaths, 1739)
        self.assertEqual(District.objects.count(), 160)
        self.assertEqual(ExposureSnapshot.objects.filter(event=event).count(), 160 * 8)

    def test_national_exposure_matches_unosat_totals(self):
        res = self.client.get(f"/api/events/{SLUG}/exposure/?n=5").json()
        # UNOSAT national table: 83,557 km² / 31.25M people (Aug), 23.7M people peak week 25–31 Aug
        self.assertEqual(res["aug_flood_km2"], 83557)
        self.assertAlmostEqual(res["aug_exposed"], 31_251_774, delta=200)
        self.assertEqual(res["peak_label"], "25–31 Aug")
        self.assertAlmostEqual(res["peak_exposed"], 23_717_896, delta=200)
        self.assertEqual(len(res["top_districts"]), 5)
        self.assertEqual(res["top_districts"][0]["name"], "Khairpur")

    def test_story_config_matches_storytelling_schema(self):
        cfg = self.client.get(f"/api/events/{SLUG}/story/").json()
        for key in ("style", "theme", "use3dTerrain", "title", "chapters", "inset", "auto"):
            self.assertIn(key, cfg)
        chapter = cfg["chapters"][0]
        for key in ("id", "alignment", "hidden", "title", "description", "location", "mapAnimation",
                    "rotateAnimation", "callback", "onChapterEnter", "onChapterExit"):
            self.assertIn(key, chapter)
        # template variables are rendered from the database
        self.assertIn("1,739", chapter["description"])
        self.assertNotIn("{{", json.dumps(cfg))

    def test_geojson_endpoints(self):
        d = self.client.get(f"/api/events/{SLUG}/districts.geojson").json()
        self.assertEqual(len(d["features"]), 160)
        self.assertEqual(len(d["periods"]), 8)
        self.assertIn("e1", d["features"][0]["properties"])
        p = self.client.get(f"/api/events/{SLUG}/provinces.geojson").json()
        sindh = next(f for f in p["features"] if f["properties"]["name"] == "Sindh")
        self.assertEqual(sindh["properties"]["deaths"], 799)

    def test_district_detail(self):
        dadu = District.objects.get(name="Dadu")
        res = self.client.get(f"/api/events/{SLUG}/districts/{dadu.pcode}/").json()
        self.assertEqual(res["province"], "Sindh")
        self.assertEqual(len(res["weeks"]), 8)
        self.assertEqual(self.client.get(f"/api/events/{SLUG}/districts/XX999/").status_code, 404)

    def test_story_page_renders(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "storytelling-config")

    @mock.patch.dict("os.environ", {"GROQ_API_KEY": "", "ANTHROPIC_API_KEY": ""})
    def test_ask_offline_district_answer_is_logged(self):
        res = self.client.post("/api/ask/", json.dumps({"question": "How bad was it in Jacobabad?"}),
                               content_type="application/json").json()
        self.assertEqual(res["provider"], "offline")
        self.assertIn("Jacobabad", res["answer"])
        self.assertEqual(AIQuery.objects.count(), 1)

    def test_ask_requires_question(self):
        res = self.client.post("/api/ask/", "{}", content_type="application/json")
        self.assertEqual(res.status_code, 400)

    @mock.patch.dict("os.environ", {"GROQ_API_KEY": "test-key"})
    @mock.patch("floodmap.ai.requests.post")
    def test_ask_groq_is_grounded_on_database(self, post):
        post.return_value.json.return_value = {"choices": [{"message": {"content": "Grounded answer"}}]}
        res = self.client.post("/api/ask/", json.dumps({"question": "Tell me about Dadu"}),
                               content_type="application/json").json()
        self.assertEqual(res, {"answer": "Grounded answer", "provider": "groq"})
        system = post.call_args.kwargs["json"]["messages"][0]["content"]
        self.assertIn("Dadu", system)
        self.assertIn("UNOSAT", system)

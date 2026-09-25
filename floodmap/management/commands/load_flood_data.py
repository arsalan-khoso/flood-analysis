"""Load the seed files into the database (idempotent).

    python manage.py load_flood_data
"""
import json
from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from floodmap.models import (Chapter, DataSource, District, ExposureSnapshot, HazardEvent, Incident, Province,
                             ProvinceImpact, Story)

SEED = Path(__file__).resolve().parents[2] / "seed"


def read(name):
    return json.loads((SEED / name).read_text(encoding="utf-8"))


class Command(BaseCommand):
    help = "Load boundaries, UNOSAT exposure, NDMA/PDNA figures and story chapters into the database."

    @transaction.atomic
    def handle(self, *args, **opts):
        seed = read("event.json")
        event, _ = HazardEvent.objects.update_or_create(slug=seed["event"]["slug"], defaults=seed["event"])

        for f in read("provinces.geojson")["features"]:
            p = f["properties"]
            Province.objects.update_or_create(pcode=p["adm1_pcode"], defaults={
                "name": p["adm1_name"], "area_km2": p["area_sqkm"], "geometry": f["geometry"]})

        for row in seed["province_impacts"]:
            ProvinceImpact.objects.update_or_create(event=event, province_id=row["pcode"], defaults={
                k: v for k, v in row.items() if k != "pcode"})

        exposure = read("exposure.json")["districts"]
        for f in read("districts.geojson")["features"]:
            p = f["properties"]
            stats = exposure.get(p["adm2_pcode"], {})
            District.objects.update_or_create(pcode=p["adm2_pcode"], defaults={
                "name": p["adm2_name"], "province_id": p["adm1_pcode"], "area_km2": p["area_sqkm"],
                "population": round(stats.get("population", 0)), "geometry": f["geometry"]})

        ExposureSnapshot.objects.filter(event=event).delete()
        ExposureSnapshot.objects.bulk_create([
            ExposureSnapshot(event=event, district_id=pcode, period_label=w["label"],
                             period_start=date.fromisoformat(w["start"]), period_end=date.fromisoformat(w["end"]),
                             analysed_km2=w["analysed_km2"], flood_km2=w["flood_km2"],
                             exposed_population=w["exposed"])
            for pcode, stats in exposure.items() for w in stats["weeks"]
        ])

        event.incidents.all().delete()
        Incident.objects.bulk_create([Incident(event=event, **i) for i in seed["incidents"]])
        event.sources.all().delete()
        DataSource.objects.bulk_create([DataSource(event=event, **s) for s in seed["sources"]])

        story_seed = read("story.json")
        story, _ = Story.objects.update_or_create(event=event, defaults=story_seed["story"])
        story.chapters.all().delete()
        for order, c in enumerate(story_seed["chapters"]):
            c = dict(c)
            lng, lat = c.pop("center")
            Chapter.objects.create(story=story, order=order, center_lng=lng, center_lat=lat, **c)

        self.stdout.write(self.style.SUCCESS(
            f"Loaded {event}: {Province.objects.count()} provinces, {District.objects.count()} districts, "
            f"{ExposureSnapshot.objects.filter(event=event).count()} exposure snapshots, "
            f"{story.chapters.count()} chapters."))

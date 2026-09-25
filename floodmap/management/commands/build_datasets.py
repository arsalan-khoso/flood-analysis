"""Download raw open data from HDX / NASA and build the web-ready seed files.

    pip install -r requirements-dev.txt
    python manage.py build_datasets

Outputs (committed to the repo, so deploys don't need these heavy deps):
    floodmap/seed/provinces.geojson   OCHA COD admin-1 boundaries (simplified)
    floodmap/seed/districts.geojson   OCHA COD admin-2 boundaries (simplified)
    floodmap/seed/exposure.json       UNOSAT district population exposure, weekly
    floodmap/static/floodmap/data/flood_extent_aug2022.geojson  UNOSAT/VIIRS flood water
    floodmap/static/floodmap/img/*.jpg  NASA MODIS snapshots (public domain)
"""
import io
import json
import re
import zipfile
from pathlib import Path

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

APP = Path(__file__).resolve().parents[2]
RAW = settings.BASE_DIR / "data_raw"
SEED = APP / "seed"
STATIC = APP / "static" / "floodmap"

COD_URL = ("https://data.humdata.org/dataset/a64d1ff2-7158-48c7-887d-6af69ce21906/resource/"
           "c6521e04-75e1-41be-8e02-0554a424d9f4/download/pak_admin_boundaries.geojson.zip")
EXPOSURE_URL = ("https://unosat.org/static/unosat_filesystem/3416/Preliminary%20Satellite%20Derived%20Flood"
                "%20Evolution%20Assessment%2C%20Islamic%20Republic%20of%20Pakistan-19%20October%202022.csv")
VIIRS_URL = ("https://data.humdata.org/dataset/f685e623-a539-4af0-92ff-19b737ec95b3/resource/"
             "fa89ec39-8dd0-4abe-b97e-0a3d9e9627a5/download/viirs_20220701_20220831_floodextent_pak.zip")
SNAPSHOT_URL = ("https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME={date}"
                "&BBOX=24.2,66.2,29.6,70.4&CRS=EPSG:4326&LAYERS={layer}&WIDTH=720&HEIGHT=926&FORMAT=image/jpeg")

# Weekly periods in the UNOSAT table: (label, start, end, first column index)
PERIODS = [
    ("1–31 Aug", "2022-08-01", "2022-08-31", 3),
    ("25–31 Aug", "2022-08-25", "2022-08-31", 8),
    ("1–7 Sep", "2022-09-01", "2022-09-07", 13),
    ("8–14 Sep", "2022-09-08", "2022-09-14", 18),
    ("15–21 Sep", "2022-09-15", "2022-09-21", 23),
    ("26 Sep–2 Oct", "2022-09-26", "2022-10-02", 28),
    ("3–9 Oct", "2022-10-03", "2022-10-09", 33),
    ("11–17 Oct", "2022-10-11", "2022-10-17", 38),
]
PROVINCE_ROWS = {
    "azad kashmir": "Azad Kashmir", "balochistan": "Balochistan", "gilgit baltistan": "Gilgit Baltistan",
    "islamabad": "Islamabad", "khyber pakhtunkhwa": "Khyber Pakhtunkhwa", "punjab": "Punjab", "sindh": "Sindh",
}


def norm(name):
    name = re.sub(r"\(\d\)", "", str(name)).lower()
    return re.sub(r"[^a-z]", "", name)


def num(v):
    return float(v) if isinstance(v, (int, float)) else 0.0


class Command(BaseCommand):
    help = "Download UNOSAT/OCHA/NASA open data and build seed files."

    def fetch(self, url, name):
        RAW.mkdir(exist_ok=True)
        path = RAW / name
        if not path.exists():
            self.stdout.write(f"Downloading {name} …")
            resp = requests.get(url, timeout=600, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            path.write_bytes(resp.content)
        return path

    def handle(self, *args, **opts):
        from shapely.geometry import mapping, shape

        SEED.mkdir(exist_ok=True)
        (STATIC / "data").mkdir(parents=True, exist_ok=True)
        (STATIC / "img").mkdir(parents=True, exist_ok=True)

        # ---- boundaries (OCHA COD-AB, valid 2022-09-09, same PCO units UNOSAT used)
        with zipfile.ZipFile(self.fetch(COD_URL, "cod_ab.zip")) as z:
            adm1 = json.loads(z.read("pak_admin1.geojson"))
            adm2 = json.loads(z.read("pak_admin2.geojson"))

        def simplify(fc, tol, keep):
            out = []
            for f in fc["features"]:
                geom = shape(f["geometry"]).simplify(tol, preserve_topology=True)
                out.append({"type": "Feature", "properties": {k: f["properties"][k] for k in keep},
                            "geometry": round_coords(mapping(geom))})
            return {"type": "FeatureCollection", "features": out}

        provinces = simplify(adm1, 0.01, ["adm1_pcode", "adm1_name", "area_sqkm"])
        districts = simplify(adm2, 0.006, ["adm2_pcode", "adm2_name", "adm1_pcode", "adm1_name", "area_sqkm"])
        write_json(SEED / "provinces.geojson", provinces)
        write_json(SEED / "districts.geojson", districts)

        # ---- UNOSAT population exposure by district, per week
        import openpyxl

        wb = openpyxl.load_workbook(self.fetch(EXPOSURE_URL, "unosat_exposure_19oct2022.xlsx"),
                                    read_only=True, data_only=True)
        rows = list(wb["Statistics by district level"].iter_rows(values_only=True))
        lookup = {(f["properties"]["adm1_name"], norm(f["properties"]["adm2_name"])): f["properties"]["adm2_pcode"]
                  for f in districts["features"]}
        aliases = {"diamir": "diamer", "dikhan": "deraismailkhan", "batagram": "battagram",
                   "leiah": "layyah", "kambarshahdadkot": "qambarshahdadkot", "umerkot": "umarkot"}
        exposure, national, province = {}, None, None
        unmatched = []
        for row in rows[1:]:
            label = row[0]
            if not label or not isinstance(row[1], (int, float)):
                continue
            key = norm(label)
            record = {
                "area_km2": num(row[1]), "population": num(row[2]),
                "weeks": [{"label": p[0], "start": p[1], "end": p[2],
                           "analysed_km2": round(num(row[p[3]]), 1),
                           "flood_km2": round(num(row[p[3] + 2]), 2),
                           "exposed": round(num(row[p[3] + 3]))} for p in PERIODS],
            }
            if key == "pakistan":
                national = record
                continue
            prov_match = next((v for k, v in PROVINCE_ROWS.items() if norm(k) == key), None)
            if prov_match and prov_match != province:  # province header row (Islamabad repeats as a district)
                province = prov_match
                continue
            pcode = lookup.get((province, key)) or lookup.get((province, aliases.get(key, key)))
            if pcode:
                exposure[pcode] = record
            else:
                unmatched.append(f"{province}/{label}")
        write_json(SEED / "exposure.json", {"source": "UNOSAT FL20220808PAK, 19 Oct 2022",
                                            "national": national, "districts": exposure})
        self.stdout.write(f"Exposure rows matched: {len(exposure)}; unmatched: {unmatched or 'none'}")

        # ---- flood water extent (UNOSAT / VIIRS, Jul–Aug 2022)
        import shapefile

        with zipfile.ZipFile(self.fetch(VIIRS_URL, "viirs_floodextent.zip")) as z:
            base = next(n for n in z.namelist() if n.endswith(".shp"))[:-4]
            reader = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")),
                                      dbf=io.BytesIO(z.read(base + ".dbf")),
                                      shx=io.BytesIO(z.read(base + ".shx")))
            geom = shape(reader.shape(0).__geo_interface__)
        parts = [g for g in getattr(geom, "geoms", [geom]) if g.area > 2e-4]  # drop specks < ~2 km²
        feats = [{"type": "Feature", "properties": {},
                  "geometry": round_coords(mapping(g.simplify(0.004, preserve_topology=True)), 3)} for g in parts]
        write_json(STATIC / "data" / "flood_extent_aug2022.geojson", {"type": "FeatureCollection", "features": feats})
        self.stdout.write(f"Flood extent: kept {len(parts)} of {len(getattr(geom, 'geoms', [geom]))} polygons")

        # ---- NASA MODIS before/after snapshots for chapter images
        for date, layer, name in [("2021-09-05", "MODIS_Terra_CorrectedReflectance_Bands721", "indus_2021.jpg"),
                                  ("2022-09-04", "MODIS_Aqua_CorrectedReflectance_Bands721", "indus_2022.jpg")]:
            target = STATIC / "img" / name
            if not target.exists():
                target.write_bytes(self.fetch(SNAPSHOT_URL.format(date=date, layer=layer), name).read_bytes())
        self.stdout.write(self.style.SUCCESS("Seed data built."))


def round_coords(geom, nd=4):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def write_json(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

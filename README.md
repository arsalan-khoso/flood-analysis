# When the Indus Broke Its Banks: Pakistan Floods 2022

A story map of the 2022 Pakistan monsoon floods. It covers the hazard (the rain), who and what was in the water's path (exposure), and the impact. It's built with **Django** and the official **[Mapbox Storytelling template](https://github.com/mapbox/storytelling)**, and includes an **AI analyst** that answers from the database.

## What's inside

| Part | Details |
|---|---|
| **Hazard** | PMD rainfall anomalies. UNOSAT/VIIRS satellite-detected flood water, Jul–Aug 2022 (drawn as polygons). NASA MODIS imagery before (Sep 2021) and after (Sep 2022) the floods, with a crossfade slider. |
| **Exposure analysis** | UNOSAT's weekly flood extent and population exposure for **all 160 districts** over 8 satellite periods (Aug → mid-Oct 2022), based on WorldPop 2020. Districts are shaded by the share of their population exposed. A week slider animates how the water receded. |
| **Impact** | NDMA casualties by province (3D columns), plus housing, road, bridge and livestock losses. PDNA damage, losses and reconstruction needs. |
| **Story mode** | The Mapbox Storytelling engine (scrollama, `onChapterEnter` / `onChapterExit`, `alignment`, `rotateAnimation`, `callback`, inset globe, 3D terrain and sky). The chapter config is **generated from Django models**, so you edit the story in the admin panel. |
| **Explore mode** | Free navigation and district search. Click any district for its profile and a weekly chart. An **AI risk brief** button sits on each district profile. |
| **AI analyst** | Grounded on data pulled from the database (national figures, provinces, top districts, and full detail for any district mentioned). Every question and answer is logged to the admin. |

### AI providers (free first)

| Env var | Provider | Cost |
|---|---|---|
| `GROQ_API_KEY` | Groq (`openai/gpt-oss-120b` by default) | **Free tier**: https://console.groq.com/keys |
| `ANTHROPIC_API_KEY` (used only if there is no Groq key) | Claude Opus 5 | Paid |
| none | Offline analyst: templated answers from the database | Free |

## Django backend

```
floodmap/models.py        HazardEvent, Province, ProvinceImpact, District, ExposureSnapshot,
                          Incident, DataSource, Story, Chapter, AIQuery
floodmap/analysis.py      Exposure aggregation, GeoJSON serializers, storytelling config builder
floodmap/ai.py            Groq / Claude / offline analyst, grounded on the DB
floodmap/admin.py         Admin for every model (edit story chapters, figures, sources; review AI answers)
floodmap/management/commands/
  build_datasets.py       Downloads raw open data from HDX/NASA -> web-ready seed files
  load_flood_data.py      Loads seed files into the database (idempotent)
floodmap/seed/            Processed seed data (committed)
floodmap/tests.py         API + data-integrity tests (UNOSAT totals, story schema, AI grounding)
```

### API

| Endpoint | Returns |
|---|---|
| `GET /api/events/<slug>/` | Event figures, province impacts, incidents, sources |
| `GET /api/events/<slug>/story/` | Mapbox Storytelling `config` object |
| `GET /api/events/<slug>/districts.geojson` | 160 districts with exposure per period (`e0..e7` people, `f0..f7` km², `s0..s7` share) |
| `GET /api/events/<slug>/provinces.geojson` | Provinces with deaths and rainfall anomaly |
| `GET /api/events/<slug>/exposure/?period=&n=` | National timeline and top-N exposed districts |
| `GET /api/events/<slug>/districts/<pcode>/` | One district's weekly profile |
| `POST /api/ask/` | `{question, focus?, history?}` → `{answer, provider}` |

The event slug is `pakistan-floods-2022`.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate                 # Windows (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
copy .env.example .env                 # set MAPBOX_TOKEN (and GROQ_API_KEY for free AI)
python manage.py migrate
python manage.py load_flood_data
python manage.py createsuperuser       # for /admin
python manage.py runserver
```

- Story: http://127.0.0.1:8000
- Admin: http://127.0.0.1:8000/admin
- Tests: `python manage.py test floodmap`

To rebuild the seed data from the original sources: `pip install -r requirements-dev.txt` then `python manage.py build_datasets`.

Groq retires model names from time to time. If the analyst silently falls back to offline mode, run
`python manage.py groq_models` to list what your key can use, then set `GROQ_MODEL` in `.env`. The
free tier is rate limited, and the app falls back to the offline analyst when it is exhausted.

## Deploy for free (Render)

1. Push the repo to GitHub.
2. On https://render.com go to **New → Blueprint** and select the repo. `render.yaml` creates a free web service. The build runs migrations, loads the data and creates the admin user.
3. Enter `MAPBOX_TOKEN`, `GROQ_API_KEY` and `DJANGO_SUPERUSER_PASSWORD` when prompted.
4. Optional: to keep admin edits after a redeploy, set `DATABASE_URL` to a free [Neon](https://neon.tech) Postgres database. Without it, the app uses SQLite, which is reloaded from the seed data on every deploy.
5. In your Mapbox account, restrict the token to your `*.onrender.com` URL.

On the free plan the service goes to sleep when idle. The first visit after that takes about 30–50 seconds to load.

## Data sources & caveats

- **UNOSAT**: *Preliminary Satellite Derived Flood Evolution Assessment* (19 Oct 2022) and *VIIRS water extents 1–29 Aug 2022* (HDX). "Exposed" means people living in areas where the satellite detected water (WorldPop 2020). It is **not** a count of casualties or damage, and the data is preliminary and not field-validated. The Aug 1–31 monthly composite over-detects in some Punjab districts, so the story uses the cloud-free weekly periods.
- **NDMA** situation reports: deaths, injuries, houses, livestock, roads and bridges. Casualties are only available at province level.
- **PDNA 2022** (Govt of Pakistan, ADB, EU, UNDP, World Bank): damage, losses and needs.
- **PMD**: rainfall anomalies. **OCHA COD-AB**: boundaries (PCO, valid 2022-09-09). **NASA GIBS**: MODIS imagery.

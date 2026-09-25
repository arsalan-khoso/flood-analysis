# Pakistan Floods 2022: Cinematic Story Map

A Django + Mapbox GL JS story map of the 2022 Pakistan monsoon floods, with an AI flood analyst you can chat with.

**Story mode** covers 10 chapters. Each one flies the 3D camera to a new place: rainfall anomaly → Swat flash floods → Kabul River → hill torrents → Indus before/after from space → Manchar Lake breach → casualties (3D columns per province) → damage & exposure → free explore.
- **Real data**
  - NDMA casualty and damage figures
  - PDNA economic costs
  - PMD rainfall anomalies
  - geoBoundaries province and district polygons
  - NASA MODIS satellite imagery from before (Sep 2021) and after (Sep 2022) the floods, with a crossfade slider
- **Cinematic**
  - Mapbox 3D terrain, globe view with fog
  - Auto-play mode, smooth `flyTo` camera moves, pulsing incident markers
- **AI analyst**
  - Grounded on the dataset
  - Click any district and choose **AI impact brief**
  - The camera flies to places you mention in the chat

## AI providers (free first)

| Env var set | Provider | Cost |
|---|---|---|
| `GROQ_API_KEY` | Groq · Llama 3.3 70B | **Free tier** ([get key](https://console.groq.com/keys)) |
| `ANTHROPIC_API_KEY` (and no Groq key) | Claude Opus 5 | Paid |
| none | Offline analyst (keyword answers from the dataset) | Free, no key |

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
copy .env.example .env          # then fill in MAPBOX_TOKEN (and optionally GROQ_API_KEY)
python manage.py runserver
```

Open http://127.0.0.1:8000. You need a free Mapbox **public** token (`pk.…`) from https://account.mapbox.com/access-tokens/. The free tier includes 50,000 map loads per month.

## Deploy for free (Render)

1. Push this folder to a GitHub repo.
2. On https://render.com, go to **New → Blueprint** and pick the repo. `render.yaml` sets up a free web service.
3. When prompted, enter `MAPBOX_TOKEN` and `GROQ_API_KEY`.
4. In the Mapbox dashboard, restrict your token to your `*.onrender.com` URL.

On the free plan the app goes to sleep when idle. The first visit after that takes about 30–50 seconds to load.

## Project layout

```
config/                 Django settings (env-driven, whitenoise static files, no database)
floodmap/data.py        Curated dataset + sources
floodmap/ai.py          Groq / Claude / offline analyst
floodmap/views.py       Page, /api/data/, /api/ask/
floodmap/static/floodmap/
  story.js              Chapter text + camera + layer config (edit the story here)
  app.js                Map, scrollytelling, layers, chat
  app.css               Styles
  data/adm1|adm2.geojson  geoBoundaries (public domain)
```

## Data notes

National and provincial figures are the official final estimates from NDMA and the PDNA (Oct 2022). The death-toll timeline uses a few points from NDMA daily sitreps. District impact classes (severe/affected) are a simplified compilation of NDMA calamity notifications and OCHA hotspot maps. They are not an official dataset, so verify them before you publish. The geoBoundaries district layer (2019) merges or omits a few districts, such as Larkana and Sujawal.

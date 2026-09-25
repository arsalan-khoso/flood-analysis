"""AI flood analyst, grounded on the database.

Provider is picked from environment variables, in order:
  1. GROQ_API_KEY       -> Groq free tier, $0 for testing
  2. ANTHROPIC_API_KEY  -> Claude (paid)
  3. neither            -> offline analyst that answers from the database

Groq retires model names periodically, so GROQ_MODELS is tried in order and a
"model_not_found" response falls through to the next one.
"""
import json
import logging
import os

import requests

from . import analysis
from .models import AIQuery, District, Province

log = logging.getLogger(__name__)

INSTRUCTIONS = (
    "You are a disaster-risk analyst embedded in an interactive story map about the 2022 Pakistan "
    "monsoon floods. Answer using the DATA below. It comes from NDMA (casualties, damage), the PDNA "
    "(economic cost) and UNOSAT (satellite-detected flood extent and population exposure per district, "
    "WorldPop 2020). Name the source when you quote a number. UNOSAT exposure means people living in "
    "flooded areas, not casualties. The figures are preliminary and not field-validated, so say so when "
    "relevant. If the data does not cover the question, say so. Keep answers under 200 words, "
    "in plain language. For a district, cover exposure (people and area), the trend over the weeks, "
    "the provincial toll, and 2–3 practical risk-reduction lessons."
)


def provider_name():
    if os.environ.get("GROQ_API_KEY"):
        return "groq"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    return "offline"


def ask(question, history=None, focus=""):
    event = analysis.get_event()
    history = [{"role": m["role"], "content": str(m["content"])[:4000]} for m in (history or [])[-8:]
               if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")]
    context = analysis.ai_context(event, f"{question} {focus}")
    system = f"{INSTRUCTIONS}\n\nDATA:\n{json.dumps(context, default=str, separators=(',', ':'))}"
    prompt = f"[Map focus: {focus}] {question}" if focus else question

    provider = provider_name()
    answer = None
    try:
        if provider == "groq":
            answer = _groq(system, history, prompt)
        elif provider == "claude":
            answer = _claude(system, history, prompt)
    except Exception:
        log.exception("AI provider %s failed; falling back to offline analyst", provider)
    if not answer:
        provider, answer = "offline", _offline(event, f"{question} {focus}")

    try:
        AIQuery.objects.create(question=question, focus=focus[:200], answer=answer, provider=provider)
    except Exception:   # a read-only or locked DB must not break the answer
        log.exception("Could not log the AI query")
    return answer, provider


#: Tried in order; run `python manage.py groq_models` to see what the account offers.
GROQ_MODELS = [m for m in (os.environ.get("GROQ_MODEL"), "openai/gpt-oss-120b",
                           "openai/gpt-oss-20b", "qwen/qwen3.8-27b") if m]


def _groq(system, history, prompt):
    messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": prompt}]
    last = None
    for model in GROQ_MODELS:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
            json={"model": model, "messages": messages, "temperature": 0.3, "max_tokens": 900},
            timeout=40,
        )
        if resp.status_code == 404:  # model retired or not enabled on this account
            log.warning("Groq model %s unavailable, trying the next one", model)
            last = resp
            continue
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    last.raise_for_status()


def _claude(system, history, prompt):
    import anthropic

    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=os.environ.get("CLAUDE_MODEL", "claude-opus-5"),
        max_tokens=4000,
        thinking={"type": "adaptive"},
        output_config={"effort": "low"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        messages=[*history, {"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        return "The model declined to answer that question."
    return "".join(b.text for b in response.content if b.type == "text").strip()


# ------------------------------------------------------------------ offline analyst

def _n(v):
    return f"{int(v):,}"


def _offline(event, text):
    q = text.lower()

    for d in District.objects.select_related("province"):
        if d.name.lower() in q:
            det = analysis.district_detail(event, d.pcode)
            weekly = [w for w in det["weeks"] if w["label"] != "1–31 Aug"]
            peak = max(weekly, key=lambda w: w["exposed"]) if weekly else None
            if not peak or not peak["exposed"]:
                return (f"**{d.name}** ({d.province.name}): UNOSAT detected little or no flood water here "
                        f"in its weekly analyses. Population {_n(d.population)} (WorldPop 2020).")
            last = weekly[-1]
            return (f"**{d.name}, {d.province.name}.** At its peak ({peak['label']}), UNOSAT detected "
                    f"**{peak['flood_km2']:,.0f} km²** of flood water ({peak['flooded_share']:.0%} of the district) "
                    f"and **{_n(peak['exposed'])} people** ({peak['exposed_share']:.0%} of the population) "
                    f"living in flooded areas. By {last['label']}, {_n(last['exposed'])} were still exposed. "
                    f"{d.province.name} recorded {_n(det['province_deaths'] or 0)} deaths (NDMA).\n"
                    "Lessons: keep homes and roads off the active floodplain, clear drainage before the "
                    "monsoon, and pre-position boats, shelter and cash aid in high-exposure union councils.")

    for p in Province.objects.all():
        if p.name.lower() in q or (p.pcode == "PK5" and any(w in q.split() for w in ("kp", "kpk"))):
            imp = event.province_impacts.filter(province=p).first()
            exposed = sum(r["exposed"] for r in analysis.top_districts(event, n=200) if r["province"] == p.name)
            return (f"**{p.name}**: {_n(imp.deaths if imp else 0)} deaths (NDMA), "
                    f"{_n(exposed)} people exposed to flood water at the peak (UNOSAT). {imp.note if imp else ''}")

    x = analysis.exposure_summary(event)
    rules = [
        (("exposed", "exposure", "population", "people"),
         f"At the peak ({x['peak_label']}), UNOSAT detected **{_n(x['peak_flood_km2'])} km²** of flood water "
         f"and **{_n(x['peak_exposed'])} people** living in flooded areas. Over all of August the figure was "
         f"{_n(x['aug_exposed'])}. By {x['last_label']}, {_n(x['last_exposed'])} were still exposed."),
        (("death", "died", "killed", "casualt", "fatal", "injur"),
         f"NDMA reported **{_n(event.deaths)} deaths** and **{_n(event.injured)} injured**. Sindh, "
         "Balochistan and Khyber Pakhtunkhwa had the most fatalities."),
        (("cost", "damage", "loss", "econom", "billion", "$"),
         f"The PDNA estimated **${event.damage_usd_bn}bn in damage**, **${event.loss_usd_bn}bn in losses** "
         f"and **${event.needs_usd_bn}bn** in reconstruction needs."),
        (("rain", "monsoon", "why", "cause", "climate"),
         "PMD recorded monsoon rain 190% above normal; in August Sindh was 726% and Balochistan 590% above "
         "normal. World Weather Attribution found climate change likely increased the extreme rainfall."),
        (("house", "home", "shelter", "displac"),
         f"**{_n(event.houses_damaged)} houses** were damaged ({_n(event.houses_destroyed)} destroyed) and about "
         f"**{event.people_displaced / 1e6:.1f} million** people were displaced (NDMA/OCHA)."),
        (("worst", "most", "top", "hardest", "rank"),
         "Most exposed districts at the peak (UNOSAT): " + "; ".join(
             f"{r['name']} {_n(r['exposed'])}" for r in analysis.top_districts(event, n=6)) + "."),
    ]
    for words, answer in rules:
        if any(w in q for w in words):
            return answer
    return ("I'm in **offline mode** (no AI key configured), so I answer from the database: ask about "
            "exposure, deaths, damage, rainfall, housing, the worst-hit districts, or any province or district. "
            "Set a free `GROQ_API_KEY` for full AI answers.")

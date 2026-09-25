"""AI analyst for the flood story.

Provider is picked from environment variables, in order:
  1. GROQ_API_KEY       -> Groq free tier (Llama 3.3 70B), good for testing at $0
  2. ANTHROPIC_API_KEY  -> Claude (paid)
  3. neither            -> offline analyst that answers from the curated dataset
"""
import json
import logging
import os
import re

import requests

from . import data

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a disaster-risk analyst embedded in an interactive map story about "
    "the 2022 Pakistan monsoon floods. Answer using the dataset below; when you go "
    "beyond it, say so and keep to well-established facts. Be concise (under 180 "
    "words), use plain language, and cite the figure's source name (NDMA, PDNA, "
    "PMD, OCHA) when you quote a number. If the user asks about a district, cover "
    "exposure, what happened there, and practical risk-reduction lessons.\n\n"
    "DATASET:\n" + json.dumps(data.as_dict(), indent=1)
)


def provider_name():
    if os.environ.get("GROQ_API_KEY"):
        return "groq"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"
    return "offline"


def ask(question, history=None, focus=None):
    """Return (answer_text, provider)."""
    history = [m for m in (history or [])[-8:]
               if m.get("role") in ("user", "assistant") and m.get("content")]
    prompt = question if not focus else f"[Map focus: {focus}] {question}"
    provider = provider_name()
    try:
        if provider == "groq":
            return _groq(prompt, history), provider
        if provider == "claude":
            return _claude(prompt, history), provider
    except Exception:  # fall back rather than break the demo
        log.exception("AI provider %s failed; using offline analyst", provider)
    return _offline(question, focus), "offline"


def _groq(prompt, history):
    resp = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
        json={
            "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
            "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                         *history, {"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 600,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def _claude(prompt, history):
    import anthropic

    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=os.environ.get("CLAUDE_MODEL", "claude-opus-5"),
        max_tokens=4000,
        thinking={"type": "adaptive"},
        output_config={"effort": "low"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM_PROMPT,
        messages=[*history, {"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        return "The model declined to answer that question."
    return "".join(b.text for b in response.content if b.type == "text").strip()


# ---------------------------------------------------------------- offline mode

def _fmt(n):
    return f"{n:,}"


def _offline(question, focus=None):
    q = f"{question} {focus or ''}".lower()
    nat = data.NATIONAL

    for prov, info in data.PROVINCES.items():
        if prov.lower() in q or (prov == "Khyber Pakhtunkhwa" and re.search(r"\bkp\b|\bkpk\b", q)):
            share = info["deaths"] / nat["deaths"] * 100
            return (f"**{prov}** recorded {_fmt(info['deaths'])} deaths ({share:.0f}% of the national "
                    f"toll of {_fmt(nat['deaths'])}, NDMA). {info['note']}")

    for d in data.SEVERE + data.AFFECTED:
        if d.lower() in q:
            level = "among the most severely affected districts" if d in data.SEVERE else "a flood-affected district"
            inc = next((i for i in data.INCIDENTS if d.lower() in i["name"].lower()), None)
            extra = f" Key event ({inc['date']}): {inc['text']}" if inc else ""
            return (f"**{d}** was {level} in 2022 (NDMA calamity notifications / OCHA).{extra} "
                    "Lessons: keep settlements and hotels out of active floodplains, maintain drainage "
                    "and embankments before the monsoon, and pre-position boats, shelter and cash aid.")

    rules = [
        (r"death|died|kill|casualt|fatal", f"NDMA reported **{_fmt(nat['deaths'])} deaths** and "
         f"**{_fmt(nat['injured'])} injured**. Sindh (799), Balochistan (336) and Khyber Pakhtunkhwa (309) "
         "accounted for most fatalities."),
        (r"cost|damage|loss|econom|dollar|\$|billion", f"The PDNA estimated **${nat['damage_usd_bn']}bn in damage**, "
         f"**${nat['loss_usd_bn']}bn in economic losses** and **${nat['reconstruction_needs_usd_bn']}bn** in "
         "reconstruction needs. Housing, agriculture and transport were the hardest-hit sectors."),
        (r"rain|monsoon|precip|why|cause|climate", f"PMD recorded monsoon rainfall **{data.RAINFALL['national_monsoon_pct_above_normal']}% "
         f"above normal**; in August Sindh was **{data.RAINFALL['august_sindh_pct_above_normal']}%** and Balochistan "
         f"**{data.RAINFALL['august_balochistan_pct_above_normal']}%** above normal. World Weather Attribution found "
         "climate change likely increased the extreme rainfall intensity."),
        (r"house|home|shelter|displac", f"About **{_fmt(nat['houses_damaged'])} houses** were damaged "
         f"({_fmt(nat['houses_destroyed'])} destroyed) and roughly **{nat['people_displaced_peak'] / 1e6:.1f} million** "
         "people were displaced at the peak (NDMA/OCHA)."),
        (r"road|bridge|infra", f"**{_fmt(nat['roads_damaged_km'])} km of roads** and **{nat['bridges_damaged']} bridges** "
         "were damaged (NDMA)."),
        (r"livestock|cattle|crop|agri", f"Around **{_fmt(nat['livestock_lost'])} livestock** died (NDMA); the PDNA "
         "ranks agriculture among the largest loss sectors, with cotton, rice and date crops devastated in Sindh."),
        (r"affect|people|population", f"About **33 million people** were affected across "
         f"**{nat['calamity_districts']} calamity-declared districts**."),
        (r"manchar|dadu|sehwan", data.INCIDENTS[4]["text"]),
        (r"swat|kalam|hotel", data.INCIDENTS[0]["text"]),
    ]
    for pattern, answer in rules:
        if re.search(pattern, q):
            return answer

    return ("I'm running in **offline mode** (no AI key configured), so I can answer questions about "
            "deaths, damage costs, rainfall, housing, infrastructure, livestock, any province or any "
            "affected district. Add a free `GROQ_API_KEY` for full AI answers.")

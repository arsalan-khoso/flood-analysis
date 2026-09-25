"""Curated facts for the 2022 Pakistan monsoon floods.

Sources (see SOURCES below): NDMA Pakistan situation reports, the Government of
Pakistan / World Bank / ADB / EU / UNDP Post-Disaster Needs Assessment (PDNA,
Oct 2022), Pakistan Meteorological Department (PMD) monthly climate summaries,
and UN OCHA situation reports. Boundaries: geoBoundaries (public domain).
Satellite imagery: NASA GIBS / MODIS (Worldview).

Numbers are the widely cited final/official figures. District impact classes are
a simplified compilation of NDMA "calamity-hit" notifications and OCHA hotspot
maps, not an official dataset; verify before publishing.
"""

EVENT = {
    "name": "2022 Pakistan Monsoon Floods",
    "period": "14 June – October 2022",
    "national_emergency_declared": "25 August 2022",
}

NATIONAL = {
    "deaths": 1739,
    "injured": 12867,
    "people_affected": 33_000_000,
    "people_displaced_peak": 7_900_000,
    "houses_damaged": 2_288_481,
    "houses_destroyed": 897_014,
    "livestock_lost": 1_164_270,
    "roads_damaged_km": 13_115,
    "bridges_damaged": 439,
    "calamity_districts": 84,
    "damage_usd_bn": 14.9,
    "loss_usd_bn": 15.2,
    "reconstruction_needs_usd_bn": 16.3,
}

# NDMA cumulative deaths by province (final sitrep, rounded revisions may differ
# by a few from the national total).
PROVINCES = {
    "Sindh": {"deaths": 799, "note": "Worst hit: ~70% of total damage per PDNA; riverine & rain flooding for months."},
    "Balochistan": {"deaths": 336, "note": "Flash floods and plains flooding in Jafarabad/Nasirabad; road links to Sindh cut."},
    "Khyber Pakhtunkhwa": {"deaths": 309, "note": "Flash floods in Swat, Kabul and Indus tributaries; Nowshera & Charsadda evacuated."},
    "Punjab": {"deaths": 223, "note": "Hill torrents from Koh-e-Suleman hit DG Khan and Rajanpur."},
    "Azad Kashmir": {"deaths": 48, "note": "Landslides and flash floods."},
    "Gilgit-Baltistan": {"deaths": 22, "note": "Glacial melt, flash floods, bridges washed away."},
    "Islamabad Capital Territory": {"deaths": 1, "note": "Minor impact."},
}

RAINFALL = {
    "national_monsoon_pct_above_normal": 190,  # Jul–Aug 2022 vs 30-yr normal (PMD)
    "august_national_pct_above_normal": 243,
    "august_sindh_pct_above_normal": 726,
    "august_balochistan_pct_above_normal": 590,
}

# Approximate NDMA cumulative death toll (as reported in daily sitreps).
DEATH_TIMELINE = [
    {"date": "2022-06-14", "deaths": 0},
    {"date": "2022-08-25", "deaths": 937},
    {"date": "2022-08-28", "deaths": 1033},
    {"date": "2022-08-29", "deaths": 1136},
    {"date": "2022-11-01", "deaths": 1739},
]

SEVERE = [
    "Dadu", "Jacobabad", "Qambar Shahdadkot", "Khairpur", "Naushehro Feroze",
    "Sanghar", "Mirpurkhas", "Shikarpur", "Kashmore", "Jafarabad", "Nasirabad",
    "Jhal Magsi", "Kachhi", "Lasbela", "Rajanpur", "Dera Ghazi Khan", "Swat",
    "Nowshera", "Charsadda", "Dera Ismail Khan", "Tank", "Sukkur", "Nawabshah",
]
AFFECTED = [
    # Sindh
    "Badin", "Thatta", "Hyderabad", "Jamshoro", "Matiari", "Tando Allahyar",
    "Tando Muhammad Khan", "Umerkot", "Tharparkar", "Ghotki",
    # Balochistan
    "Quetta", "Pishin", "Qilla Abdullah", "Qilla Saifullah", "Zhob", "Sibi",
    "Kohlu", "Dera Bugti", "Barkhan", "Musakhel", "Loralai", "Khuzdar",
    "Awaran", "Kalat", "Mastung", "Kech", "Kharan", "Nushki", "Ziarat",
    "Chagai", "Panjgur", "Gwadar",
    # Khyber Pakhtunkhwa
    "Upper Dir", "Lower Dir", "Chitral", "Kohistan", "Shangla", "Buner",
    "Malakand", "Mardan", "Peshawar", "Lakki Marwat", "Bannu", "Karak",
    "Kohat", "Swabi", "Mansehra", "Battagram", "South Waziristan",
    # Punjab
    "Mianwali", "Muzaffargarh", "Layyah", "Bhakkar",
    # Gilgit-Baltistan
    "Ghizer", "Hunza", "Nagar", "Diamer", "Skardu", "Ghanche",
]

INCIDENTS = [
    {"name": "Kalam, Swat", "lng": 72.585, "lat": 35.49, "date": "26 Aug 2022",
     "text": "Swat River surge destroyed the multi-storey Honeymoon Hotel and dozens of riverside hotels; footage circulated worldwide."},
    {"name": "Nowshera", "lng": 71.98, "lat": 34.01, "date": "28 Aug 2022",
     "text": "Kabul River in high flood; authorities ordered evacuation of large parts of the city."},
    {"name": "Rajanpur", "lng": 70.33, "lat": 29.10, "date": "Aug 2022",
     "text": "Koh-e-Suleman hill torrents inundated villages across Rajanpur and DG Khan."},
    {"name": "Jafarabad / Dera Allah Yar", "lng": 68.21, "lat": 28.28, "date": "Aug 2022",
     "text": "Plains of eastern Balochistan submerged; the N-65 link to Sindh cut for weeks."},
    {"name": "Manchar Lake", "lng": 67.68, "lat": 26.42, "date": "4 Sep 2022",
     "text": "Pakistan's largest freshwater lake overflowed; embankment cuts made to protect Sehwan and Bhan Saeedabad, displacing ~100,000+."},
    {"name": "Johi, Dadu", "lng": 67.61, "lat": 26.69, "date": "Sep 2022",
     "text": "Town ringed by emergency dykes as floodwater surrounded it for weeks."},
    {"name": "Sukkur Barrage", "lng": 68.85, "lat": 27.68, "date": "Aug–Sep 2022",
     "text": "Indus flows and torrential rain overwhelmed drainage across upper Sindh."},
]

SOURCES = [
    {"name": "NDMA Pakistan – Monsoon 2022 SitReps", "url": "https://www.ndma.gov.pk/"},
    {"name": "Pakistan Floods 2022 PDNA (Govt of Pakistan, ADB, EU, UNDP, World Bank)",
     "url": "https://www.undp.org/pakistan/publications/pakistan-floods-2022-post-disaster-needs-assessment-pdna"},
    {"name": "PMD – Monthly Climate Summary Aug 2022", "url": "https://www.pmd.gov.pk/"},
    {"name": "UN OCHA – Pakistan: 2022 Monsoon Floods", "url": "https://reliefweb.int/disaster/fl-2022-000254-pak"},
    {"name": "geoBoundaries (PAK ADM1/ADM2)", "url": "https://www.geoboundaries.org/"},
    {"name": "NASA GIBS / Worldview – MODIS Bands 7-2-1", "url": "https://worldview.earthdata.nasa.gov/"},
]


def as_dict():
    return {
        "event": EVENT,
        "national": NATIONAL,
        "provinces": PROVINCES,
        "rainfall": RAINFALL,
        "death_timeline": DEATH_TIMELINE,
        "districts": {"severe": SEVERE, "affected": AFFECTED},
        "incidents": INCIDENTS,
        "sources": SOURCES,
    }

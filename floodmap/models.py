from django.db import models


class HazardEvent(models.Model):
    """A disaster event with its headline impact figures (NDMA / PDNA)."""

    HAZARD_TYPES = [("flood", "Flood"), ("heatwave", "Heatwave"), ("earthquake", "Earthquake"),
                    ("drought", "Drought"), ("cyclone", "Cyclone")]

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=200)
    hazard_type = models.CharField(max_length=20, choices=HAZARD_TYPES, default="flood")
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    summary = models.TextField(blank=True)

    deaths = models.PositiveIntegerField(default=0)
    injured = models.PositiveIntegerField(default=0)
    people_affected = models.PositiveBigIntegerField(default=0)
    people_displaced = models.PositiveBigIntegerField(default=0)
    houses_damaged = models.PositiveIntegerField(default=0)
    houses_destroyed = models.PositiveIntegerField(default=0)
    livestock_lost = models.PositiveIntegerField(default=0)
    roads_damaged_km = models.PositiveIntegerField(default=0)
    bridges_damaged = models.PositiveIntegerField(default=0)
    calamity_districts = models.PositiveIntegerField(default=0)
    damage_usd_bn = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    loss_usd_bn = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    needs_usd_bn = models.DecimalField(max_digits=6, decimal_places=2, default=0)

    def __str__(self):
        return self.name


class Province(models.Model):
    pcode = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=100)
    area_km2 = models.FloatField(default=0)
    geometry = models.JSONField()

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ProvinceImpact(models.Model):
    """Per-event casualties and rainfall for a province (NDMA / PMD)."""

    event = models.ForeignKey(HazardEvent, on_delete=models.CASCADE, related_name="province_impacts")
    province = models.ForeignKey(Province, on_delete=models.CASCADE, related_name="impacts")
    deaths = models.PositiveIntegerField(default=0)
    injured = models.PositiveIntegerField(null=True, blank=True)
    rainfall_anomaly_pct = models.IntegerField(null=True, blank=True, help_text="August rainfall vs normal (PMD)")
    note = models.TextField(blank=True)

    class Meta:
        unique_together = [("event", "province")]
        ordering = ["-deaths"]

    def __str__(self):
        return f"{self.province} – {self.event}"


class District(models.Model):
    pcode = models.CharField(max_length=12, primary_key=True)
    name = models.CharField(max_length=100)
    province = models.ForeignKey(Province, on_delete=models.CASCADE, related_name="districts")
    area_km2 = models.FloatField(default=0)
    population = models.PositiveBigIntegerField(default=0, help_text="WorldPop 2020, as used by UNOSAT")
    geometry = models.JSONField()

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.province.name})"


class ExposureSnapshot(models.Model):
    """Satellite-detected flood water and exposed population for one district and one period (UNOSAT)."""

    event = models.ForeignKey(HazardEvent, on_delete=models.CASCADE, related_name="exposure")
    district = models.ForeignKey(District, on_delete=models.CASCADE, related_name="exposure")
    period_label = models.CharField(max_length=40)
    period_start = models.DateField()
    period_end = models.DateField()
    analysed_km2 = models.FloatField(default=0)
    flood_km2 = models.FloatField(default=0)
    exposed_population = models.PositiveBigIntegerField(default=0)

    class Meta:
        unique_together = [("event", "district", "period_start", "period_end")]
        ordering = ["period_start", "period_end"]
        indexes = [models.Index(fields=["event", "period_start", "period_end"])]

    @property
    def flooded_share(self):
        return self.flood_km2 / self.district.area_km2 if self.district.area_km2 else 0

    @property
    def exposed_share(self):
        return self.exposed_population / self.district.population if self.district.population else 0


class Incident(models.Model):
    event = models.ForeignKey(HazardEvent, on_delete=models.CASCADE, related_name="incidents")
    name = models.CharField(max_length=120)
    date_label = models.CharField(max_length=40)
    lng = models.FloatField()
    lat = models.FloatField()
    description = models.TextField()

    def __str__(self):
        return self.name


class DataSource(models.Model):
    event = models.ForeignKey(HazardEvent, on_delete=models.CASCADE, related_name="sources")
    name = models.CharField(max_length=200)
    publisher = models.CharField(max_length=120, blank=True)
    url = models.URLField()
    used_for = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return self.name


class Story(models.Model):
    """Global settings of a Mapbox Storytelling config (github.com/mapbox/storytelling)."""

    THEMES = [("dark", "Dark"), ("light", "Light")]

    event = models.OneToOneField(HazardEvent, on_delete=models.CASCADE, related_name="story")
    style = models.CharField(max_length=200, default="mapbox://styles/mapbox/dark-v11")
    theme = models.CharField(max_length=10, choices=THEMES, default="dark")
    projection = models.CharField(max_length=30, default="globe")
    show_markers = models.BooleanField(default=False)
    marker_color = models.CharField(max_length=20, default="#ff5a4e")
    inset = models.BooleanField(default=True, help_text="Globe inset minimap")
    use_3d_terrain = models.BooleanField(default=True)
    auto = models.BooleanField(default=False, help_text="Auto-advance chapters")
    title = models.CharField(max_length=200)
    subtitle = models.CharField(max_length=300, blank=True)
    byline = models.CharField(max_length=200, blank=True)
    footer = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "stories"

    def __str__(self):
        return self.title


class Chapter(models.Model):
    ALIGNMENTS = [("left", "Left"), ("center", "Center"), ("right", "Right"), ("full", "Full")]
    ANIMATIONS = [("flyTo", "flyTo"), ("easeTo", "easeTo"), ("jumpTo", "jumpTo")]

    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="chapters")
    order = models.PositiveIntegerField(default=0)
    slug = models.SlugField(help_text="Chapter id used in the page")
    alignment = models.CharField(max_length=10, choices=ALIGNMENTS, default="left")
    hidden = models.BooleanField(default=False)
    title = models.CharField(max_length=200, blank=True)
    image = models.CharField(max_length=300, blank=True, help_text="URL or static path")
    description = models.TextField(blank=True, help_text="HTML allowed")
    center_lng = models.FloatField()
    center_lat = models.FloatField()
    zoom = models.FloatField(default=5)
    pitch = models.FloatField(default=0)
    bearing = models.FloatField(default=0)
    speed = models.FloatField(null=True, blank=True)
    curve = models.FloatField(null=True, blank=True)
    map_animation = models.CharField(max_length=10, choices=ANIMATIONS, default="flyTo")
    rotate_animation = models.BooleanField(default=False)
    callback = models.CharField(max_length=60, blank=True, help_text="Name of a JS function in story-callbacks.js")
    on_chapter_enter = models.JSONField(default=list, blank=True, help_text='[{"layer": "id", "opacity": 1, "duration": 1000}]')
    on_chapter_exit = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["order"]
        unique_together = [("story", "slug")]

    def __str__(self):
        return f"{self.order}. {self.title or self.slug}"

    def to_config(self):
        location = {"center": [self.center_lng, self.center_lat], "zoom": self.zoom,
                    "pitch": self.pitch, "bearing": self.bearing}
        if self.speed:
            location["speed"] = self.speed
        if self.curve:
            location["curve"] = self.curve
        return {
            "id": self.slug, "alignment": self.alignment, "hidden": self.hidden, "title": self.title,
            "image": self.image, "description": self.description, "location": location,
            "mapAnimation": self.map_animation, "rotateAnimation": self.rotate_animation,
            "callback": self.callback, "onChapterEnter": self.on_chapter_enter,
            "onChapterExit": self.on_chapter_exit,
        }


class AIQuery(models.Model):
    """Log of questions asked to the AI analyst (useful for reviewing answers)."""

    created_at = models.DateTimeField(auto_now_add=True)
    question = models.TextField()
    focus = models.CharField(max_length=200, blank=True)
    answer = models.TextField()
    provider = models.CharField(max_length=20)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "AI query"
        verbose_name_plural = "AI queries"

    def __str__(self):
        return self.question[:80]

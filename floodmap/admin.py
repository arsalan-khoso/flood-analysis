from django.contrib import admin

from .models import (AIQuery, Chapter, DataSource, District, ExposureSnapshot, HazardEvent, Incident,
                     Province, ProvinceImpact, Story)

admin.site.site_header = "Pakistan Flood Story – Admin"
admin.site.site_title = "Flood Story Admin"


class ProvinceImpactInline(admin.TabularInline):
    model = ProvinceImpact
    extra = 0


class IncidentInline(admin.TabularInline):
    model = Incident
    extra = 0


class DataSourceInline(admin.TabularInline):
    model = DataSource
    extra = 0


@admin.register(HazardEvent)
class HazardEventAdmin(admin.ModelAdmin):
    list_display = ("name", "hazard_type", "start_date", "deaths", "people_affected", "damage_usd_bn")
    prepopulated_fields = {"slug": ("name",)}
    inlines = [ProvinceImpactInline, IncidentInline, DataSourceInline]
    fieldsets = [
        (None, {"fields": ("name", "slug", "hazard_type", "start_date", "end_date", "summary")}),
        ("Human impact (NDMA)", {"fields": ("deaths", "injured", "people_affected", "people_displaced")}),
        ("Physical damage (NDMA)", {"fields": ("houses_damaged", "houses_destroyed", "livestock_lost",
                                               "roads_damaged_km", "bridges_damaged", "calamity_districts")}),
        ("Economic (PDNA, USD bn)", {"fields": ("damage_usd_bn", "loss_usd_bn", "needs_usd_bn")}),
    ]


@admin.register(Province)
class ProvinceAdmin(admin.ModelAdmin):
    list_display = ("name", "pcode", "area_km2")
    exclude = ("geometry",)


class ExposureInline(admin.TabularInline):
    model = ExposureSnapshot
    extra = 0
    fields = ("period_label", "analysed_km2", "flood_km2", "exposed_population")
    readonly_fields = fields
    can_delete = False


@admin.register(District)
class DistrictAdmin(admin.ModelAdmin):
    list_display = ("name", "province", "pcode", "population", "area_km2")
    list_filter = ("province",)
    search_fields = ("name", "pcode")
    exclude = ("geometry",)
    inlines = [ExposureInline]


@admin.register(ExposureSnapshot)
class ExposureSnapshotAdmin(admin.ModelAdmin):
    list_display = ("district", "period_label", "flood_km2", "exposed_population")
    list_filter = ("period_label", "district__province")
    search_fields = ("district__name",)
    list_select_related = ("district__province",)


class ChapterInline(admin.StackedInline):
    model = Chapter
    extra = 0
    fieldsets = [
        (None, {"fields": (("order", "slug", "alignment", "hidden"), "title", "image", "description")}),
        ("Camera", {"fields": (("center_lng", "center_lat"), ("zoom", "pitch", "bearing"), ("speed", "curve"),
                               ("map_animation", "rotate_animation"), "callback")}),
        ("Layers", {"fields": ("on_chapter_enter", "on_chapter_exit")}),
    ]


@admin.register(Story)
class StoryAdmin(admin.ModelAdmin):
    list_display = ("title", "event", "theme", "use_3d_terrain", "auto")
    inlines = [ChapterInline]


@admin.register(AIQuery)
class AIQueryAdmin(admin.ModelAdmin):
    list_display = ("created_at", "provider", "question")
    list_filter = ("provider",)
    search_fields = ("question", "answer")
    readonly_fields = ("created_at", "question", "focus", "answer", "provider")

from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("story/<slug:slug>/", views.index, name="story"),
    path("api/events/<slug:slug>/", views.event_detail, name="event-detail"),
    path("api/events/<slug:slug>/story/", views.story_api, name="story-config"),
    path("api/events/<slug:slug>/provinces.geojson", views.provinces_geojson, name="provinces-geojson"),
    path("api/events/<slug:slug>/districts.geojson", views.districts_geojson, name="districts-geojson"),
    path("api/events/<slug:slug>/exposure/", views.exposure_summary, name="exposure-summary"),
    path("api/events/<slug:slug>/districts/<str:pcode>/", views.district_detail, name="district-detail"),
    path("api/ask/", views.ask, name="ask"),
]

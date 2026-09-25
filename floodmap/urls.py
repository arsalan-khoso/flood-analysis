from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/data/", views.dataset, name="dataset"),
    path("api/ask/", views.ask, name="ask"),
]

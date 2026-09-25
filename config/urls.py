from django.urls import include, path

urlpatterns = [
    path("", include("floodmap.urls")),
]

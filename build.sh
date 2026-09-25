#!/usr/bin/env bash
set -o errexit
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
python manage.py load_flood_data
# Create the admin user from DJANGO_SUPERUSER_USERNAME / _EMAIL / _PASSWORD if they are set
if [ -n "$DJANGO_SUPERUSER_USERNAME" ]; then
  python manage.py createsuperuser --no-input || true
fi

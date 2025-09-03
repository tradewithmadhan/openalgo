#!/bin/bash

echo "[OpenAlgo] Starting up..."

mkdir -p db logs
chmod -R 777 db logs 2>/dev/null || echo "⚠️  Skipping chmod (volume may be mounted)"

# Run Flask directly with uv to avoid eventlet conflicts
cd /app
#exec /app/.venv/bin/python app.py
exec /app/.venv/bin/gunicorn --bind=0.0.0.0:5000 \
                              --worker-class=eventlet \
                              --workers=4 \
                              --log-level=info \
                              app:app

#!/bin/bash

echo "[OpenAlgo] Starting up..."

mkdir -p db logs
chmod -R 775 db logs 2>/dev/null || echo "⚠️ Skipping chmod (volume may be mounted)"

# Check if we're running in Docker container
if [ -f /.dockerenv ] || grep -q 'docker\|containerd\|kubepods' /proc/1/cgroup 2>/dev/null; then
    echo "[OpenAlgo] 🐳 Docker environment detected"
    echo "[OpenAlgo] Starting Flask application with Gunicorn + Eventlet..."

    # Environment variables for eventlet
    export EVENTLET_HUB=poll
    export GEVENT_SUPPORT=True

    # Gunicorn config with early eventlet patching
    cat > /tmp/gunicorn_config.py << 'EOF'
import eventlet
eventlet.monkey_patch()

bind = "0.0.0.0:5000"
worker_class = "eventlet"
workers = 1  # Can be tuned via env
preload_app = True
max_requests = 1000
max_requests_jitter = 100
timeout = 120
keepalive = 5
log_level = "info"

def when_ready(server):
    server.log.info("OpenAlgo Flask server ready")

def worker_init(worker):
    import eventlet
    eventlet.monkey_patch()
EOF

    exec /app/.venv/bin/gunicorn -c /tmp/gunicorn_config.py app:app
else
    echo "[OpenAlgo] 💻 Local environment detected - running Flask directly"
    cd /app
    exec /app/.venv/bin/python app.py
fi

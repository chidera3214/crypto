#!/bin/bash
set -e

# Default PORT is set by cloud provider (e.g. 80 or 3000)
# If not set, default to 3000
PUBLIC_PORT="${PORT:-3000}"

echo "Starting Combined Service..."
echo "Public Port (Backend): $PUBLIC_PORT"

# Start Backend
# We run the backend on the public PORT
echo "Starting Backend..."
cd /app/backend
# Pass the PUBLIC_PORT to the backend
export PORT=$PUBLIC_PORT
# Optimize Node memory for small containers (limit heap to 256MB to leave room for Python)
export NODE_OPTIONS="--max-old-space-size=256"
npm run start &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to initialize..."
sleep 5

# Start Engine
# The engine needs its own internal port for health checks (if any)
# But crucially, it needs to know where the BACKEND is.
echo "Starting Engine..."
cd /app/engine
# Engine's internal port (for its own Flask health check)
export PORT=10000        
# Correctly point to the backend on the PUBLIC_PORT
export BACKEND_URL="http://127.0.0.1:$PUBLIC_PORT" 
# Use unbuffered output for Python
python3 -u main.py &
ENGINE_PID=$!

# Trap signals to kill both
trap "kill $BACKEND_PID $ENGINE_PID; exit" SIGINT SIGTERM

echo "Services running."
echo "Backend PID: $BACKEND_PID (Port $PUBLIC_PORT)"
echo "Engine PID: $ENGINE_PID (Internal Port 10000)"
echo "Engine connecting to Backend at: $BACKEND_URL"

# Wait for any process to exit
wait -n

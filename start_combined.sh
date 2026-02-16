#!/bin/bash
set -e

# Default PORT is set by cloud provider (e.g. 80 or 3000)
# If not set, default to 3000
PUBLIC_PORT="${PORT:-3000}"

echo "Starting Combined Service (Optimized for 512MB RAM)..."
echo "Public Port (Backend): $PUBLIC_PORT"

# Global PID variables
BACKEND_PID=""
ENGINE_PID=""

# Function to handle shutdown
cleanup() {
    echo "Container shutting down. Killing child processes..."
    # Kill both processes if they exist
    if [ -n "$BACKEND_PID" ]; then kill $BACKEND_PID 2>/dev/null || true; fi
    if [ -n "$ENGINE_PID" ]; then kill $ENGINE_PID 2>/dev/null || true; fi
    exit
}

# Trap signals for graceful shutdown
trap cleanup SIGINT SIGTERM EXIT

# --- Start Backend ---
echo "Starting Backend..."
cd /app/backend
# Pass the PUBLIC_PORT to the backend
export PORT=$PUBLIC_PORT
# Optimize Node memory: 
# Limit max old space size to 200MB (leaves ~300MB for Python + OS overhead)
export NODE_OPTIONS="--max-old-space-size=200"
npm run start &
BACKEND_PID=$!

# Wait briefly for backend to initialize
echo "Waiting for backend to initialize..."
sleep 5

# --- Start Engine ---
echo "Starting Engine..."
cd /app/engine
# Engine's internal port (must be different from Backend's port to avoid conflict)
export ENGINE_PORT=5001
export PORT=$ENGINE_PORT
# Point to backend
export BACKEND_URL="http://127.0.0.1:$PUBLIC_PORT" 
# Python Memory Optimizations for Low-RAM Containers:
# MALLOC_ARENA_MAX=2: Reduces memory fragmentation/bloat in glibc (Crucial for Python in containers)
export MALLOC_ARENA_MAX=2
# PYTHONUNBUFFERED=1: Ensures logs appear immediately
export PYTHONUNBUFFERED=1

python3 main.py &
ENGINE_PID=$!

echo "Services running."
echo "Backend PID: $BACKEND_PID (Port $PUBLIC_PORT)"
echo "Engine PID: $ENGINE_PID (Internal Port $ENGINE_PORT)"

# Wait for *any* process to exit. 
# If one acts up or crashes, 'wait -n' returns, and the script continues to exit (triggering cleanup).
wait -n

echo "A service has stopped unexpectedly. Shutting down container to allow restart..."
# The trap on EXIT will handle the kill commands
exit 1

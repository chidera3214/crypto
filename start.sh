#!/bin/bash

# Function to kill all background processes on exit
cleanup() {
    echo "Stopping all services..."
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

echo "Starting Crypto Platform..."

# 1. Start Backend
echo "[1/3] Starting Backend (Port 4000)..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..
sleep 5 # Wait for backend to initialize

# 2. Start Frontend
echo "[2/3] Starting Frontend (Port 3000)..."
cd frontend
npm run dev -- -p 3000 &
FRONTEND_PID=$!
cd ..

# 3. Start Engine
echo "[3/3] Starting Trading Engine..."
cd engine
source venv/bin/activate
python3 main.py &
ENGINE_PID=$!
cd ..

echo "All services started!"
echo "Backend: http://localhost:4000"
echo "Frontend: http://localhost:3000"
echo "Engine: Running in background"
echo "Press Ctrl+C to stop all services."

wait

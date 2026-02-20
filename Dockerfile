# Use Python 3.11 as base (Debian based)
FROM python:3.11-slim

# Install system dependencies
# - curl: for nodejs setup
# - build-essential, wget, gcc: for ta-lib build
RUN apt-get update && apt-get install -y     curl     build-essential     wget     gcc     && rm -rf /var/lib/apt/lists/*

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - &&     apt-get install -y nodejs

# Install TA-Lib C Library (required for python wrapper)
WORKDIR /tmp
RUN wget http://prdownloads.sourceforge.net/ta-lib/ta-lib-0.4.0-src.tar.gz && \
    tar -xzf ta-lib-0.4.0-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=/usr && \
    make && \
    make install && \
    cd .. && \
    rm -rf ta-lib ta-lib-0.4.0-src.tar.gz

# Set up work directory
WORKDIR /app

# --- Backend Setup ---
# Copy backend package files first for caching
COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm install
# Copy backend source
COPY backend ./
# Build Typescript backend
RUN npm run build
# Ensure dist/server.js exists (npm run build does this)

# --- Engine Setup ---
WORKDIR /app/engine
# Copy engine requirements first
COPY engine/requirements.txt ./
# Install python dependencies
RUN pip install --no-cache-dir -r requirements.txt
# Copy engine source
COPY engine ./

# --- Finalize ---
WORKDIR /app
COPY start_combined.sh ./
RUN chmod +x start_combined.sh

# Expose the expected public port (Render uses PORT env var = 10000)
EXPOSE 10000

# Start command
CMD ["./start_combined.sh"]

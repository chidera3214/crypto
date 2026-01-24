# Use an official Python runtime with TA-Lib support
# Use an official Python runtime with TA-Lib support
FROM python:3.11-slim

# Install system dependencies required for TA-Lib
RUN apt-get update && apt-get install -y \
    gcc \
    build-essential \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install TA-Lib C library
WORKDIR /tmp
RUN wget http://prdownloads.sourceforge.net/ta-lib/ta-lib-0.4.0-src.tar.gz && \
    tar -xzf ta-lib-0.4.0-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=/usr && \
    make && \
    make install && \
    cd .. && \
    rm -rf ta-lib ta-lib-0.4.0-src.tar.gz

# Set up the application
WORKDIR /app
COPY requirements.txt .

# Install Python dependencies
# TA-Lib python wrapper needs to know where the C lib is
# Usually /usr/lib or /usr/local/lib. The configure --prefix=/usr above puts it in /usr
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the port Render expects
EXPOSE 10000

# Run the engine
CMD ["python", "-u", "main.py"]

import time
import json
import requests
import numpy as np
import talib
from datetime import datetime

import os

# Configuration
# Default to localhost if not set, but allow override for Render
RAW_HOST = os.getenv("BACKEND_URL", "localhost:4000")
PROTOCOL = "http" if "localhost" in RAW_HOST else "https"
BASE_URL = RAW_HOST if RAW_HOST.startswith("http") else f"{PROTOCOL}::{RAW_HOST}"
# Fix double colon typo possibility if logic is complex, simplify:
if not RAW_HOST.startswith("http"):
    BASE_URL = f"https://{RAW_HOST}" if "localhost" not in RAW_HOST else f"http://{RAW_HOST}"
else:
    BASE_URL = RAW_HOST
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Email Configuration (Environment Variables Recommended)
# If not set, email sending will be skipped.
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
EMAIL_TO = os.getenv("EMAIL_TO", "")

BACKEND_URL = f"{BASE_URL}/signal"
SYMBOL = "BTCUSDT"
TIMEFRAMES = ["15m", "4h"]
LIMIT = 500

# Rotational Endpoints for Binance (in case one is blocked)
BINANCE_ENDPOINTS = [
    "https://api.binance.com/api/v3/klines",
    "https://api1.binance.com/api/v3/klines",
    "https://api2.binance.com/api/v3/klines",
    "https://api3.binance.com/api/v3/klines",
    "https://data-api.binance.vision/api/v3/klines"
]

def fetch_candles(timeframe):
    params = {
        "symbol": SYMBOL,
        "interval": timeframe,
        "limit": LIMIT
    }
    
    for url in BINANCE_ENDPOINTS:
        try:
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list) or len(data) == 0:
                continue
            closes = np.array([float(x[4]) for x in data])
            highs = np.array([float(x[2]) for x in data])
            lows = np.array([float(x[3]) for x in data])
            opens = np.array([float(x[1]) for x in data])
            times = np.array([int(x[0]) for x in data])
            return {"time": times, "open": opens, "high": highs, "low": lows, "close": closes}
        except Exception as e:
            # print(f"Error fetching from {url}: {e}")
            continue

    return None

def analyze_market(data, timeframe):
    closes = data["close"]
    highs = data["high"]
    lows = data["low"]
    
    # 1. Bollinger Bands (20, 2)
    upper, middle, lower = talib.BBANDS(closes, timeperiod=20, nbdevup=2, nbdevdn=2, matype=0)
    
    # 2. RSI (14)
    rsi = talib.RSI(closes, timeperiod=14)
    
    # 3. MACD (12, 26, 9)
    macd, macd_signal, macd_hist = talib.MACD(closes, fastperiod=12, slowperiod=26, signalperiod=9)
    
    idx = -1 # Current Candle (Closed or forming? Ideally checking closed, but for 'touch' current is okay if we are careful)
    # Using -2 for previous confirmed candle for crossovers, -1 for current touch
    
    current_price = closes[idx]
    current_rsi = rsi[idx]
    prev_rsi = rsi[idx-1]
    
    current_macd = macd[idx]
    current_signal = macd_signal[idx]
    prev_macd = macd[idx-1]
    prev_signal = macd_signal[idx-1]
    
    current_lower = lower[idx]
    current_upper = upper[idx]
    current_middle = middle[idx]

    signal_type = None
    reason = ""

    # STRATEGY LOGIC
    
    # 1. Buy Setup (Long)
    # - Price touches or dips below Lower Band
    # - RSI < 30 (Oversold) -> pointing up (current > prev implies turning up)
    # - MACD Crossover (Line crosses above Signal)
    
    # Note: Precise "Cross" usually means it happened just now. 
    # Valid condition: (prev_macd < prev_signal) AND (current_macd > current_signal)
    
    start_pointing_up = current_rsi > prev_rsi
    start_pointing_down = current_rsi < prev_rsi
    
    # We relax the crossover strictness slightly to "Recent Crossover or just crossed" + Confirmations
    # or follow the user strict "Enter on next candle open ONCE ALL 3 ALIGN".
    # Since we run every X seconds, if we see the state, we signal.
    
    macd_bullish_cross = (prev_macd <= prev_signal) and (current_macd > current_signal)
    macd_bearish_cross = (prev_macd >= prev_signal) and (current_macd < current_signal)
    
    # Also allow if configured is "MACD > Signal" and just happened recenty, but user said "Wait for crossover". 
    # Let's stick to strict crossover logic for safety.

    # Debug Printing
    print(f"   [{timeframe}] P: {current_price:.2f} | RSI: {current_rsi:.1f} | MACD_Diff: {current_macd - current_signal:.2f}")

    # BUY Logic
    if (lows[idx] <= current_lower or current_price <= current_lower) and \
       (current_rsi < 30 or prev_rsi < 30) and start_pointing_up and \
       macd_bullish_cross:
        
        signal_type = "BUY"
        reason = f"[{timeframe}] Lower BB Touch + RSI Oversold ({current_rsi:.1f}) + MACD Bullish Cross"

    # SELL Logic
    elif (highs[idx] >= current_upper or current_price >= current_upper) and \
         (current_rsi > 70 or prev_rsi > 70) and start_pointing_down and \
         macd_bearish_cross:
         
        signal_type = "SELL"
        reason = f"[{timeframe}] Upper BB Touch + RSI Overbought ({current_rsi:.1f}) + MACD Bearish Cross"

    if signal_type:
        # Risk Management: 1% risk per trade.
        # Stop Loss: Just outside BB (using a small buffer)
        bb_width = current_upper - current_lower
        buffer = bb_width * 0.05 # 5% of the band width as buffer
        
        sl = current_lower - buffer if signal_type == "BUY" else current_upper + buffer
        
        # Take Profit: Middle Band (Partial), Opposite Band (Full). 
        # For signal format, we send the "Main" TP (Opposite Band)
        tp = current_upper if signal_type == "BUY" else current_lower
        
        # Calculate Risk and Quantity is done on Frontend usually, but we send zones
        
        return {
            "symbol": f"{SYMBOL}",
            "timeframe": timeframe,
            "type": signal_type,
            "timestamp": time.time(),
            "price": current_price,
            "setup_zones": {
                "entry_zone": { "high": current_price, "low": current_price },
                "stop_loss": sl,
                "take_profit": tp
            },
            "reason": reason,
            "context_candles": [
                {"time": int(data["time"][i] / 1000), "open": data["open"][i], "high": data["high"][i], "low": data["low"][i], "close": data["close"][i]}
                for i in range(max(0, len(data["time"])-100), len(data["time"]))
            ]
        }
    return None

def send_email(signal):
    if not SMTP_USER or not SMTP_PASS or not EMAIL_TO:
        print("   [INFO] Email configuration missing, skipping notification.")
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_USER
        msg['To'] = EMAIL_TO
        msg['Subject'] = f"AlphaScanner Signal: {signal['type']} {signal['symbol']} ({signal['timeframe']})"

        body = f"""
        AlphaScanner Signal Alert
        -------------------------
        Type: {signal['type']}
        Symbol: {signal['symbol']}
        Timeframe: {signal['timeframe']}
        Price: {signal['price']}
        
        Reason: {signal['reason']}
        
        Setup:
        - Stop Loss: {signal['setup_zones']['stop_loss']:.2f}
        - Take Profit: {signal['setup_zones']['take_profit']:.2f}
        """
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        text = msg.as_string()
        server.sendmail(SMTP_USER, EMAIL_TO, text)
        server.quit()
        print(f"   [SUCCESS] Email sent to {EMAIL_TO}")
    except Exception as e:
        print(f"   [ERROR] Failed to send email: {e}")

def send_signal(signal):
    # 1. Send to Backend
    try:
        requests.post(BACKEND_URL, json=signal)
        print(f"   [SUCCESS] Signal Sent: {signal['type']} {signal['symbol']} ({signal['timeframe']})")
    except Exception as e:
        print(f"   [ERROR] Failed to send signal: {e}")

    # 2. Send Email Notification
    send_email(signal)

def run_scanner():
    print(f"Starting AlphaScanner [M15, H4]...")
    print("Strategy: BB Touch + RSI Extreme + MACD Cross")
    
    last_processed = {}
    
    while True:
        for tf in TIMEFRAMES:
            data = fetch_candles(tf)
            if data:
                signal = analyze_market(data, tf)
                if signal:
                    # Avoid sending duplicate signals for the same candle timestamp
                    last_ts = last_processed.get(tf, 0)
                    if signal['timestamp'] - last_ts > 60: # Simple debounce
                        send_signal(signal)
                        last_processed[tf] = signal['timestamp']
            time.sleep(2) # Short pause between timeframes
            
        print("... Scanning ...")
        time.sleep(30) # Scan every 30 seconds

import threading
from flask import Flask

# Flask App for Render Health Check
app = Flask(__name__)

@app.route('/health')
def health():
    return "OK", 200

@app.route('/')
def home():
    return "AlphaScanner Engine is Running", 200

if __name__ == "__main__":
    # Start the Scanner in a separate background thread
    scanner_thread = threading.Thread(target=run_scanner, daemon=True)
    scanner_thread.start()
    
    # Start Flask Server (Block main thread with this)
    # Render sets PORT env var. Default to 10000 if not set.
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)

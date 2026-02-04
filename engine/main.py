import time
import json
import requests
import numpy as np
import talib
from datetime import datetime
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import threading
from flask import Flask

# Configuration
RAW_HOST = os.getenv("BACKEND_URL", "localhost:4000")
PROTOCOL = "http" if "localhost" in RAW_HOST else "https"
BASE_URL = RAW_HOST if RAW_HOST.startswith("http") else f"{PROTOCOL}::{RAW_HOST}"
if not RAW_HOST.startswith("http"):
    BASE_URL = f"https://{RAW_HOST}" if "localhost" not in RAW_HOST else f"http://{RAW_HOST}"
else:
    BASE_URL = RAW_HOST

# Email Configuration
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
EMAIL_TO = os.getenv("EMAIL_TO", "")

BACKEND_URL = f"{BASE_URL}/signal"
SYMBOL = "BTCUSDT"
TIMEFRAMES = ["1m", "15m", "4h"]
LIMIT = 500

# Rotational Endpoints for Binance
BINANCE_ENDPOINTS = [
    "https://api.binance.com/api/v3/klines",
    "https://api1.binance.com/api/v3/klines",
    "https://api2.binance.com/api/v3/klines",
    "https://api3.binance.com/api/v3/klines",
    "https://data-api.binance.vision/api/v3/klines"
]

def fetch_candles(timeframe, limit=LIMIT):
    params = {
        "symbol": SYMBOL,
        "interval": timeframe,
        "limit": limit
    }
    
    for url in BINANCE_ENDPOINTS:
        try:
            response = requests.get(url, params=params, timeout=5)
            # response.raise_for_status()
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
            continue
    return None

# --- 1M SCALPING STRATEGY ---
def get_candle_pattern(opens, highs, lows, closes):
    # Check for multiple patterns using TA-Lib
    # Returns (pattern_name, value) where value is 100 (Bullish), -100 (Bearish), or 0
    
    patterns = {
        "Engulfing": talib.CDLENGULFING,
        "Hammer": talib.CDLHAMMER,
        "Shooting Star": talib.CDLSHOOTINGSTAR,
        "Morning Star": talib.CDLMORNINGSTAR,
        "Evening Star": talib.CDLEVENINGSTAR,
        "Piercing": talib.CDLPIERCING,
        "Dark Cloud Cover": talib.CDLDARKCLOUDCOVER,
        "Doji": talib.CDLDOJI,
        "Marubozu": talib.CDLMARUBOZU,
        "Harami": talib.CDLHARAMI
    }
    
    idx = -2 # Check the last COMPLETED candle
    
    detected_patterns = []
    
    for name, func in patterns.items():
        res = func(opens, highs, lows, closes)
        val = res[idx]
        if val != 0:
            detected_patterns.append((name, val))
            
    return detected_patterns

def analyze_1m_strategy(data_1m):
    # Step A: The Alignment (Check 5m and 1h) using 200 EMA
    # Fetch sufficient data
    data_5m = fetch_candles("5m", limit=300)
    data_1h = fetch_candles("1h", limit=300)
    
    if not data_5m or not data_1h:
        return None 
        
    # Calculate 200 EMAs
    closes_1h = data_1h["close"]
    if len(closes_1h) < 200: return None
    ema200_1h = talib.EMA(closes_1h, timeperiod=200)
    
    closes_5m = data_5m["close"]
    if len(closes_5m) < 200: return None
    ema200_5m = talib.EMA(closes_5m, timeperiod=200)
    
    # Check Trend Alignment
    price_1h = closes_1h[-1]
    price_5m = closes_5m[-1]
    
    # UP TREND: Price > 200 EMA on BOTH 1H and 5M
    up_trend_aligned = (price_1h > ema200_1h[-1]) and (price_5m > ema200_5m[-1])
    
    # DOWN TREND: Price < 200 EMA on BOTH 1H and 5M
    down_trend_aligned = (price_1h < ema200_1h[-1]) and (price_5m < ema200_5m[-1])
    
    if not up_trend_aligned and not down_trend_aligned:
        return None # Middle of nowhere

    # Step B & C: Detect ANY Candlestick Pattern matches the Trend
    
    closes = data_1m["close"]
    highs = data_1m["high"]
    lows = data_1m["low"]
    opens = data_1m["open"]
    
    if len(closes) < 100: return None

    # Get patterns on the last closed candle
    found_patterns = get_candle_pattern(opens, highs, lows, closes)
    
    if not found_patterns:
        return None
        
    signal_type = None
    reason = ""
    stop_loss = 0
    take_profit = 0
    entry_price = 0
    
    idx = -2 # Last closed candle index
    current_close = closes[idx]
    current_high = highs[idx]
    current_low = lows[idx]
    
    # --- BUY SCENARIO (UP TREND) ---
    if up_trend_aligned:
        # Look for Bullish Patterns (value > 0)
        for name, val in found_patterns:
            if val > 0: # Bullish signal from TA-Lib
                signal_type = "BUY"
                buffer = 2.0
                entry_price = current_high + buffer
                stop_loss = current_low - buffer
                risk = entry_price - stop_loss
                take_profit = entry_price + (risk * 1.5)
                reason = f"[1m Scalping] GLOBAL UPTREND + Pattern: {name}"
                break 

    # --- SELL SCENARIO (DOWN TREND) ---
    elif down_trend_aligned:
        # Look for Bearish Patterns (value < 0)
        for name, val in found_patterns:
            if val < 0: # Bearish signal from TA-Lib
                signal_type = "SELL"
                buffer = 2.0
                entry_price = current_low - buffer
                stop_loss = current_high + buffer
                risk = stop_loss - entry_price
                take_profit = entry_price - (risk * 1.5)
                reason = f"[1m Scalping] GLOBAL DOWNTREND + Pattern: {name}"
                break

    if signal_type:
        return {
            "symbol": SYMBOL,
            "timeframe": "1m",
            "type": signal_type,
            "timestamp": time.time(),
            "price": closes[-1],
            "setup_zones": {
                "entry_zone": { "high": entry_price, "low": entry_price },
                "stop_loss": stop_loss,
                "take_profit": take_profit
            },
            "reason": reason,
            "context_candles": [
                {"time": int(data_1m["time"][i] / 1000), "open": data_1m["open"][i], "high": data_1m["high"][i], "low": data_1m["low"][i], "close": data_1m["close"][i]}
                for i in range(max(0, len(data_1m["time"])-50), len(data_1m["time"]))
            ]
        }
        
    return None

def analyze_market_general(data, timeframe):
    closes = data["close"]
    highs = data["high"]
    lows = data["low"]
    
    # 1. Bollinger Bands (20, 2)
    upper, middle, lower = talib.BBANDS(closes, timeperiod=20, nbdevup=2, nbdevdn=2, matype=0)
    # 2. RSI (14)
    rsi = talib.RSI(closes, timeperiod=14)
    # 3. MACD (12, 26, 9)
    macd, macd_signal, macd_hist = talib.MACD(closes, fastperiod=12, slowperiod=26, signalperiod=9)
    
    idx = -2 
    
    current_price = closes[idx]
    current_rsi = rsi[idx]
    prev_rsi = rsi[idx-1]
    
    current_macd = macd[idx]
    current_signal = macd_signal[idx]
    prev_macd = macd[idx-1]
    prev_signal = macd_signal[idx-1]
    
    current_lower = lower[idx]
    current_upper = upper[idx]
    
    signal_type = None
    reason = ""

    macd_bullish_cross = (prev_macd <= prev_signal) and (current_macd > current_signal)
    macd_bearish_cross = (prev_macd >= prev_signal) and (current_macd < current_signal)
    
    start_pointing_up = current_rsi > prev_rsi
    start_pointing_down = current_rsi < prev_rsi

    # BUY Logic
    if (lows[idx] <= current_lower) and \
       (current_rsi < 30 or prev_rsi < 30) and start_pointing_up and \
       macd_bullish_cross:
        signal_type = "BUY"
        reason = f"[{timeframe}] Lower BB Touch + RSI Oversold + MACD Bull Cross"

    # SELL Logic
    elif (highs[idx] >= current_upper) and \
         (current_rsi > 70 or prev_rsi > 70) and start_pointing_down and \
         macd_bearish_cross:
        signal_type = "SELL"
        reason = f"[{timeframe}] Upper BB Touch + RSI Overbought + MACD Bear Cross"

    if signal_type:
        bb_width = current_upper - current_lower
        buffer = bb_width * 0.05
        sl = current_lower - buffer if signal_type == "BUY" else current_upper + buffer
        tp = current_upper if signal_type == "BUY" else current_lower
        
        return {
            "symbol": f"{SYMBOL}",
            "timeframe": timeframe,
            "type": signal_type,
            "timestamp": time.time(),
            "price": closes[-1],
            "setup_zones": {
                "entry_zone": { "high": closes[-1], "low": closes[-1] },
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

def analyze_market_dispatch(data, timeframe):
    if timeframe == "1m":
        return analyze_1m_strategy(data)
    else:
        return analyze_market_general(data, timeframe)

def send_email(signal):
    if not SMTP_USER or not SMTP_PASS or not EMAIL_TO:
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
        Entry Price (Approx): {signal['setup_zones']['entry_zone']['high']:.2f}
        
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
    try:
        requests.post(BACKEND_URL, json=signal)
        print(f"   [SUCCESS] Signal Sent: {signal['type']} {signal['symbol']} ({signal['timeframe']})")
    except Exception as e:
        print(f"   [ERROR] Failed to send signal to backend: {e}")
    send_email(signal)

def run_scanner():
    print(f"Starting AlphaScanner [1m, 15m, 4h]...")
    last_processed = {}
    
    while True:
        for tf in TIMEFRAMES:
            # print(f"Checking {tf}...")
            data = fetch_candles(tf)
            if data:
                signal = analyze_market_dispatch(data, tf)
                if signal:
                    last_ts = last_processed.get(tf, 0)
                    current_ts = signal['timestamp']
                    
                    if current_ts - last_ts > 60: 
                        send_signal(signal)
                        last_processed[tf] = current_ts
            time.sleep(1)
            
        time.sleep(10) # Scan loop delay

# Flask App for Render Health Check
app = Flask(__name__)

@app.route('/health')
def health():
    return "OK", 200

@app.route('/')
def home():
    return "AlphaScanner Engine is Running", 200

if __name__ == "__main__":
    scanner_thread = threading.Thread(target=run_scanner, daemon=True)
    scanner_thread.start()
    
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)

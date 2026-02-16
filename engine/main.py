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
 
# Asset Configuration
# Maps Display Symbol -> API Symbol (Binance Spot or Futures)
ASSETS = {
    # Using COIN-Margined Futures for BTC/USD (Quoted in USD)
    "BTCUSD": {"api_symbol": "BTCUSD_PERP", "strategy": "btc_standard", "source": "futures_coin_m"},
    # Using USDT-Margined Futures for Gold (Proxy for XAU/USD)
    "XAUUSD": {"api_symbol": "XAUUSDT", "strategy": "gold_scalp", "source": "futures_usdt"} 
}


TIMEFRAMES = ["1m", "15m", "4h"]
LIMIT = 500

# Endpoint Configuration
# Endpoint Configuration
BINANCE_SPOT = [
    "https://api.binance.com/api/v3/klines",
    "https://data-api.binance.vision/api/v3/klines"
]

BINANCE_FUTURES_USDT = [ # USDT-Margined (fapi)
    "https://fapi.binance.com/fapi/v1/klines"
]

BINANCE_FUTURES_COIN = [ # COIN-Margined (dapi) - Quoted in USD
    "https://dapi.binance.com/dapi/v1/klines"
]

def fetch_candles(symbol, timeframe, limit=LIMIT):
    # Resolve Configuration
    config = ASSETS.get(symbol, {})
    api_symbol = config.get("api_symbol", symbol)
    source = config.get("source", "spot")
    
    # Select Endpoints
    if source == "futures_usdt":
        endpoints = BINANCE_FUTURES_USDT
    elif source == "futures_coin_m":
        endpoints = BINANCE_FUTURES_COIN
    else:
        endpoints = BINANCE_SPOT
    
    params = {
        "symbol": api_symbol,
        "interval": timeframe,
        "limit": limit
    }
    
    for url in endpoints:
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

# --- STRATEGY HELPERS ---
def get_candle_pattern(opens, highs, lows, closes):
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

# --- BTC STRATEGY (EMA Crossover + Trend) ---
def analyze_btc_strategy(symbol, data_1m):
    # Step A: Higher Timeframe Trend Filter (H1 & M5 200 EMA)
    data_5m = fetch_candles(symbol, "5m", limit=300)
    data_1h = fetch_candles(symbol, "1h", limit=300)
    
    if not data_5m or not data_1h:
        return None 
        
    ema200_1h = talib.EMA(data_1h["close"], timeperiod=200)
    ema200_5m = talib.EMA(data_5m["close"], timeperiod=200)
    
    price_1h = data_1h["close"][-1]
    price_5m = data_5m["close"][-1]
    
    # 1. Global Trend Direction
    trend_bullish = (price_1h > ema200_1h[-1]) and (price_5m > ema200_5m[-1])
    trend_bearish = (price_1h < ema200_1h[-1]) and (price_5m < ema200_5m[-1])
    
    if not trend_bullish and not trend_bearish:
        return None

    # Step B: M1 Timeframe Triggers (50 & 100 EMA Crossover)
    closes_1m = data_1m["close"]
    
    if len(closes_1m) < 100: return None
    
    ema50_1m = talib.EMA(closes_1m, timeperiod=50)
    ema100_1m = talib.EMA(closes_1m, timeperiod=100)
    
    # Check crossover on the last completed candle (idx = -2)
    # Crossover happened if:
    # Bullish: Previous (idx-3) EMA50 <= EMA100 AND Current (idx-2) EMA50 > EMA100
    # Bearish: Previous (idx-3) EMA50 >= EMA100 AND Current (idx-2) EMA50 < EMA100
    
    idx_curr = -2
    idx_prev = -3
    
    ema50_curr = ema50_1m[idx_curr]
    ema100_curr = ema100_1m[idx_curr]
    ema50_prev = ema50_1m[idx_prev]
    ema100_prev = ema100_1m[idx_prev]
    
    signal_type = None
    reason = ""
    stop_loss = 0
    take_profit = 0
    entry_price = 0
    
    # Legacy Buffer for SL/TP
    buffer = 2.0 
    current_close = closes_1m[idx_curr]

    # --- BUY SIGNAL ---
    # Global Trend UP + M1 EMA 50 crosses ABOVE M1 EMA 100
    if trend_bullish:
        if (ema50_prev <= ema100_prev) and (ema50_curr > ema100_curr):
            signal_type = "BUY"
            entry_price = current_close
            stop_loss = entry_price - buffer
            risk = entry_price - stop_loss
            take_profit = entry_price + (risk * 1.5)
            reason = "[BTC M1] Global Uptrend + 1m EMA 50/100 Bullish Cross"

    # --- SELL SIGNAL ---
    # Global Trend DOWN + M1 EMA 50 crosses BELOW M1 EMA 100
    elif trend_bearish:
        if (ema50_prev >= ema100_prev) and (ema50_curr < ema100_curr):
            signal_type = "SELL"
            entry_price = current_close
            stop_loss = entry_price + buffer
            risk = stop_loss - entry_price
            take_profit = entry_price - (risk * 1.5)
            reason = "[BTC M1] Global Downtrend + 1m EMA 50/100 Bearish Cross"

    if signal_type:
        return {
            "symbol": symbol,
            "timeframe": "1m",
            "type": signal_type,
            "timestamp": time.time(),
            "price": closes_1m[-1],
            "setup_zones": {
                "entry_zone": { "high": entry_price, "low": entry_price },
                "stop_loss": stop_loss,
                "take_profit": take_profit
            },
            "reason": reason,
            "context_candles": build_context(data_1m)
        }
    return None

# --- GOLD STRATEGY (Sweep & Shift) ---
def analyze_gold_strategy(symbol, data_1m):
    # PRE-REQUISITE: 1. Trend Alignment (H1 + M5 200 EMA)
    data_5m = fetch_candles(symbol, "5m", limit=300)
    data_1h = fetch_candles(symbol, "1h", limit=300)
    
    if not data_5m or not data_1h:
        return None 
        
    ema200_1h = talib.EMA(data_1h["close"], timeperiod=200)
    ema200_5m = talib.EMA(data_5m["close"], timeperiod=200)
    
    price_1h = data_1h["close"][-1]
    price_5m = data_5m["close"][-1]
    
    # Determine Bias
    bias_bullish = (price_1h > ema200_1h[-1]) and (price_5m > ema200_5m[-1])
    bias_bearish = (price_1h < ema200_1h[-1]) and (price_5m < ema200_5m[-1])
    
    if not bias_bullish and not bias_bearish:
        return None

    # PRE-REQUISITE: 3. Risk Management (ATR Calc)
    closes_1m = data_1m["close"]
    highs_1m = data_1m["high"]
    lows_1m = data_1m["low"]
    
    atr_1m = talib.ATR(highs_1m, lows_1m, closes_1m, timeperiod=14)
    current_atr = atr_1m[-2] # Last closed candle ATR
    
    # TRIGGER LOGIC: Sweep & Shift
    # Look back at last 3 candles for the "Sweep" event followed by "Shift"
    
    # Define Recent M5 High/Low for Sweep Targets
    # We look at last 10 5m candles (approx 50 mins)
    m5_highs = data_5m["high"][-15:-1] # Exclude current forming
    m5_lows = data_5m["low"][-15:-1]
    recent_liq_high = np.max(m5_highs)
    recent_liq_low = np.min(m5_lows)
    
    # We examine the last CLOSED 1m candle (idx=-2)
    # Did it sweep? Or did the one before it (idx=-3) sweep?
    # We want a "Shift" (strong move) right now.
    
    idx = -2
    curr_close = closes_1m[idx]
    curr_open = opens_1m[idx]
    curr_high = highs_1m[idx]
    curr_low = lows_1m[idx]
    
    # Body Size for "Displacement" check
    body_size = abs(curr_close - curr_open)
    is_displacement = body_size > (current_atr * 1.0) # Strong body
    
    signal_type = None
    reason = ""
    stop_loss = 0
    take_profit = 0
    entry_price = 0
    
    # --- BUY SETUP (Sweep Low + Bullish Shift) ---
    if bias_bullish:
        # Check if recent candles swept the liquidity low
        # Look at candles -2 or -3
        swept_low = (lows_1m[-2] < recent_liq_low) or (lows_1m[-3] < recent_liq_low)
        
        # Check for Shift: Strong Green Candle closing ABOVE the sweep/range
        # Current candle (idx -2) must be Green and Strong
        is_green = curr_close > curr_open
        
        if swept_low and is_green and is_displacement:
            signal_type = "BUY"
            # Entry: Retest of this candle's body or high (Aggressive)
            entry_price = curr_close 
            
            # SL: 1.5 ATR below the sweep Wick
            sweep_wick = min(lows_1m[-2], lows_1m[-3])
            sl_padding = 1.5 * current_atr
            stop_loss = sweep_wick - sl_padding
            
            risk = entry_price - stop_loss
            take_profit = entry_price + (risk * 2.0) # 2R target
            reason = "[Gold Scalp] Liquidity Sweep (Low) + Bullish Displacement"

    # --- SELL SETUP (Sweep High + Bearish Shift) ---
    elif bias_bearish:
        # Check if recent candles swept high
        swept_high = (highs_1m[-2] > recent_liq_high) or (highs_1m[-3] > recent_liq_high)
        
        # Check for Shift: Strong Red Candle
        is_red = curr_close < curr_open
        
        if swept_high and is_red and is_displacement:
            signal_type = "SELL"
            # Entry on Close
            entry_price = curr_close
            
            # SL: 1.5 ATR above the sweep Wick
            sweep_wick = max(highs_1m[-2], highs_1m[-3])
            sl_padding = 1.5 * current_atr
            stop_loss = sweep_wick + sl_padding
            
            risk = stop_loss - entry_price
            take_profit = entry_price - (risk * 2.0) # 2R target
            reason = "[Gold Scalp] Liquidity Sweep (High) + Bearish Displacement"

    if signal_type:
        return {
            "symbol": symbol,
            "timeframe": "1m",
            "type": signal_type,
            "timestamp": time.time(),
            "price": closes_1m[-1],
            "setup_zones": {
                "entry_zone": { "high": entry_price, "low": entry_price },
                "stop_loss": stop_loss,
                "take_profit": take_profit
            },
            "reason": reason,
            "context_candles": build_context(data_1m)
        }
    return None

def analyze_market_general(symbol, data, timeframe):
    closes = data["close"]
    highs = data["high"]
    lows = data["low"]
    
    upper, middle, lower = talib.BBANDS(closes, timeperiod=20, nbdevup=2, nbdevdn=2, matype=0)
    rsi = talib.RSI(closes, timeperiod=14)
    macd, macd_signal, macd_hist = talib.MACD(closes, fastperiod=12, slowperiod=26, signalperiod=9)
    
    idx = -2 
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

    if (lows[idx] <= current_lower) and (current_rsi < 30 or prev_rsi < 30) and start_pointing_up and macd_bullish_cross:
        signal_type = "BUY"
        reason = f"[{timeframe}] Lower BB Touch + RSI Oversold + MACD Bull Cross"

    elif (highs[idx] >= current_upper) and (current_rsi > 70 or prev_rsi > 70) and start_pointing_down and macd_bearish_cross:
        signal_type = "SELL"
        reason = f"[{timeframe}] Upper BB Touch + RSI Overbought + MACD Bear Cross"

    if signal_type:
        bb_width = current_upper - current_lower
        buffer = bb_width * 0.05
        sl = current_lower - buffer if signal_type == "BUY" else current_upper + buffer
        tp = current_upper if signal_type == "BUY" else current_lower
        
        return {
            "symbol": symbol,
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
            "context_candles": build_context(data)
        }
    return None

def build_context(data):
    return [
        {"time": int(data["time"][i] / 1000), "open": data["open"][i], "high": data["high"][i], "low": data["low"][i], "close": data["close"][i]}
        for i in range(max(0, len(data["time"])-50), len(data["time"]))
    ]

def analyze_market_dispatch(symbol, data, timeframe):
    # Strategy Router
    strategy_name = ASSETS.get(symbol, {}).get("strategy", "market_general")
    
    if timeframe == "1m":
        if strategy_name == "gold_scalp":
            return analyze_gold_strategy(symbol, data)
        elif strategy_name == "btc_standard":
            return analyze_btc_strategy(symbol, data)
        else:
            return analyze_market_general(symbol, data, timeframe)
    else:
        # Default Higher Timeframe Strategy for all
        return analyze_market_general(symbol, data, timeframe)

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
    print(f"Starting AlphaScanner [BTC: Standard | GOLD: Scalp]...")
    last_processed = {} # Key: symbol_timeframe
    
    while True:
        try:
            for symbol in ASSETS.keys():
                for tf in TIMEFRAMES:
                    # Optimization: Only run specific timeframes for specific strategies
                    strategy = ASSETS[symbol]['strategy']
                    
                    if strategy in ['btc_standard', 'gold_scalp'] and tf != '1m':
                        continue
                        
                    data = fetch_candles(symbol, tf)
                    if data:
                        try:
                            signal = analyze_market_dispatch(symbol, data, tf)
                            if signal:
                                key = f"{symbol}_{tf}"
                                last_ts = last_processed.get(key, 0)
                                current_ts = signal['timestamp']
                                
                                # 60s cooldown per symbol/tf
                                if current_ts - last_ts > 60: 
                                    send_signal(signal)
                                    last_processed[key] = current_ts
                        except Exception as loop_err:
                            print(f"   [ERROR] Analysis failed for {symbol} {tf}: {loop_err}")
                        
                        del data
                    time.sleep(0.5)
        except Exception as e:
            print(f"   [CRITICAL] Scanner loop error: {e}")
            time.sleep(5)
            
        import gc
        gc.collect() 
        time.sleep(10) 

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

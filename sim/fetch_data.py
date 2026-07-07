"""Download the simulator's historical datasets into sim/data/ (gitignored).

1. NBA:  FiveThirtyEight Elo dataset (1947-2015, every game appears twice;
   dedupe on _iscopy == 0). Gives actual final margins + an Elo win forecast
   (home advantage included) per game — the forecast is our stand-in for the
   sportsbook consensus spread that anchors stats-mode curves.
2. BTC:  daily closes from the Coinbase Exchange public candles API
   (paginated, 300 candles/request) — used to build crypto-event margin
   (% move) distributions. No API key needed.
"""

import csv
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
NBA_URL = ("https://raw.githubusercontent.com/fivethirtyeight/data/"
           "master/nba-elo/nbaallelo.csv")
CB_URL = ("https://api.exchange.coinbase.com/products/BTC-USD/candles"
          "?granularity=86400&start={start}&end={end}")


def fetch_nba():
    dest = os.path.join(DATA_DIR, "nbaallelo.csv")
    if os.path.exists(dest) and os.path.getsize(dest) > 10_000_000:
        print(f"nba: already present ({os.path.getsize(dest):,} bytes)")
        return
    print("nba: downloading nbaallelo.csv (~18 MB)...")
    urllib.request.urlretrieve(NBA_URL, dest)
    print(f"nba: saved {os.path.getsize(dest):,} bytes")


def fetch_btc(start_year=2016):
    dest = os.path.join(DATA_DIR, "btc_daily.csv")
    if os.path.exists(dest) and os.path.getsize(dest) > 50_000:
        print(f"btc: already present ({os.path.getsize(dest):,} bytes)")
        return
    print("btc: downloading daily candles from Coinbase...")
    rows = {}
    cursor = datetime(start_year, 1, 1, tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    while cursor < now:
        window_end = min(cursor + timedelta(days=300), now)
        url = CB_URL.format(start=cursor.strftime("%Y-%m-%dT00:00:00Z"),
                            end=window_end.strftime("%Y-%m-%dT00:00:00Z"))
        req = urllib.request.Request(url, headers={"User-Agent": "bakunawa-sim"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            candles = json.loads(resp.read())  # [time, low, high, open, close, vol]
        for c in candles:
            day = datetime.fromtimestamp(c[0], tz=timezone.utc).strftime("%Y-%m-%d")
            rows[day] = c[4]
        cursor = window_end
        time.sleep(0.35)  # public rate limit courtesy
    with open(dest, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "close"])
        for day in sorted(rows):
            w.writerow([day, rows[day]])
    print(f"btc: saved {len(rows):,} daily closes")


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    fetch_nba()
    fetch_btc()
    print("done.")

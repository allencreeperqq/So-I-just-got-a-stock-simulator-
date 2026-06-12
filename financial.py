from __future__ import annotations

import json
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

HOST = "0.0.0.0"
PORT = 8000
CACHE_TTL_SECONDS = 60
CACHE_TIMEOUT_SECONDS = 6
CACHE: dict[str, tuple[float, dict]] = {}


def normalize_symbol(symbol: str) -> str:
    raw = symbol.strip().upper()
    if not raw:
        return "AAPL"
    if raw.endswith(".TW"):
        return raw
    if raw.isdigit() and len(raw) in {4, 5}:
        return f"{raw}.TW"
    return raw


def fetch_yahoo_chart(symbol: str, points: int) -> tuple[list[float], float, float, int]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=3mo&interval=1d"
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=CACHE_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read().decode("utf-8"))

    result = payload.get("chart", {}).get("result", [])
    if not result:
        raise ValueError("No data")
    data = result[0]
    quotes = data.get("indicators", {}).get("quote", [])
    if not quotes:
        raise ValueError("No quote data")
    quote = quotes[0]
    closes = [value for value in quote.get("close", []) if value is not None]
    volumes = [value for value in quote.get("volume", []) if value is not None]
    if not closes:
        raise ValueError("No close data")

    series = closes[-points:]
    latest = float(series[-1])
    prev = float(series[-2]) if len(series) > 1 else latest
    latest_volume = int(volumes[-1]) if volumes else 0
    return series, latest, prev, latest_volume


def fetch_yahoo_intraday(symbol: str) -> dict:
    normalized = normalize_symbol(symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{normalized}?range=1d&interval=1m"
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=CACHE_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read().decode("utf-8"))
        
    result = payload.get("chart", {}).get("result", [])
    if not result:
        raise ValueError("No Intraday data")
    data = result[0]
    quotes = data.get("indicators", {}).get("quote", [])
    closes = quotes[0].get("close", []) if quotes else []
    
    # 過濾掉空值
    valid_closes = [c for c in closes if c is not None]
    if not valid_closes:
        raise ValueError("No close data in intraday")
        
    return {
        "symbol": normalized,
        "series": valid_closes,
        "latest": valid_closes[-1]
    }


def fetch_series(symbol: str, points: int) -> dict:
    normalized = normalize_symbol(symbol)
    cache_key = f"{normalized}:{points}"
    now = time.time()
    cached = CACHE.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            series, latest, prev, latest_volume = fetch_yahoo_chart(normalized, points)
            payload = {
                "symbol": normalized,
                "series": series,
                "latest": latest,
                "prev": prev,
                "volume": latest_volume,
                "source": "Yahoo Finance",
                "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            CACHE[cache_key] = (now, payload)
            return payload
        except Exception as exc:
            last_error = exc
            time.sleep(0.6)

    raise ValueError(str(last_error) if last_error else "Unknown error")


class StockHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, BrokenPipeError):
            return

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        
        if parsed.path == "/api/quote":
            symbol = query.get("symbol", ["AAPL"])[0]
            points_raw = query.get("points", ["24"])[0]
            try:
                points = max(4, min(60, int(points_raw)))
            except ValueError:
                points = 24
            try:
                data = fetch_series(symbol, points)
                self._send_json(data)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=502)
            return

        if parsed.path == "/api/intraday":
            symbol = query.get("symbol", ["AAPL"])[0]
            try:
                data = fetch_yahoo_intraday(symbol)
                self._send_json(data)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=502)
            return

        if parsed.path == "/api/health":
            self._send_json({"status": "ok"})
            return

        self.send_response(404)
        self.end_headers()


def run() -> None:
    server = ThreadingHTTPServer((HOST, PORT), StockHandler)
    print(f"Stock API running on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run()
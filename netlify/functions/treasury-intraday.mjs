const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 TheDailyBasis/1.1';
const TIMEOUT_MS = 7000;

function withTimeout(ms = TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

function finiteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeYield(v) {
  const n = finiteNumber(v);
  if (n == null) return null;
  // Yahoo's ^TNX page currently presents the 10Y yield directly (e.g. 5.27 = 5.27%).
  // Retain a defensive conversion in case an upstream representation ever switches to x10.
  return n > 20 ? n / 10 : n;
}

export function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || 'Yahoo Finance returned no ^TNX chart result');

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const points = [];

  for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
    const ts = Number(timestamps[i]);
    const value = normalizeYield(closes[i]);
    if (Number.isFinite(ts) && Number.isFinite(value)) points.push({ ts, value: Number(value.toFixed(4)) });
  }

  if (points.length < 2) throw new Error('Yahoo Finance returned too few usable intraday ^TNX observations');

  const meta = result.meta || {};
  const previousClose = normalizeYield(meta.chartPreviousClose ?? meta.previousClose);
  const regularMarketPrice = normalizeYield(meta.regularMarketPrice);
  const dayHigh = normalizeYield(meta.regularMarketDayHigh);
  const dayLow = normalizeYield(meta.regularMarketDayLow);
  const openFromQuote = Array.isArray(quote.open) ? quote.open.map(normalizeYield).find(Number.isFinite) : null;
  const open = normalizeYield(meta.regularMarketOpen) ?? openFromQuote ?? points[0].value;

  return {
    points,
    meta: {
      symbol: meta.symbol || '^TNX',
      exchangeName: meta.exchangeName || 'Cboe Indices',
      exchangeTimezoneName: meta.exchangeTimezoneName || 'America/Chicago',
      currency: meta.currency || 'USD',
      current: regularMarketPrice ?? points.at(-1).value,
      previousClose,
      open,
      high: dayHigh ?? Math.max(...points.map(p => p.value)),
      low: dayLow ?? Math.min(...points.map(p => p.value)),
      regularMarketTime: Number(meta.regularMarketTime) || points.at(-1).ts,
      dataGranularity: meta.dataGranularity || '5m'
    }
  };
}

export function hourlyCheckpoints(points) {
  if (!Array.isArray(points) || !points.length) return [];
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  });
  const hourKey = ts => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}`;
  };

  const out = [];
  let lastHour = null;
  for (const p of points) {
    const key = hourKey(p.ts);
    if (key !== lastHour) {
      out.push({ ...p, kind: out.length === 0 ? 'open' : 'hour' });
      lastHour = key;
    }
  }
  const latest = points.at(-1);
  if (!out.length || out.at(-1).ts !== latest.ts) out.push({ ...latest, kind: 'current' });
  else out[out.length - 1] = { ...out[out.length - 1], kind: 'current' };
  return out;
}

async function loadYahooTnx() {
  const path = '/v8/finance/chart/%5ETNX?interval=5m&range=1d&includePrePost=false&events=div%2Csplits';
  const urls = [`https://query1.finance.yahoo.com${path}`, `https://query2.finance.yahoo.com${path}`];
  let lastError = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'user-agent': UA,
          'accept': 'application/json,text/plain,*/*',
          'accept-language': 'en-US,en;q=0.9'
        },
        signal: withTimeout(),
        redirect: 'follow'
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} from Yahoo Finance ^TNX`);
      const json = await r.json();
      const parsed = parseYahooChart(json);
      return { ...parsed, hourly: hourlyCheckpoints(parsed.points), url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Yahoo Finance ^TNX intraday feed unavailable');
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS' } });
  }
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  try {
    const data = await loadYahooTnx();
    return new Response(JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'live',
      source: {
        name: 'Yahoo Finance / Cboe ^TNX',
        url: 'https://finance.yahoo.com/quote/%5ETNX/',
        note: 'Latest publicly available ^TNX quote/chart data; may be delayed and is not an institutional tick feed.'
      },
      ...data
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=0, must-revalidate',
        'netlify-cdn-cache-control': 'public, durable, s-maxage=60, stale-while-revalidate=180'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'unavailable',
      error: String(error?.message || error),
      source: {
        name: 'Yahoo Finance / Cboe ^TNX',
        url: 'https://finance.yahoo.com/quote/%5ETNX/'
      }
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=0, must-revalidate',
        'netlify-cdn-cache-control': 'public, durable, s-maxage=30, stale-while-revalidate=60'
      }
    });
  }
};

export const config = {
  path: '/api/treasury-intraday',
  rateLimit: { action:'rate_limit', aggregateBy:['ip'], windowSize:60, windowLimit:180 }
};

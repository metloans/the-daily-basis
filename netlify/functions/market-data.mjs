const UA = 'TheDailyBasis/1.0 (+https://thedailybasis.netlify.app)';
const TIMEOUT_MS = 9000;

const FALLBACK = Object.freeze({
  generatedAt: '2026-09-23T23:00:00Z',
  treasury: {
    date: '2026-09-23', y2: 4.49, y5: 4.97, y10: 5.11, y30: 5.40,
    previous: { date: '2026-09-22', y2: 4.43, y5: 4.81, y10: 4.96, y30: 5.29 }
  },
  pmms: {
    date: 'September 17, 2026', y30: 6.95, y15: 6.26,
    previous: { date: 'September 10, 2026', y30: 6.76, y15: 6.09 }
  },
  mba: {
    date: 'September 23, 2026', weekEnding: 'September 18, 2026',
    composite: -1.5, purchase: -1.0, refi: -3.0, rate30: 7.12, armShare: 9.8,
    url: 'https://www.mba.org/news-and-research/newsroom/news/2026/09/23/mortgage-applications-decrease-in-latest-mba-weekly-survey'
  },
  fred: [
    {date:'2026-09-15',value:5.00},{date:'2026-09-16',value:5.01},{date:'2026-09-17',value:4.94},
    {date:'2026-09-18',value:5.01},{date:'2026-09-21',value:4.96},{date:'2026-09-22',value:4.96},
    {date:'2026-09-23',value:5.11}
  ]
});

function withTimeout(ms = TIMEOUT_MS) {
  return AbortSignal.timeout(ms);
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8') {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': accept },
    signal: withTimeout(),
    redirect: 'follow'
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}

function num(v) {
  const n = Number.parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function xmlValue(block, tag) {
  const re = new RegExp(`<d:${escapeRe(tag)}(?:\\s+[^>]*)?>([^<]+)<\\/d:${escapeRe(tag)}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function parseTreasuryXml(xml) {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const rows = [];
  for (const entry of entries) {
    const rawDate = xmlValue(entry, 'NEW_DATE');
    const date = rawDate?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) continue;
    const row = {
      date,
      y2: num(xmlValue(entry, 'BC_2YEAR')),
      y5: num(xmlValue(entry, 'BC_5YEAR')),
      y10: num(xmlValue(entry, 'BC_10YEAR')),
      y30: num(xmlValue(entry, 'BC_30YEAR'))
    };
    if ([row.y2, row.y5, row.y10, row.y30].every(Number.isFinite)) rows.push(row);
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  if (!rows.length) throw new Error('Treasury XML contained no usable yield rows');
  return rows;
}

async function loadTreasury() {
  const year = new Date().getUTCFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const rows = parseTreasuryXml(await fetchText(url, 'application/xml,text/xml;q=0.9,*/*;q=0.8'));
  const latest = rows.at(-1);
  const previous = rows.at(-2) || null;
  return { ...latest, previous, url };
}

function parseFredCsv(csv) {
  const rows = [];
  const lines = csv.trim().split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(',');
    const value = num(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(value)) rows.push({date, value});
  }
  if (rows.length < 2) throw new Error('FRED returned too few DGS10 observations');
  return rows;
}

async function loadFred() {
  const end = new Date();
  const start = new Date(Date.now() - 200 * 86400000);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${start.toISOString().slice(0,10)}&coed=${end.toISOString().slice(0,10)}`;
  const rows = parseFredCsv(await fetchText(url, 'text/csv,text/plain;q=0.9,*/*;q=0.8'));
  return { rows, url };
}

function stripHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&minus;|&#8722;/gi, '−')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = '(January|February|March|April|May|June|July|August|September|October|November|December)';

function parsePmmsArchive(html) {
  const text = stripHtml(html);
  const re = new RegExp(`(${MONTHS}\\s+\\d{1,2},\\s+\\d{4})[\\s\\S]{0,260}?30[‑–—-]?Yr\\s*FRM\\s*([0-9.]+)%[\\s\\S]{0,260}?15[‑–—-]?Yr\\s*FRM\\s*([0-9.]+)%`, 'gi');
  const rows = [];
  for (const m of text.matchAll(re)) {
    rows.push({date:m[1], y30:num(m[3]), y15:num(m[4])});
    if (rows.length >= 3) break;
  }
  if (!rows.length) {
    // Alternate archive markup sometimes omits the FRM labels from the same text run.
    const dates = [...text.matchAll(new RegExp(`${MONTHS}\\s+\\d{1,2},\\s+\\d{4}`, 'g'))];
    for (const d of dates.slice(0,4)) {
      const chunk = text.slice(d.index, d.index + 520);
      const vals = [...chunk.matchAll(/([0-9]+\.[0-9]+)%/g)].map(x=>num(x[1]));
      if (vals.length >= 4) rows.push({date:d[0], y30:vals[0], y15:vals[2]});
    }
  }
  if (!rows.length || !Number.isFinite(rows[0].y30)) throw new Error('Could not parse Freddie Mac PMMS archive');
  return rows;
}

async function fredSingleSeries(id, days=45) {
  const end = new Date();
  const start = new Date(Date.now() - days * 86400000);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${start.toISOString().slice(0,10)}&coed=${end.toISOString().slice(0,10)}`;
  return parseFredCsv(await fetchText(url, 'text/csv,text/plain;q=0.9,*/*;q=0.8'));
}

async function loadPmms() {
  const url = 'https://www.freddiemac.com/pmms/pmms_archives';
  try {
    const rows = parsePmmsArchive(await fetchText(url));
    return { ...rows[0], previous: rows[1] || null, url, via:'Freddie Mac' };
  } catch (primaryError) {
    const [r30, r15] = await Promise.all([fredSingleSeries('MORTGAGE30US',90), fredSingleSeries('MORTGAGE15US',90)]);
    const latest30 = r30.at(-1), prev30 = r30.at(-2), latest15 = r15.at(-1), prev15 = r15.at(-2);
    if (!latest30 || !latest15) throw primaryError;
    return {
      date: latest30.date, y30: latest30.value, y15: latest15.value,
      previous: prev30 && prev15 ? {date:prev30.date, y30:prev30.value, y15:prev15.value} : null,
      url, via:'FRED mirror of Freddie Mac PMMS'
    };
  }
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

function latestMbaSurveyLink(html) {
  const candidates = [];
  const re = /href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const label = stripHtml(m[2]);
    const href = absoluteUrl(m[1], 'https://www.mba.org');
    if (!href) continue;
    if (/Mortgage Applications (Increase|Decrease) in Latest MBA Weekly Survey/i.test(label) || /mortgage-applications-(increase|decrease)-in-latest-mba-weekly-survey/i.test(href)) {
      candidates.push(href);
    }
  }
  if (!candidates.length) throw new Error('MBA weekly survey link not found');
  candidates.sort().reverse();
  return candidates[0];
}

function signedMove(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const v = num(m[2]);
  if (!Number.isFinite(v)) return null;
  return /decreas/i.test(m[1]) ? -Math.abs(v) : Math.abs(v);
}

function parseMbaArticle(html, url) {
  const text = stripHtml(html);
  const composite = signedMove(text, /Market Composite Index[\s\S]{0,180}?\b(increased|decreased)\s+([0-9.]+)\s+percent/i)
    ?? signedMove(text, /Mortgage applications\s+(increased|decreased)\s+([0-9.]+)\s+percent/i);
  const refi = signedMove(text, /Refinance Index\s+(increased|decreased)\s+([0-9.]+)\s+percent/i);
  const purchase = signedMove(text, /seasonally adjusted Purchase Index\s+(increased|decreased)\s+([0-9.]+)\s+percent/i)
    ?? signedMove(text, /Purchase Index\s+(increased|decreased)\s+([0-9.]+)\s+percent/i);
  const rate30m = text.match(/30-year fixed-rate mortgages with conforming loan balances[\s\S]{0,260}?\b(?:increased|decreased|remained unchanged)[\s\S]{0,100}?\bto\s+([0-9.]+)\s+percent/i)
    || text.match(/30-year fixed-rate mortgages with conforming loan balances[\s\S]{0,300}?([0-9.]+)\s+percent/i);
  const rate30 = rate30m ? num(rate30m[1]) : null;
  const arm = text.match(/ARM share(?: of activity)?\s+(?:increased|decreased)?\s*(?:to\s+)?([0-9.]+)\s+percent/i);
  const armShare = arm ? num(arm[1]) : null;
  const dateMatch = text.match(new RegExp(`${MONTHS}\\s+\\d{1,2},\\s+\\d{4}`));
  const weekMatch = text.match(/week ending\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i);
  if (![composite,purchase,refi,rate30].every(Number.isFinite)) throw new Error('MBA article parsed incompletely');
  return {
    date: dateMatch?.[0] || null,
    weekEnding: weekMatch?.[1] || null,
    composite,purchase,refi,rate30,armShare,url
  };
}

async function loadMba() {
  const listingUrl = 'https://www.mba.org/news-and-research/research-and-economics';
  const listing = await fetchText(listingUrl);
  const articleUrl = latestMbaSurveyLink(listing);
  const article = await fetchText(articleUrl);
  return parseMbaArticle(article, articleUrl);
}

function sourceResult(ok, name, data, url, error, via) {
  return { ok, name, url, via: via || name, asOf: data?.date || data?.rows?.at?.(-1)?.date || null, error: error ? String(error.message || error) : null };
}

function delta(curr, prev) {
  return Number.isFinite(curr) && Number.isFinite(prev) ? Number((curr-prev).toFixed(3)) : null;
}

async function settled(promise, fallback, name, url) {
  try {
    const data = await promise;
    return { data, source: sourceResult(true, name, data, data.url || url, null, data.via) };
  } catch (error) {
    return { data: fallback, source: sourceResult(false, name, fallback, url, error, 'embedded verified fallback') };
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS' } });
  }
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const [treasuryR, fredR, pmmsR, mbaR] = await Promise.all([
    settled(loadTreasury(), FALLBACK.treasury, 'U.S. Treasury', 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml'),
    settled(loadFred(), { rows:FALLBACK.fred }, 'FRED DGS10', 'https://fred.stlouisfed.org/series/DGS10'),
    settled(loadPmms(), FALLBACK.pmms, 'Freddie Mac PMMS', 'https://www.freddiemac.com/pmms'),
    settled(loadMba(), FALLBACK.mba, 'MBA Weekly Applications Survey', FALLBACK.mba.url)
  ]);

  const treasury = treasuryR.data;
  const fredRows = fredR.data.rows || FALLBACK.fred;
  const pmms = pmmsR.data;
  const mba = mbaR.data;
  const prevT = treasury.previous || null;
  const prevP = pmms.previous || null;
  const sources = [treasuryR.source, fredR.source, pmmsR.source, mbaR.source];
  const sourceCount = sources.filter(s=>s.ok).length;

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: sourceCount === 4 ? 'live' : sourceCount > 0 ? 'partial' : 'fallback',
    sourceCount,
    sources,
    treasury: {
      date: treasury.date, y2: treasury.y2, y5: treasury.y5, y10: treasury.y10, y30: treasury.y30,
      previous: prevT,
      changes: prevT ? { y2:delta(treasury.y2,prevT.y2), y5:delta(treasury.y5,prevT.y5), y10:delta(treasury.y10,prevT.y10), y30:delta(treasury.y30,prevT.y30) } : null
    },
    fred: fredRows.slice(-160),
    pmms: {
      date: pmms.date, y30: pmms.y30, y15: pmms.y15, previous: prevP,
      changes: prevP ? { y30:delta(pmms.y30,prevP.y30), y15:delta(pmms.y15,prevP.y15) } : null,
      via: pmms.via || 'Freddie Mac'
    },
    mba: {
      date: mba.date, weekEnding: mba.weekEnding || null, composite:mba.composite, purchase:mba.purchase,
      refi:mba.refi, rate30:mba.rate30, armShare:mba.armShare ?? null, url:mba.url || FALLBACK.mba.url
    }
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, durable, s-maxage=900, stale-while-revalidate=3600',
      'x-tdb-sources': `${sourceCount}/4`
    }
  });
};

export const config = {
  path: '/api/market-data',
  rateLimit: { action:'rate_limit', aggregateBy:['ip'], windowSize:60, windowLimit:120 }
};

function pacificHourAndWeekday(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', hour: '2-digit', hour12: false
  }).formatToParts(date);
  const get = type => parts.find(p=>p.type===type)?.value;
  return { weekday:get('weekday'), hour:Number(get('hour')) };
}

export default async () => {
  const {weekday,hour} = pacificHourAndWeekday();
  const isWeekday = !['Sat','Sun'].includes(weekday);
  const isTargetHour = hour === 6 || hour === 13;
  if (!isWeekday || !isTargetHour) {
    console.log(`TDB warm skipped: ${weekday} ${hour}:00 PT`);
    return;
  }

  const base = process.env.URL;
  if (!base) {
    console.log('TDB warm skipped: Netlify URL environment variable unavailable');
    return;
  }

  const url = new URL('/api/market-data', base).href;
  const r = await fetch(url, { headers:{'accept':'application/json','user-agent':'TheDailyBasis-Warmer/1.0'} });
  const text = await r.text();
  console.log(`TDB warm ${r.status}: ${text.slice(0,220)}`);
};

// Run hourly on weekdays; the function itself selects 6:00 AM and 1:00 PM
// America/Los_Angeles so daylight-saving changes do not shift the refresh.
export const config = { schedule: '0 * * * 1-5' };

// Cloudflare Worker - Airbnb iCal → Airtable Sync
// Cron trigger: runs hourly

const CONFIG = {
  airtableApiKey: 'patqtze3LBbaqajse.26bbdc57ec1faf269485b8bdfbc551d93800fde97c4f71a19917274a48c6b40d',
  airtableBaseId: 'appF9NRbUo6zI17C3',
  occupanciesTableId: 'tblDMHC0vxveumOBJ',
  roomsTableId: 'tblpJ2eCEuknIlCN9',
  airbnbResidentId: 'recHljSCkpw4M0u8R',

  properties: {
    '828 E17th A': 'https://www.airbnb.com/calendar/ical/1496828848806819508.ics?s=d0f66421672186d88b9c7ff660148822',
    '828 E17th B': 'https://www.airbnb.com/calendar/ical/1131058380594477635.ics?s=cad0b4159bdc170ae4878db04b2271b7',
    '828 E17th D': 'https://www.airbnb.com/calendar/ical/1496809241198345517.ics?s=4982c6ee1e41e0d183a747ff8b669d4c',
    '828 E17th E': 'https://www.airbnb.com/calendar/ical/1151164955942117572.ics?s=1fb53a9bcd2fd0f6e1d47b6f95a62d29',
    '830 E17th A': 'https://www.airbnb.com/calendar/ical/1132751850318553764.ics?s=3d9bae2cd4bcd227a6b8e48d6b16636a',
    '830 E17th B': 'https://www.airbnb.com/calendar/ical/1132910986670908766.ics?s=3f050e45936fe9b30a3490b8a9fa8ba9',
    '830 E17th C': 'https://www.airbnb.com/calendar/ical/1212400912929839671.ics?s=7e51667ce03cb810de48f023be47394a',
    '830 E17th E': 'https://www.airbnb.com/calendar/ical/1140849465915557318.ics?s=9610eeb2e04e3927d12f2bc065e141ce',
    '832 E17th A': 'https://www.airbnb.com/calendar/ical/1110153958922381920.ics?s=8b49bba42e52b44b3b18a0cfb677832f',
    '1617 10th A': 'https://www.airbnb.com/calendar/ical/1446753005527132481.ics?t=2b226df7487745a2afd4e27af5814955',
  }
};

// ─── iCal Parser ───────────────────────────────────────────────────────────────

function parseIcal(text) {
  const events = [];
  const lines = text.replace(/\r\n /g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      if (current?.uid && current?.dtstart && current?.dtend) {
        if (current.summary && (
          current.summary.toUpperCase().includes('BLOCKED') ||
          current.summary.toUpperCase().includes('NOT AVAILABLE')
        )) {
          current = null;
          continue;
        }
        console.log(`Parsed event: ${current.uid} | ${current.summary} | ${current.dtstart} → ${current.dtend}`);
        events.push(current);
      }
      current = null;
    } else if (current) {
      if (line.startsWith('UID:')) {
        current.uid = line.substring(4).trim();
      } else if (line.startsWith('DTSTART')) {
        current.dtstart = parseIcalDate(line.split(':')[1]?.trim());
      } else if (line.startsWith('DTEND')) {
        current.dtend = parseIcalDate(line.split(':')[1]?.trim());
      } else if (line.startsWith('SUMMARY:')) {
        current.summary = line.substring(8).trim();
      }
    }
  }

  return events;
}

function parseIcalDate(str) {
  if (!str) return null;
  return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
}

// ─── Airtable Helpers ──────────────────────────────────────────────────────────

async function airtableFetch(path, options = {}) {
  const url = `https://api.airtable.com/v0/${CONFIG.airtableBaseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${CONFIG.airtableApiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable error ${res.status}: ${err}`);
  }
  return res.json();
}

async function getRoomIdByIcalName(icalName) {
  const formula = encodeURIComponent(`{Room} = "${icalName}"`);
  const data = await airtableFetch(`${CONFIG.roomsTableId}?filterByFormula=${formula}&maxRecords=1`);
  return data.records[0]?.id || null;
}

async function getExistingBookings() {
  const formula = encodeURIComponent(`{Booking Reference} != ""`);
  let records = [];
  let offset = null;

  do {
    const params = `filterByFormula=${formula}${offset ? `&offset=${offset}` : ''}`;
    const data = await airtableFetch(`${CONFIG.occupanciesTableId}?${params}&fields%5B%5D=Booking%20Reference&fields%5B%5D=Start%20Date&fields%5B%5D=End%20Date`);
    records = records.concat(data.records);
    offset = data.offset || null;
  } while (offset);

  const map = {};
  for (const r of records) {
    const uid = r.fields['Booking Reference'];
    if (uid) map[uid] = r;
  }
  return map;
}

async function createOccupancy(roomId, uid, startDate, endDate) {
  return airtableFetch(CONFIG.occupanciesTableId, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'Resident': [CONFIG.airbnbResidentId],
        'Room ID': [roomId],
        'Booking Reference': uid,
        'Start Date': startDate,
        'End Date': endDate,
      }
    })
  });
}

async function updateOccupancy(recordId, startDate, endDate) {
  return airtableFetch(`${CONFIG.occupanciesTableId}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'Start Date': startDate,
        'End Date': endDate,
      }
    })
  });
}

async function deleteOccupancy(recordId) {
  return airtableFetch(`${CONFIG.occupanciesTableId}/${recordId}`, {
    method: 'DELETE'
  });
}

// ─── Room ID Cache ─────────────────────────────────────────────────────────────

const roomIdCache = {};

async function getRoomId(icalName) {
  if (!roomIdCache[icalName]) {
    roomIdCache[icalName] = await getRoomIdByIcalName(icalName);
  }
  return roomIdCache[icalName];
}

// ─── Main Sync Logic ───────────────────────────────────────────────────────────

async function sync() {
  console.log('Starting Airbnb iCal sync...');

  const existingBookings = await getExistingBookings();
  console.log(`Found ${Object.keys(existingBookings).length} existing Airbnb occupancies in Airtable`);

  const liveUids = new Set();

  for (const [propertyName, icalUrl] of Object.entries(CONFIG.properties)) {
    console.log(`Processing ${propertyName}...`);

    let icalText;
    try {
      const res = await fetch(icalUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      icalText = await res.text();
    } catch (e) {
      console.error(`Failed to fetch iCal for ${propertyName}: ${e.message}`);
      continue;
    }

    const events = parseIcal(icalText);
    console.log(`  ${events.length} bookings found`);

    const roomId = await getRoomId(propertyName);
    if (!roomId) {
      console.error(`  No room found for iCal name "${propertyName}" — skipping`);
      continue;
    }

    for (const event of events) {
      liveUids.add(event.uid);
      const existing = existingBookings[event.uid];

      if (!existing) {
        await createOccupancy(roomId, event.uid, event.dtstart, event.dtend);
        console.log(`  Created: ${event.uid} (${event.dtstart} → ${event.dtend})`);
      } else {
        const existingStart = existing.fields['Start Date'];
        const existingEnd = existing.fields['End Date'];
        if (existingStart !== event.dtstart || existingEnd !== event.dtend) {
          await updateOccupancy(existing.id, event.dtstart, event.dtend);
          console.log(`  Updated: ${event.uid} (${existingStart}→${event.dtstart}, ${existingEnd}→${event.dtend})`);
        } else {
          console.log(`  Unchanged: ${event.uid}`);
        }
      }
    }
  }

  for (const [uid, record] of Object.entries(existingBookings)) {
    if (!liveUids.has(uid)) {
      await deleteOccupancy(record.id);
      console.log(`Deleted cancelled booking: ${uid}`);
    }
  }

  console.log('Sync complete.');
}

// ─── Worker Entry Point ────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    CONFIG.airtableApiKey = env.AIRTABLE_API_KEY;
    CONFIG.airtableBaseId = env.AIRTABLE_BASE_ID;
    CONFIG.occupanciesTableId = env.OCCUPANCIES_TABLE_ID;
    CONFIG.roomsTableId = env.ROOMS_TABLE_ID;
    ctx.waitUntil(sync());
  },

async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }
    CONFIG.airtableApiKey = env.AIRTABLE_API_KEY;
    CONFIG.airtableBaseId = env.AIRTABLE_BASE_ID;
    CONFIG.occupanciesTableId = env.OCCUPANCIES_TABLE_ID;
    CONFIG.roomsTableId = env.ROOMS_TABLE_ID;
    await sync();
    return new Response('Sync complete', { status: 200 });
  }
};
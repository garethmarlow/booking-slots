/**
 * Booking Slots — lightweight Calendly/youcanbook.me-style booking system.
 *
 * How it works:
 *  - You mark out availability by creating a calendar event whose TITLE
 *    exactly matches a type's `blockTitle` below, and setting that event's
 *    Free/Busy status to FREE (Google Calendar: "Show me as: Free"). Make
 *    it recurring if you want standing availability (e.g. every Tuesday).
 *  - Anyone with the booking link for a type sees that block sliced into
 *    slots of the configured length, minus anything already Busy inside it.
 *  - Booking a slot creates a real (Busy) calendar event and sends the
 *    visitor an invite — with a Google Meet link for "call" types, or the
 *    fixed location for "f2f" types.
 *
 * To add or change a booking type: edit CONFIG.types below and redeploy
 * (Deploy > Manage deployments > Edit > New version). No other code needs
 * to change.
 */

// ---- Configuration: edit this to add/change booking types ----
const CONFIG = {
  calendarId: 'primary',           // 'primary' = your main eqsystems.io calendar
  organiserTimeZone: 'Europe/London',
  weeksAhead: 8,                   // how far out to offer slots
  hostName: 'Gareth Marlow',       // shown on the page and in invite titles
  types: {
    'call': {
      label: 'Google Meet call',
      blockTitle: '1hr call',      // must exactly match the FREE availability block's title
      durationMinutes: 60,
      kind: 'call',                // 'call' -> Google Meet link added automatically
    },
    'coffee-bradfield': {
      label: 'In-person meeting (Bradfield Centre)',
      blockTitle: 'F2F coffee (Bradfield Centre)',
      durationMinutes: 60,
      kind: 'f2f',                 // 'f2f' -> fixed location added, no Meet link
      locationName: 'Bradfield Centre',
      location: '184 Cambridge Science Park Rd, Milton, Cambridge CB4 0GA',
    },
    'coffee-westhub': {
      label: 'In-person meeting (West Hub)',
      blockTitle: 'F2F coffee (West Hub)',
      durationMinutes: 60,
      kind: 'f2f',
      locationName: 'West Hub',
      location: 'West Hub, JJ Thomson Ave, Cambridge CB3 0US',
    },
  },
  // A group merges several types onto one booking page: visitors see every
  // member type's slots together (each tagged with its own location) instead
  // of picking a location first. Member types stay individually bookable at
  // their own ?type= link too.
  groups: {
    'coffee': {
      label: 'In-person meeting',
      types: ['coffee-bradfield', 'coffee-westhub'],
    },
  },
};

// ============================================================
// Web app entry point
// ============================================================

function doGet(e) {
  const typeKey = e.parameter.type || '';
  const type = CONFIG.types[typeKey] || null;
  const groupDef = CONFIG.groups[typeKey] || null;
  const group = groupDef
    ? { key: typeKey, label: groupDef.label, memberTypes: groupDef.types.map(function (k) { return CONFIG.types[k]; }) }
    : null;

  // Types that belong to a group are booked via the group's merged page
  // instead, so leave them off the "pick a type" index.
  const groupedTypeKeys = {};
  Object.keys(CONFIG.groups).forEach(function (gk) {
    CONFIG.groups[gk].types.forEach(function (tk) { groupedTypeKeys[tk] = true; });
  });
  const indexItems = Object.keys(CONFIG.types)
    .filter(function (tk) { return !groupedTypeKeys[tk]; })
    .map(function (tk) { return { key: tk, label: CONFIG.types[tk].label }; })
    .concat(Object.keys(CONFIG.groups).map(function (gk) { return { key: gk, label: CONFIG.groups[gk].label }; }));

  // Page heading + one-line description, derived from the type/group.
  const durationMinutes = type ? type.durationMinutes : (group ? group.memberTypes[0].durationMinutes : 0);
  const isCall = type ? type.kind === 'call' : false;
  const pageTitle = type ? (isCall ? 'Google Meet call' : 'In-person meeting') : (group ? group.label : '');
  const pageDescription = isCall
    ? durationMinutes + ' minute Google Meet calls with ' + CONFIG.hostName
    : durationMinutes + ' minute, face-to-face meetings with ' + CONFIG.hostName;

  const template = HtmlService.createTemplateFromFile('Index');
  template.hostName = CONFIG.hostName;
  template.pageTitle = pageTitle;
  template.pageDescription = pageDescription;
  template.typeKey = typeKey;
  template.type = type;
  template.group = group;
  template.indexItems = indexItems;
  // Absolute /exec URL for this deployment. Used for the index page's links
  // instead of a relative href — Google rewrites the visible address bar to
  // an internal content-frame URL after load, so a relative link would
  // resolve against THAT address and silently break. This always points
  // back to the real entry point.
  template.baseUrl = ScriptApp.getService().getUrl();

  return template.evaluate()
    .setTitle(pageTitle || 'Book a time')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// Availability
// ============================================================

/**
 * Returns available slots for a booking type as
 * [{ startIso, endIso }, ...], sorted earliest first.
 */
function getAvailableSlots(typeKey) {
  const type = CONFIG.types[typeKey];
  if (!type) throw new Error('Unknown booking type: ' + typeKey);

  const cal = CalendarApp.getCalendarById(CONFIG.calendarId);
  const now = new Date();
  const windowStart = now;
  const windowEnd = new Date(now.getTime() + CONFIG.weeksAhead * 7 * 24 * 60 * 60 * 1000);

  // Bookings close at midnight the previous day: the earliest bookable
  // calendar day is tomorrow, in the organiser's timezone.
  const todayStr = Utilities.formatDate(now, CONFIG.organiserTimeZone, 'yyyy-MM-dd');
  const minDate = new Date(todayStr + 'T00:00:00');
  minDate.setDate(minDate.getDate() + 1);

  const events = cal.getEvents(windowStart, windowEnd);

  // Availability blocks: exact title match, marked Free.
  const blocks = events.filter(function (ev) {
    return ev.getTitle() === type.blockTitle &&
      ev.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT;
  });

  // Busy events (anything not explicitly Free) — used to exclude
  // already-booked time from inside a block.
  const busy = events
    .filter(function (ev) {
      return ev.getTransparency() !== CalendarApp.EventTransparency.TRANSPARENT;
    })
    .map(function (ev) {
      return { start: ev.getStartTime(), end: ev.getEndTime() };
    });

  const durationMs = type.durationMinutes * 60 * 1000;
  const slots = [];

  blocks.forEach(function (block) {
    let slotStart = new Date(block.getStartTime().getTime());
    const blockEnd = block.getEndTime();

    while (slotStart.getTime() + durationMs <= blockEnd.getTime()) {
      const slotEnd = new Date(slotStart.getTime() + durationMs);

      const overlapsBusy = busy.some(function (b) {
        return slotStart < b.end && slotEnd > b.start;
      });
      const inWindow = slotStart >= minDate && slotEnd <= windowEnd;

      if (!overlapsBusy && inWindow) {
        slots.push({
          startIso: slotStart.toISOString(),
          endIso: slotEnd.toISOString(),
          locationName: type.locationName || '',
          location: type.location || '',
        });
      }

      slotStart = new Date(slotStart.getTime() + durationMs);
    }
  });

  slots.sort(function (a, b) { return a.startIso.localeCompare(b.startIso); });
  return slots;
}

/**
 * Same as getAvailableSlots, but merges every member type of a group into
 * one sorted list, tagging each slot with the type it belongs to so the
 * client can label it (e.g. by location) and book it correctly.
 */
function getAvailableSlotsForGroup(groupKey) {
  const group = CONFIG.groups[groupKey];
  if (!group) throw new Error('Unknown booking group: ' + groupKey);

  const slots = [];
  group.types.forEach(function (typeKey) {
    const type = CONFIG.types[typeKey];
    getAvailableSlots(typeKey).forEach(function (s) {
      slots.push({
        startIso: s.startIso,
        endIso: s.endIso,
        locationName: s.locationName,
        location: s.location,
        typeKey: typeKey,
      });
    });
  });

  slots.sort(function (a, b) { return a.startIso.localeCompare(b.startIso); });
  return slots;
}

// ============================================================
// Booking
// ============================================================

/**
 * Called by the client when a visitor confirms a slot. Re-checks the slot
 * is still free (under a script lock) before creating the event, so two
 * people can't book the same slot in a race.
 */
function bookSlot(typeKey, startIso, endIso, name, email) {
  const type = CONFIG.types[typeKey];
  if (!type) throw new Error('Unknown booking type: ' + typeKey);
  name = (name || '').trim();
  email = (email || '').trim();
  if (!name || !email) throw new Error('Name and email are required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address doesn\'t look right');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const cal = CalendarApp.getCalendarById(CONFIG.calendarId);
    const start = new Date(startIso);
    const end = new Date(endIso);

    // Re-check: nothing Busy already sitting on this exact window.
    const clash = cal.getEvents(start, end).some(function (ev) {
      return ev.getTransparency() !== CalendarApp.EventTransparency.TRANSPARENT;
    });
    if (clash) {
      return { ok: false, message: 'Sorry — that slot was just taken. Please go back and pick another.' };
    }

    const summary = name + ' : ' + CONFIG.hostName + ' ' + (type.kind === 'call' ? 'call' : 'meeting');

    if (type.kind === 'call') {
      createCallEvent_(start, end, summary, email);
      return {
        ok: true,
        message: 'Booked. A calendar invite with the Google Meet link is on its way to ' + email + '.',
      };
    } else {
      cal.createEvent(summary, start, end, {
        location: type.location,
        guests: email,
        sendInvite: true,
      });
      return {
        ok: true,
        message: 'Booked. A calendar invite for ' + type.location + ' is on its way to ' + email + '.',
      };
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates the event via the Calendar Advanced Service (not the simpler
 * CalendarApp) because only the API supports requesting a Google Meet
 * link through conferenceData. Requires the "Calendar" advanced service
 * to be enabled (see appsscript.json / Services panel).
 */
function createCallEvent_(start, end, summary, email) {
  const resource = {
    summary: summary,
    start: { dateTime: start.toISOString(), timeZone: CONFIG.organiserTimeZone },
    end: { dateTime: end.toISOString(), timeZone: CONFIG.organiserTimeZone },
    attendees: [{ email: email }],
    conferenceData: {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  return Calendar.Events.insert(resource, CONFIG.calendarId, {
    conferenceDataVersion: 1,
    sendUpdates: 'all',
  });
}
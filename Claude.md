# Booking Slots

A minimal Calendly/youcanbook.me replacement, built as a single Google Apps
Script project (no server, no database, no subscription). Runs entirely on
Google's infrastructure under Gareth's eqsystems.io Workspace account.

## What it does

Visitors get a link per booking type (`?type=call`, or `?type=coffee` for the
merged in-person page; the individual `coffee-bradfield` / `coffee-westhub`
types still work at their own links). With no `type`, an index page offers the
choice. Pages show the eqsystems.io logo, a title ("Google Meet call" /
"In-person meeting"), a description naming the host, and available slots in the
visitor's local timezone. In-person slots are grouped by location, with the
location named once above each set of buttons. Picking a slot and submitting
name + email creates a real Google Calendar event and sends the visitor an
invite — a Google Meet link for "call" types, the address in the location
field for "f2f" types. Invite titles are `<name> : <hostName> call|meeting`.
After booking, the modal's Close button returns to the booking page and
refreshes the slots.

## How availability works (the core mechanism)

There's no admin UI and no separate availability config. Availability is
read directly off Gareth's calendar:

1. He creates a calendar event whose **title exactly matches** a type's
   `blockTitle` in `CONFIG.types` (see `Code.js`), and sets it to
   **Free** (not Busy). Recurring events work fine (e.g. "1hr call" every
   Tuesday 9am–12pm).
2. `getAvailableSlots()` finds those Free-marked blocks, slices each one
   into slots of the type's `durationMinutes`, and drops anything that
   overlaps a Busy event already on the calendar.
3. Slots on/after "today" (in `organiserTimeZone`) are excluded — bookings
   close at midnight the day before. The window extends `weeksAhead` (8)
   weeks out.
4. On booking, `bookSlot()` re-checks the exact slot is still free under a
   `LockService` lock (prevents two visitors racing for the same slot),
   then creates the event. Calendar Advanced Service (`Calendar.Events.insert`)
   is used instead of `CalendarApp` for "call" types only, because it's the
   only way to request a Google Meet link via `conferenceData`.

No logging, no booking history, no cancel/reschedule links — deliberately
out of scope. Cancelling/moving a booking is just editing the calendar
event directly, the normal way.

## Files

- `Code.js` — `CONFIG` (edit this to add/change booking types, and `hostName`),
  the availability scan, and the booking logic. (Named `Code.gs` in the Apps
  Script editor; clasp uses `.js` locally.)
- `Index.html` — the booking page. Server-rendered via GAS scriptlets
  (`<? ?>` / `<?= ?>`), then a plain-JS client script fetches slots via
  `google.script.run` and handles the pick-a-slot / confirm flow. The logo is
  embedded as a base64 PNG `<img>` at the top of the page (no external hosting).
- `appsscript.json` — manifest. Declares the Calendar Advanced Service and
  sets web app access to "Anyone" (`ANYONE_ANONYMOUS`) so visitors don't
  need a Google login.

## Adding or changing a booking type

Edit the `types` object in `CONFIG` (top of `Code.js`). Each entry needs:
`label` (used on the index page), `blockTitle` (must exactly match the calendar
event title used for availability), `durationMinutes`, `kind` (`'call'` or
`'f2f'`), and for f2f: `locationName` (short name shown above the slot buttons)
and `location` (full address, put in the event's location field). To merge
several types onto one page, list them in `CONFIG.groups`. Page titles and
descriptions are derived from `kind`, duration and `hostName` in `doGet()`.
No other code changes needed. After editing, push
and redeploy — see below.

## Deploying

This is a live web app, not something with a staging environment. After any
change:

1. `clasp push` (or paste into the Apps Script editor). If it fails with
   `invalid_rapt`, run `clasp login` again (Workspace forces periodic reauth).
2. Redeploy to the *existing* deployment — either in the editor (**Deploy →
   Manage deployments → pencil icon → Version: New version → Deploy**) or via
   `clasp deployments` then `clasp deploy -i <versioned deployment id> -d "note"`
   (not the `@HEAD` one). This keeps the same `/exec` URL — a *new* deployment
   would issue a different URL and break links already handed out.

## Known gotcha: don't use the address-bar URL

After loading `.../exec?type=call`, Google rewrites the visible address bar
to an internal content-frame URL
(`https://<id>-script.googleusercontent.com/userCodeAppPanel?type=call`).
That URL only works as the *result* of a proper `/exec` load — hitting it
directly (bookmarking it, reloading it, or a relative link resolving
against it) renders a blank page with no visible error. This bit us once
already: the index page's "pick a type" links now use an **absolute**
`/exec` URL (`ScriptApp.getService().getUrl()`, passed into the template as
`baseUrl`), specifically to avoid resolving relative hrefs against the
rewritten address. Keep any future links the same way — always build off
`ScriptApp.getService().getUrl()`, never a relative href or the address
bar's current URL.

## Workspace consideration

eqsystems.io is a Google Workspace domain. Deploying with "Anyone" access
(required for external visitors to book without signing in) depends on the
Workspace's Apps Script sharing settings allowing it — check this if a
deployment silently only offers "Anyone within eqsystems.io".

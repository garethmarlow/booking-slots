# Booking Slots

A minimal Calendly/youcanbook.me replacement, built as a single Google Apps
Script project (no server, no database, no subscription). Runs entirely on
Google's infrastructure under Gareth's eqsystems.io Workspace account.

## What it does

Visitors get a link per booking type (`?type=call`, `?type=coffee-bradfield`,
`?type=coffee-westhub`). The page shows available slots in the visitor's
local timezone; picking one and submitting name + email creates a real
Google Calendar event and sends the visitor an invite — a Google Meet link
for "call" types, a fixed location for "f2f" types.

## How availability works (the core mechanism)

There's no admin UI and no separate availability config. Availability is
read directly off Gareth's calendar:

1. He creates a calendar event whose **title exactly matches** a type's
   `blockTitle` in `CONFIG.types` (see `Code.gs`), and sets it to
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

- `Code.gs` — `CONFIG` (edit this to add/change booking types), the
  availability scan, and the booking logic.
- `Index.html` — the booking page. Server-rendered via GAS scriptlets
  (`<? ?>` / `<?= ?>`), then a plain-JS client script fetches slots via
  `google.script.run` and handles the pick-a-slot / confirm flow.
- `appsscript.json` — manifest. Declares the Calendar Advanced Service and
  sets web app access to "Anyone" (`ANYONE_ANONYMOUS`) so visitors don't
  need a Google login.

## Adding or changing a booking type

Edit the `types` object in `CONFIG` (top of `Code.gs`). Each entry needs:
`label`, `blockTitle` (must exactly match the calendar event title used for
availability), `durationMinutes`, `kind` (`'call'` or `'f2f'`), and
`location` (f2f only). No other code changes needed. After editing, push
and redeploy — see below.

## Deploying

This is a live web app, not something with a staging environment. After any
change:

1. `clasp push` (or paste into the Apps Script editor).
2. In the Apps Script editor: **Deploy → Manage deployments → pencil icon
   → Version: New version → Deploy**. This keeps the same `/exec` URL — a
   *new* deployment would issue a different URL and break links already
   handed out.

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

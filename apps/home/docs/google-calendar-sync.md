# WilmAI Home: Google Calendar sync (plan)

Planned 22 October 2026. The groundwork without Google is built (below); the
Google part isn't started.

The Calendar view already decides what belongs in the family calendar. This
feature writes those events to a calendar of the app's own in the user's Google
account and keeps it up to date, straight from the user's computer, with no
WilmAI server.

## Decided earlier (8 October 2026)

- Google first, through the Calendar API. Outlook (Microsoft Graph) later.
- The app makes **its own calendar** and asks only for
  `calendar.app.created`: it can't see or change any other calendar.
- Desktop OAuth with PKCE. The browser opens Google's consent page and the
  answer comes back to the app.
- Which kinds sync is the existing setting in the Calendar view's "To the
  family calendar" card. Sure events sync by themselves, and suggestions sync
  once they're added.
- Titles are the calendar's own: "First: title", siblings "A, B: title", a
  holiday for every child bare, and markers in parentheses.
- An event the app wrote is removed when its source goes away, with no
  duplicates.

## Decided 22 October 2026

- The calendar groundwork first, in the app, with nothing about Google; Google
  is a later, separate step.
- An event deleted in the outside calendar counts as Dismiss: the app doesn't
  put it back.
- An event's description is its short detail and where it's from, never the
  school's whole message.

## What's there already

- `CalEvent` and `calendarEvents()` in `src/data/calendar.ts`.
  `goesToCalendar()` says what syncs (the kind is on and the event is sure or
  added), and `calendarTitle()` writes the title.
- `local.calendar.decisions` (added or dismissed) and `local.calendar.kinds` in
  `src/data/model.ts`. The settings card says "Google Calendar comes next".
- The background sync runs every 10 minutes, even with the window closed
  (`wilmai:tick` from `shell.rs`).

## Groundwork (done 22 October 2026, uncommitted)

- `src/data/calendar.ts`: an exam without a Wilma id is keyed by its day and
  subject; one source's events that would share a key are all told apart by
  their titles; the same event from two places keeps the key of the first one
  the school said and is sure if either is; the parent's word counts on any of
  an event's keys (`aliases`, `calendarDecision`). This also fixed two bugs in
  today's Calendar view: dismissing an event two messages mention didn't stick,
  and adding one could be lost when the other source came first.
- `src/data/calendar-sync.ts`: `syncEntry` (an event as a calendar service
  takes it), `wantedEntries` (what goes there, for every child, in the window),
  and `reconcile` (what to add, change, remove, and dismiss), with no service
  behind it yet.
- `evals/calendar-sync.test.ts`, in `test:ai`.

Still to do before Google: call `wantedEntries` from the engine after a Wilma
sync and the reading, with `complete` from that sync.

## What had to change first

1. **Stable event keys.** The key is what ties a Google event to its source.
   Today:
   - Read events use `itemKey:date@start`, so a re-read that moves the date
     changes the key.
   - Their `+` suffix depends on the order the events were read.
   - Exams fall back to id `0` when Wilma gives none.
   - A merged twin keeps whichever key it saw first.

   Make the keys come from the source, not the date:
   - read events: item and index within the reading;
   - exams without an id: child, date and subject;
   - merging in a fixed order.

   A changed key only means delete and create, which is safe, but it shouldn't
   happen on every sync.
2. **Compute the calendar in the engine.** Today `calendarEvents()` only runs in
   the views' `useMemo`. The sync needs it after `runLuna()` too, for every child
   and a fixed window, not the visible month.
3. **Only delete on complete data.** If reading a source failed, or Wilma
   signed out mid-sync, skip deletions for that sync. Missing data must never
   look like cancelled events.

A test: build the events from the same snapshot twice, with the inputs shuffled,
and check that the keys come out the same. Add it to `test:ai` with the other
calendar tests.

## How the sync works

One pure function decides, and a thin layer runs the result against Google:

```
reconcile(wanted: CalEvent[], inGoogle: GoogleEvent[], window) -> ops[]
```

- **Wanted:** `calendarEvents()` for every child, from 14 days back to 180 days
  ahead, filtered with `goesToCalendar()`.
- **In Google:** the app's calendar, listed with the private extended property
  `wilmai=1`. The key and a hash of the content travel in the event's private
  extended properties, so the app finds its own events even after a reinstall.
  It doesn't need a ledger of its own.
- **Event ids** come from the key (base32hex of a hash; Google accepts
  client-chosen ids). A retried insert therefore can't make a duplicate; it
  gets a 409, and the app patches instead.
- **Ops:**
  - insert what's new;
  - patch only when the hash changed, so an edit the user made in Google
    survives until the school's version changes;
  - delete what's no longer wanted, inside the window only. Older events stay
    as history.
- **An event the user deleted in Google** comes back from Google marked
  cancelled. Treat that as Dismiss (`decisions[key] = "no"`), so the app doesn't
  put it back.
- **Turning a kind off** deletes those events. Disconnecting asks whether to
  delete the whole calendar too.
- **Times:** timed events in `Europe/Helsinki`, the rest all-day; `endDate` is
  exclusive in Google. No reminders by default; the user can set them on the
  calendar in Google.
- **Description:** the event's short detail and "From Wilma, via WilmAI Home".
  Not the teacher's whole message.
- The sync runs after each Wilma sync and calls Google only when there's
  something to change.

## Rust side

The webview can't reach Google (CSP), and every network command is pinned to
one host. Two new commands:

- `google_connect`:
  1. Starts a one-shot listener on `127.0.0.1` at a random port.
  2. Opens Google's consent page with PKCE (S256) and a `state` value through
     the opener plugin.
  3. Takes the code and exchanges it at `https://oauth2.googleapis.com/token`.
  4. Shows a small "You can close this tab" page.
- `google_call`: calls only `https://www.googleapis.com/calendar/v3/…` and
  refreshes the access token itself.

The refresh token stays on the Rust side, in a file in the app's data folder
(owner-only, scrambled like the other secrets). The webview never sees it.
Disconnecting revokes it at Google.

Google's Desktop clients have a client secret that Google itself says isn't
secret for installed apps. The release build gets the client id and secret the
way it gets the updater key, from config at build time, so they aren't in git.
A build from source without them hides Google sync and says to bring your own
OAuth client.

## In the app

The "To the family calendar" card keeps its kind checkboxes and gains:

- **Connect Google Calendar.** After the browser step it shows the account and
  the calendar's name ("WilmAI: school").
- The last sync and the number of events, and any error, in the same pattern as
  the Updates card.
- **Share with the other parent**, which opens the calendar's settings page in
  Google Calendar. Sharing happens there, because the narrow scope can't share.
  If both parents connect, they get two calendars, so one connects and shares.
- **Disconnect.**

The rest stays as it is: suggestions are added or dismissed in the Calendar
view, as now.

## Google Cloud and verification (Antti's steps)

- **A project with the Calendar API.** Set up the OAuth consent screen
  (External):
  - name "WilmAI Home", logo and support email;
  - home page `https://wilm.ai/en/home`;
  - privacy policy on wilm.ai;
  - authorized domain `wilm.ai`.

  Then a **Desktop** OAuth client and the scope `calendar.app.created`. Check
  that the console calls it sensitive. The Calendar scopes are sensitive, not
  restricted, so there's no security assessment.
- **Testing status:** only listed test users can connect, and their refresh
  tokens expire after 7 days. That's fine for building, not for the beta.
- **Production, unverified:** a "Google hasn't verified this app" screen and a
  cap on how many accounts can connect.
- **Verification**, which typically takes 3–5 business days, needs:
  - wilm.ai verified in Search Console (a DNS TXT record on Cloudflare);
  - a privacy policy on wilm.ai, linked from the home page;
  - an unlisted YouTube video of the consent flow and of how the scope is used;
  - a justification of why a narrower scope doesn't exist (it doesn't:
    `calendar.app.created` is the narrowest that can write).
- **A privacy page on wilm.ai:**
  - the app runs on the user's computer;
  - school data goes from Wilma to the user's own Google calendar, nowhere
    else;
  - the AI choices;
  - the site's request counts;
  - Google's Limited Use statement.

  wilm.ai has no privacy page yet.

## Order

1. The groundwork: stable keys, the sync's plan, the tests (done), and the
   calendar in the engine. No Google.
2. The privacy page on wilm.ai (drafted) and wilm.ai verified in Search Console.
3. The Google side when Antti decides: the Cloud project, the Rust commands and
   the connect flow, against a test calendar in Testing status.
4. Reconcile and the card, with unit tests on `reconcile()` and a real run on
   the test calendar over a few days of real syncs.
5. Release 0.2.0 when Google has verified the app (or as unverified for the
   beta).

Outlook later: Microsoft Graph has no "only calendars this app made" scope, so
it would need `Calendars.ReadWrite`, which is broader.

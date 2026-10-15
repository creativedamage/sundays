<img src="docs/brand/sundays-icon.png" alt="Sundays" width="128" align="right">

# Sundays

A dark-mode Mac app for church production and volunteer teams, built on Planning Center: People
workflows, Services scheduling, run sheets, check-ins, a production clock, a wireless mic board and
more, in one place.

**[⬇ Download the latest version](https://github.com/creativedamage/sundays/releases/latest)** · [All releases](https://github.com/creativedamage/sundays/releases) ·
[What's new](CHANGELOG.md)

On the release page, download **Sundays-<version>.dmg**, open it and drag Sundays to
Applications. After that, Sundays updates itself (Sundays → Check for Updates).

**Was Cool Services.** Sundays is the new name (1.24). Updating from Cool Services keeps everything:
the app becomes **Sundays.app** in Applications, and your sign-in, settings and notes
move to `~/Library/Application Support/Sundays` by themselves.

![A service in Sundays: tuning keys, mics and packs, and the roster](docs/screenshots/service.png)

## A quick tour

<table>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard"><br><b>Dashboard</b>: the clock and countdown, Planning Center Live, tuning keys, SPL from Smaart, ProPresenter and your wireless mics on one screen.</td>
<td width="50%"><img src="docs/screenshots/workflows.png" alt="Workflows board"><br><b>Workflows</b>: your People workflows as a drag-and-drop board with contact details, notes, email and one-click scheduling.</td>
</tr>
<tr>
<td><img src="docs/screenshots/matrix.png" alt="Matrix"><br><b>Matrix</b>: several weeks of a service type side by side. Drag people between weeks, see open slots and who's pending.</td>
<td><img src="docs/screenshots/run-sheet.png" alt="Run sheet"><br><b>Run sheet</b>: clock times, lengths and every team's notes in columns, following Planning Center Live. Edit anything in place.</td>
</tr>
<tr>
<td><img src="docs/screenshots/checkins.png" alt="Check-ins"><br><b>Check-ins</b>: who's checked in for a service, by room, refreshing every few seconds.</td>
<td><img src="docs/screenshots/team-checkins.png" alt="Team check-ins"><br><b>Team check-ins</b> (on the website): a card per team (8/10 in), grouped by ministry, with staff check-in and printable reports.</td>
</tr>
<tr>
<td><img src="docs/screenshots/modes.png" alt="Full Mode, Service Mode, FOH Companion"><br><b>Modes</b>: Full Mode, Service Mode for a shared computer (PIN to leave it), or FOH Companion.</td>
<td><img src="docs/screenshots/clock.png" alt="Production clock"><br><b>Production clock</b>: countdowns, until-service and Live item timers, saved timers on a schedule, messages.</td>
</tr>
<tr>
<td><img src="docs/screenshots/clock-output.png" alt="Clock output"><br><b>Clock output</b>: the same clock as an NDI source, on the network or on a second display.</td>
<td><img src="docs/screenshots/micboard-display.png" alt="Mic board display"><br><b>Mic board</b>: every wireless mic with who's on it, their picture and battery, around your logo and the clock, on any screen in the building.</td>
</tr>
<tr>
<td><img src="docs/screenshots/micboard.png" alt="Mic board control"><br><b>Stage display control</b>: the board's logo, clock, stage plot, backgrounds and each mic's color and line.</td>
<td><img src="docs/screenshots/phone-staff.png" alt="Team check-ins on a phone" width="45%"><br><b>On phones</b>: team check-ins at <code>sundays-checkin.vercel.app</code>, signed in with Planning Center.</td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshots/preferences.png" alt="Preferences" width="60%"><br><b>Preferences</b>: appearance, startup, campuses, Team Check-ins, audio (Allen &amp; Heath, Waves, Smaart), network connections (iPads, companions) and video (clock outputs, ProPresenter).</td>
</tr>
</table>

Screenshots use the built-in sample data (Sign in → "Or explore with sample data").

## Everything it does

- **Workflows board**: the People workflows assigned or shared to you as a drag-and-drop Kanban board. Each card shows the
  person's photo, email and phone, card and profile notes, staff-only notes, and email sent through
  Planning Center. The **Schedule in Services** button schedules them in one click.
- **Services**: every upcoming plan on one screen. The plan view puts the roster, open slots and
  run sheet side by side. You can fill a slot in one click with conflict checks, and confirm,
  decline, replace or remove people from the row.
- **Matrix**: several weeks of a service type side by side (4–12 weeks, optionally the last two):
  every team and position, who's on it with their status, open slots, and each week's songs and
  keys. Hover a name to see all the weeks that person serves. Open it from "Matrix" in the sidebar.
- **Full run sheet** (the "Run sheet" tab on a service): clock times for the chosen service time,
  lengths, descriptions and Planning Center notes as columns.
  - **Views** for each operator (Lighting, Video, Stage manager…): pick which note categories show,
    their order, one to highlight, and which plan notes appear at the top.
  - **Edit** (E): everything on the sheet becomes editable in place. Click a title, length,
    description or note and type; it saves to Planning Center when you leave the field (Enter on
    one-line fields, Esc to undo). Add headers, items, media and songs from the Planning Center song
    catalog, move and delete items. A song's arrangement and key are still in its item window (the
    pencil).
  - **Planning Center Live**: follows the current item (time used / left), and Previous / Next /
    Take control drive Live from here.
  - **Compare**: actual times against another service time (the 9:00 while you run the 11:00) or
    another campus's service the same day, per item and "how far later/earlier at this item".
  - **Watch**: other services' Live position and over/under in a side panel.
  - Full screen, text size and print. Keys: F, + / −, L, E, P.
- **Dashboard**: widgets for service flow: tuning keys (sends to Waves), SPL from Smaart, Shure wireless (who's on it, battery, RF),
  Planning Center Live, a clock with the countdown to service, and ProPresenter control. Edit to
  add, remove, resize and reorder; the layout is saved on this Mac.
- **ProPresenter**: watch and take over any ProPresenter computer (e.g. side screens): click a slide
  to show it, previous / next, clear layers, clear groups and looks, timers (start, stop, reset,
  change the time, ±30 s / 1 min), stage message and each stage screen's layout. Add computers in
  Preferences → Video; the Kids & Nursery one from paging is included automatically.
- **Chat**: Planning Center Chat inside Sundays (sidebar → Chat): current conversations, new
  ones, teams and direct messages. Planning Center has no public Chat API, so this is Planning
  Center's own Chat shown in the app window, using your Planning Center sign-in.
- **Message the team**: on any service, text or email one person, a team, or everyone (by status).
  It opens a message in Messages on this Mac addressed with their mobile numbers from Planning
  Center, like Planning Center's mobile app does (there's no API for sending texts).
- **Production clock** (sidebar → Clock): follows **ProPresenter's timers** (the running one as the
  main timer, a second one as the aux timer; Start, Pause and ± run ProPresenter's own timer), and
  any saved timer takes over with a click. A broadcast-style clock (title bar, second timer,
  Information box, big main timer) with countdowns, count up, count to a time, time of day, **until
  service** (from Planning Center service times) and **Live item** (time left on the current Planning
  Center Live item). Saved **timers** start with a click, a number key, a schedule, or when the one
  before ends. Outputs: **NDI®**, the church network (any browser), a second display, and Stream Deck
  / Companion links.
- **Mic board & stage display** (sidebar → Mic board): a photo card for every wireless mic, half
  down each side, with who's on it (from Planning Center), a battery read from its Shure receiver, and
  your own backgrounds (synced to every Mac you sign in on). In the middle: your logo over the time of
  day or the production clock's countdown, and your stage plot. It follows the service you last
  worked on. Open it on any other computer or TV at `http://<this Mac>/display`.
- **Tuning**: every song's key, big, across the top of each service in service order ("Song 1 · A",
  "Song 2 · Db"). With Waves SuperRack connected in Settings, pressing a key recalls that key's
  SuperRack snapshot over MIDI.
- **Mics & packs**: under each service's info, assign vocal mics and packs to the people
  serving (one person can have a vocal mic and a pack). **Auto-assign** matches by position and
  puts people back on the mic they had last time. With Shure receivers on the network, each tile
  shows live battery, runtime, antennas and signal. The connection is read-only: nothing on the
  receivers or in Wireless Workbench is ever changed.
- **Team check-ins** live on the website, **sundays-checkin.vercel.app** (since 1.43; no longer in
  the Mac app): a card per team (8/10 in) grouped by ministry, check people in by hand, any service
  date, and a printable report by ministry. Everyone signs in with Planning Center. See
  [Team check-ins](#team-check-ins).
- **Check-ins**: a Check-ins tab on every service shows who's checked in (Planning Center
  Check-Ins) for that service, grouped by room, with regulars, guests, volunteers and check-outs.
  It refreshes every 10 seconds and highlights new arrivals.
- **Resi** (Preferences → Video → Resi): shows when your Resi stream is live: a **Resi live** badge
  on Services (with how long it's been live) and a **Resi** widget on the Dashboard (each encoder,
  where it's going, how long). Read-only. See [Resi](#resi).
- **Modes** (after signing in, or Preferences → Default Startup → This computer): **Full Mode**
  (everything), **Service Mode** for a shared computer (Services, ProPresenter, Clock, Mic board and
  Parent paging only, no Workflows or Check-Ins; a PIN to leave it or open Preferences), or **FOH
  Companion**. See [Modes](#modes).
- **Parent paging (ProPresenter)**: show a child's security code on the auditorium screens as a
  ProPresenter message: from **Parent paging** in the sidebar, the Page button on any service's
  Check-ins tab, or the Kids and Nursery iPads. While a page is on screen (15 seconds by default),
  paging is locked for everyone so one page never replaces another.
- **Kids & Nursery iPad pages**: a separate page for each ministry, locked with its own PIN, that
  iPads open in Safari on the church Wi-Fi. It shows that ministry's checked-in children; tap a
  child, then **Page the Auditorium**.
- **Settings** (⚙ next to your name): dark, light or follow the Mac; your own logo; and which
  screen opens first (a workflow, the services list, the next service, or its check-ins).
- **Sign in with Planning Center**: people click it, log in on Planning Center's own page, and
  they're set up. Nothing else to enter.

## Build the DMG (on your Mac)

You need Node.js 22.12 or newer (`node -v` to check). Get it from https://nodejs.org (LTS).
Nothing is compiled during `npm install` (NDI was removed in 1.13, which is what used to make it slow).

```bash
npm install
npm run dist:mac
```

The installers land in **`desktop/release/`**, one per app. They run on both Apple Silicon and
Intel Macs.

To try the app without making a DMG: `npm run app` (or `SUNDAYS_APP=ops npm run app` for one of
the other apps).

### The Sundays apps

One project builds three Mac apps (the list is in `shared/apps.ts`):

| App | What's in it | Files |
|---|---|---|
| **Sundays** | Everything that runs on the Mac: services, run sheets, check-ins, ProPresenter, Clock, Mic board, Workflows, Chat, Parent paging, and FOH Companion mode | `Sundays-<version>.dmg` |
| **Sundays Operations** | Operations (and the Sundays admin console) | `Sundays-Operations-…` |
| **Sundays AVL** | AVL | `Sundays-AVL-…` |

- **FOH companion** is a mode in Sundays (Preferences → Mode → FOH Companion): link it to the main
  computer once.
- **Operations and AVL** are the website's screens in a Mac window. They sign in with your Sundays
  account, not Planning Center. Links between the apps open the right one (or the website).
- Each app updates itself. A release has every app in it.
- **Sundays Services, Workflows, Paging and FOH were retired in 1.33.** Their last version (1.33.0)
  only says they're now part of Sundays and opens Sundays at the same screen; it can move itself to
  the Trash. A Mac that only ran Sundays FOH carries on as the FOH companion in Sundays, still linked.

`SUNDAYS_APPS=sundays,ops npm run dist:mac` builds only those apps (quicker while testing).

### Updating

Sundays updates itself from this project's GitHub Releases: **Sundays → Check for
Updates…** in the menu bar, or **Preferences → About**. It also checks on its own a few seconds after
opening and every six hours, and shows "Update to x.y.z" at the bottom of the sidebar when there's
one. **Update now** downloads it, checks it against the release's checksums, closes Sundays,
replaces the app in Applications and opens the new version. Sign-ins, settings and notes
stay as they are (they live in `~/Library/Application Support/Sundays`).

The app must be running from the Applications folder (not from the DMG) to update itself.
Versions before 1.7.0 don’t have the updater: install the first GitHub release from its DMG once.

### Installing on a Mac

1. Open the DMG and drag **Sundays** into **Applications**.
2. **First open only:** double-click Sundays. macOS says it can't verify the app. Open
   **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to Cool
   Services, and confirm. macOS asks this once, because the app isn't signed with a paid Apple
   Developer ID (see below).
3. Click **Sign in with Planning Center**.

Each Mac keeps its own sign-in and staff-only notes in `~/Library/Application Support/Sundays`.
The key that protects saved sign-ins is in that folder too (`key.txt`, readable only by your Mac
account). Sundays doesn't use the macOS Keychain, so updates never ask for your password.

### Skipping the "Open Anyway" step (optional)

With an Apple Developer account ($99/year), sign and notarize the app so it opens normally on any Mac:

1. In `desktop/package.json`, change `"identity": "-"` to your certificate name, e.g.
   `"Developer ID Application: Your Name (TEAMID)"`, and add `"notarize": true` under `"mac"`.
2. Build with your Apple ID details set:
   `APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run dist:mac`

## Parent paging and the Kids & Nursery iPads

1. In ProPresenter (7.9 or newer): **Settings → Network → Enable Network**. Note the port.
2. In Sundays: **Preferences → Network Connections → ProPresenter** → **Find automatically** (or type the computer's IP
   and port) → the status turns green. Set **Page stays on screen for** to match your ProPresenter
   message time (15 seconds by default).
3. **Parent paging**, for Nursery and for Kids:
   - *Sundays message*: Sundays creates and keeps a message called "Sundays ·
     Nursery" in ProPresenter with your text (`{code}` is replaced by the tag code) and the **theme**
     you choose. Or *My existing message*: pick a message you already use and the token the code goes in.
   - Tick that ministry's **Check-Ins rooms**, and set its **iPad PIN** (4–8 digits).
   - **Send a test page** puts "TEST" on the screens.
4. **Kids & Nursery iPads** → turn on. Each ministry gets its own address, e.g.
   `http://192.168.1.30:47130/nursery` and `/kids`, with a QR code. On the iPad, open it in Safari,
   enter that ministry's PIN, then Share → Add to Home Screen. Guided Access keeps it on the page.

Notes:
- Only the security code goes to the screens. Children's names stay on the iPad.
- The Mac running Sundays must be on, awake and on the same network during services. The first
  time, macOS asks to allow incoming connections for Sundays: choose **Allow**.
- The iPad pages read Check-Ins with the Planning Center access of whoever last saved these settings.
- The iPad server only serves the iPad page and its own small API. Staff screens, notes, people and
  plans can't be reached from the network. A wrong PIN 5 times locks that iPad out for a minute (doubling).
- Changing a PIN signs out that ministry's iPads.

## Matrix

Services → a service type → **Matrix**: several weeks side by side.

- **Drag** someone onto another position or week to move them there (hold **⌥ Option** to copy
  instead). **Send requests** (top) decides whether Planning Center sends a scheduling request.
- **Hover** someone for **Profile**, **Target** (keeps them highlighted everywhere until you clear it),
  **Change…** (someone else in that spot, or them in another position) and **Remove**.
- **Click** someone for their profile: emails, phones, address, what they're scheduled for, blockouts,
  and **Send an email**. Planning Center's API only sends email to people in a workflow (it goes from
  you and is logged on their card); for anyone else **Open in Mail** starts it addressed to them.

## Campuses

Preferences → **Campuses**: add campuses, choose the campus each service type belongs to, and set **My
default campus**. Sundays opens on your default campus; the switcher at the top of the sidebar
shows another campus (or all) for now. The Services list, the sidebar and Schedule in Services
follow it (Schedule has an "All campuses" link). Campuses are kept on this Mac; the default is per person.

## Resi

Preferences → **Video → Resi**: paste an API **Client ID** and **Client Secret** from Resi Studio
(your account's API settings; ask Resi support to turn on API access if you don't see them) and
press **Connect**. Sundays checks Resi every 10 seconds through its public API
(`api.resi.io`): your encoders and their live schedules, with each destination's state (Web/Embed,
YouTube, Facebook, RTMP: setting up, starting, started, stopped, error). An encoder is **live**
while any of its destinations is starting or started.

- **Services**: a red **Resi live 12:34** badge next to the service's name (and on the Services
  overview) while you're streaming; amber **Resi starting** while it's getting going.
- **Dashboard → Add widget → Resi live stream**: how long you've been live and since when, each
  encoder (live, starting, setting up, error, off air) with the title and every destination's state,
  when you were last live, and a link to Resi Studio.
- Choose which encoders to watch (all of them by default). Sundays never starts or stops a
  stream. The Client Secret is saved encrypted on this Mac.

<img src="docs/screenshots/resi.png" alt="Resi on the Dashboard" width="70%">

## Modes

The first time someone signs in on a computer, Sundays asks how it will be used:

- **Full Mode**: everything.
- **Service Mode**: for a shared computer (the booth, a volunteer laptop). The sidebar has only
  **Services, ProPresenter, Clock, Mic board** and **Parent paging**. Workflows, Check-Ins (Team
  check-ins and each service's Check-ins tab), the Dashboard and Chat are closed, in the app and on
  its server. Choosing Service Mode asks for a **PIN** (4 to 8 numbers). The PIN is needed to
  **switch back to Full Mode** (sidebar → Service Mode → Switch to Full Mode…) or to **open
  Preferences**; entering it unlocks everything for 15 minutes (or **Lock now**). Five wrong PINs
  wait a minute. Change the PIN in Preferences → Default Startup → This computer.
- **FOH Companion**: the front-of-house computer (page requests, the mic strip and the Tuning
  strip); see [FOH companion](#foh-companion-a-second-computer-at-front-of-house).

Change the mode any time in Preferences → Default Startup → **This computer → Change mode…**, or
from the sign-in screen ("Setting up a shared or front-of-house computer?").

## Preferences

**Sundays → Preferences…** (⌘,) opens Preferences in their own window (the ⚙ next to your
name does too):

- **About**: version, and Check for Updates.
- **Appearance**: dark / light / system, and your logo.
- **Default Startup**: what opens first: the Dashboard, Services, the next service, its run sheet or
  check-ins (for "your service" from the Dashboard, or a chosen type), a workflow, ProPresenter or
  Parent paging (Service Mode opens Services unless it's one of its own pages); and **This
  computer**: Full Mode, Service Mode (and its PIN) or FOH Companion.
- **Campuses**: group service types by campus, and your default campus.
- **Audio**: Allen & Heath console, Waves SuperRack, Smaart.
- **Network Connections**: ProPresenter for paging, Kids & Nursery paging and the iPad pages.
- **Video**: ProPresenter computers.

## Allen & Heath dLive / Avantis channel names

Put the names from a service's Mics tab on the console's channels.

1. **Preferences → Audio → Allen & Heath console**: turn it on, choose dLive (MixRack or Surface) or
   Avantis, and enter its IP address. The port fills in (dLive MixRack / Avantis 51325, dLive Surface
   51328). **MIDI ch.** is the console's base MIDI channel (dLive: Utility → Control → MIDI, usually
   1; Avantis: usually 12). **Test connection** reads input 1's name.
2. **Set up mics** (⚙ on a service's Mics panel): tick **Console** on each mic and enter its input.
   For a double patch (e.g. a second input for in-ears), enter the second input too; both get the
   same name. Campuses without a double patch just leave it empty.
3. On a service, **Names to dLive** shows what will be written and sends it: first names (with a last
   initial when two people share one), at most 8 characters; mics nobody is on get their own label
   back ("Vox 3"). Only channel names change on the console.

## Waves SuperRack (Tuning keys)

Preferences → **Audio → Waves SuperRack**: turn it on, choose the MIDI output and channel, and enter each key's
snapshot **External ID** as SuperRack shows it (0139 → 139). Pressing a key on a service's Tuning bar
sends Bank LSB (CC 32) + Program Change. SuperRack's External IDs run 125 to a bank (1,000 over 8
banks), so ID 139 is Bank 1 / Program 14. ("Numbers are → Program numbers" switches to plain
1-based numbering, 128 to a bank, for other setups.)

- SuperRack on the same Mac: Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver → tick
  **Device is online**, then choose "IAC Driver Bus 1".
- SuperRack on another Mac: Audio MIDI Setup → MIDI Studio → Network. Create and connect a session on
  both Macs (rtpMIDI on Windows) and choose it in Sundays. On the SuperRack Mac, if SuperRack
  doesn't react to a "Network MIDI 2.0" session, route the session into IAC Driver Bus 1 (Live
  Routings, incoming only; routing both ways makes a MIDI loop) and have SuperRack listen to Bus 1.
- In SuperRack: Controllers → MIDI Controller → gear → tick that port under MIDI IN, set **Follow
  Program Changes on Channel** to your channel, and give each snapshot an External ID.

Keys come from Planning Center (the key chosen on the service item, otherwise the arrangement's key).
The keys with their own snapshot are C, Db, D, Eb, E, F, F#, Gb, G, Ab, A, Bb and B. A song in C#, D#,
G# or A# uses the flat's snapshot (C# → Db), and a minor key uses its letter's (F#m → F#).

**Chromatic Tune** and **Tuning Off** buttons sit before the songs on the Tuning bar and the
dashboard; give each a snapshot in Preferences → Audio. Song items that aren't songs (e.g. "Vocal Warm
Ups") can be left off the Tuning bar under "Leave off the Tuning bar".

## Dashboard and Smaart

- **Your service**: at the top of the dashboard, pick your campus (service type). The clock, Live,
  tuning and wireless widgets, and the Live widget's Run sheet link, follow that campus's next plan.
  Pick a plan in the second list to pin it; "Next one (automatic)" moves on by itself. A widget can
  still be set to another service type in its options.
- **Smaart v9 SPL**: in Smaart, start logging on a calibrated input and turn on Options → API
  (default port 26000, optional password). In Sundays, Preferences → Audio → Smaart (SPL): enter the
  computer and password, then Save and connect. Sundays lists Smaart's measurements (e.g. RTA
  MIC, REF) and streams each one. SPL values Smaart sends are used as they are; otherwise the overall
  level is worked out from the measurement's spectrum (marked ≈, accurate only if the input is
  calibrated). Pick a reading for the SPL widget in its options. Rational Acoustics hasn't published
  the full data format, so if readings don't appear, open "What Smaart is sending" in Settings, press
  Copy and send it to us.

## Page requests (you decide when pages go up)

With **Hold iPad pages until I send them** on (Preferences → Network Connections → ProPresenter,
on by default), the Kids and Nursery iPads **request** a page instead of putting it straight on the
screens. A bar across the top of every Sundays screen shows each request (ministry, code,
child, how long ago) with **Send now** and **Cancel**, plus **Send all** when there are several.
Sent pages go up as soon as nothing else is on screen, one after another. The iPads show each
request as "Waiting for the auditorium", "On the screens" or "Not sent". Pages started in Cool
Services itself go straight up. Requests are kept while Sundays is open.

## FOH companion (a second computer at front of house)

A second Mac can run Sundays as an **FOH companion**: a full-screen panel that only handles
Kids and Nursery page requests.

1. On the main Sundays Mac: Preferences → Network Connections → **FOH companions** → **Pair a
   companion**. A 6-digit code appears (good for 10 minutes).
2. On the FOH Mac: install Sundays and choose **FOH companion** when it asks how this computer
   is used (or "Use it as an FOH companion" on the sign-in screen, or Preferences → Default Startup).
   It finds the main Mac on the network; pick it (or enter its address) and type the code.

When a Kids or Nursery iPad asks for a page, the companion takes over its screen with the ministry
and tag code and three big buttons: **Accept** (goes up as soon as the screens are free), **Hold
until clear** (keeps it waiting without taking over the screen) and **Deny**. The companion never
shows a child's name. The main Mac keeps its banner and can accept or cancel requests too; it never
takes over its own screen. Unpair a companion from the same Preferences section.

**Mic strip.** Between page requests the companion steps aside and shows a short bar along the
bottom of the screen (above the Dock, always on top) with every wireless mic: the mic name, who's on
it, a status color (orange low battery, red change it or RF trouble, striped when the transmitter is
off or the receiver can't be reached), battery, audio and RF. Only that bar is a window, so
everything above it (Waves SuperRack, the console app) stays clickable. When a page request comes in
the companion takes the full screen; once it's answered, the strip comes back. Hover the strip and
press the gear (or click Sundays in the Dock) to open the companion window: turn the strip on
or off, make it short, medium or tall, and pick which display it's on (click it in the picture of
your displays, arranged as macOS has them; hover the strip and press its display button to move it to the next display).
The mics, hidden mics and stacked mics follow the main computer's Mic board → Display settings.

**Tuning strip.** Right above the mics: the main computer's Tuning row for the service its Mic
board follows: **Chromatic**, **Off**, then each song's key in service order. Press one and the
**main computer** sends it to Waves SuperRack (the same MIDI its own Tuning bar sends), so the
companion never sends MIDI and nothing changes on it. The strip is a non-activating panel: pressing
a key doesn't take the focus from the app you're working in. The key you pressed lights up (also
when it's pressed on the main computer's Tuning bar). Needs Waves set up on the main computer
(Preferences → Audio) and Sundays open there. Turn it off in the companion window
("Tuning strip above the mics").

<img src="docs/screenshots/companion-strip.png" alt="FOH companion mic strip">

## Workflows: yours, and asking for others

The Workflows page shows **My workflows**: the ones with cards assigned to you or shared with you
by name in Planning Center. Other workflows are locked with **Request access**. A request shows up
for that workflow's managers (and People managers / site administrators) under **Access requests**
on the Workflows page and as a notification; **Approve** as Viewer, Editor or Manager shares the
workflow with that person in Planning Center, and it appears under their My workflows.

- Managers can also share directly: the **Share** button on a board (or the share icon on its tile).
  This is Planning Center's own workflow sharing, so it applies everywhere.
- Requests are kept on the Mac where they were made. If the manager uses Sundays on a
  different computer, the requester can send a quick email from the request window and the manager
  adds them with Share.
- People managers and site administrators still see every workflow, under "Other workflows".
- New cards on your workflows pop up as a notification (with Open), checked every minute.

## Mic board & stage display

Sidebar → **Mic board**. The big preview is exactly what the display shows. Everything below is in
**Display settings** on that page.

### The mic board

- **Cards:** one per mic, filled down the left side first and then the right, in Mic setup order.
  Each card has the mic's name in its color across the top (pick the color per mic), a line of your
  own under it ("Worship leader"), the battery at the top right, the picture, and who's on it
  (first or full names, from the service's Mics panel).
- **One card per person:** someone on more than one mic (a vocal and their acoustic's pack) gets one
  card labeled "VOX 1 + AG PACK"; its battery is the card's own mic (Vox 1).
- **Battery:** an icon with the percentage, read from the Shure receiver (read-only, see Mic setup
  below): the percentage for rechargeable packs, else the bars (0–5) as a percentage. A low battery
  turns yellow; one to change now flashes red and edges the card in red. "OFF" means
  the transmitter is off. Mics that aren't on the network show who has them, without a battery.
- **The middle:** your logo (Add logo; a PNG with a see-through background looks best) over the
  clock: **Time of day** (seconds and the date are optional) or **Production clock**, which shows just
  the production clock's main timer and, under it, the name of the timer you loaded.
- **Stage plot:** add a PDF (pick the page if it has several) or a picture under **Stage plot**. It
  fills the middle under the clock, cropped to the drawing; **Show it dark** turns a white page dark.
  It's turned into a picture on the Mac you add it on and syncs to your other Macs.
- **Logo schedule:** add more logos and star the default. **Schedule** opens a month calendar: click
  a day to put a logo on it once or repeating (every day, chosen weekdays, monthly, yearly), all day
  or between two times, until a date or for good. A logo with times wins over an all-day one; then the
  one added last. Nothing scheduled: the default.
- **Backgrounds:** your backgrounds folder. Add pictures once and every Mac you sign in on has them
  (they sync with your other settings). A background named like a person ("Eddie", "Eddie Smith")
  shows behind them automatically; or pick one for a mic (whoever's on it) or for a person (on any
  mic). Otherwise the card shows their Planning Center photo. Backgrounds you'd added to Micboard
  before 1.40 come into the library by themselves, under the same names.

### The stage display

- **Which service**: the one you last worked on. Open a service under Services, or change its mics in
  its Mics panel, and the board switches to it within a couple of seconds (the page's header says
  which service it's showing). Until you've worked on one, it shows the picked weekend's next service.
- The display is always the mic board; the clock is on it (Display settings → Middle of the board).
- **Mics on the board** (Display settings): show or hide each mic (on the board and the FOH companion's
  strip), and add mics that aren't on the network.

**On another computer (the display endpoint).** Sundays runs on your main Mac; the display
computer only needs a browser. On the Mic board page, **Show it on another computer → Turn on the
network display**, then open the address it shows (like `http://192.168.1.20/display`) on the
other computer and press **F** for full screen (no address bar or tabs; F or Esc again to leave). It shows exactly the preview and
follows every change you make. Both computers
must be on the same network; give the main Mac a fixed IP (a DHCP reservation) so the address doesn't
change, and set the network port to 80 (Preferences → Network Connections → Kids & Nursery iPads)
to drop the `:port`. A second display plugged into the main Mac works too (Display settings → Where it
shows).

## Production clock

Sidebar → **Clock**. The preview at the top is exactly what every output shows:

- **Title bar** ("MASTER TIME", set in Preferences → Video → Clock outputs), a **second timer** on
  the left (or the time of day), the **Information** box on the right (a big yellow title and an
  orange subtitle, like "ALPHA (Session 1)"), and the **main timer** below. The main timer's color
  is yours (red by default); it turns yellow and then red near the end (set per timer), and pulses
  once it's past zero.
- **Clocks**: Countdown, Count up, Count to a time (e.g. 9:00 AM), Time of day, **Until service**
  (the next service time in Planning Center, for one service type or any), and **Live item** (the
  current Planning Center Live item's name and time left).
- **Message**: shows over the main timer (bottom, top, or covering it), with quick buttons.
- **Timers** (saved presets): main and second timer, Information text, color, message, yellow/red
  points, "start when loaded", what to start when it reaches zero (Walk-in → Service →
  Announcements…), and **Start automatically** on chosen days at a time (e.g. Sundays 8:50).
  Start one by clicking it or pressing 1–9. Keys: Space start/pause, R reset, ← → previous/next, B
  blank. **Previous / next** loop from the last timer back to the first.
- The Dashboard has a **Production clock** widget.

**Outputs** (Preferences → Video → Clock outputs):

- **NDI®**: a source named "<this Mac> (Sundays Clock)" at 1920×1080 or 1280×720, 25–60 fps,
  optionally with a **transparent background** to key it over video. Add it in ProPresenter, vMix,
  OBS, a TriCaster or an NDI monitor.
- **On the church network**: `http://<this Mac>/clock` (or with the iPad port) full screen in any
  browser: TVs, a stage iPad, a confidence monitor.
- **Second display** on this Mac: full screen on the display you choose.
- **Stream Deck / Bitfocus Companion**: copy the links (Generic HTTP → GET): start, pause, toggle,
  reset, next, previous, ±1 minute, start a timer by number or name, message, information, blank.

**How NDI is built.** NDI is sent by calling NDI's own library with koffi, which ships ready-built
for Apple Silicon and Intel, so nothing is compiled on your Mac (the add-on that broke in 1.9–1.12
needed compiling). `npm run dist:mac` downloads NDI's official Mac SDK installer once (kept in
`~/Library/Caches/sundays-build`), takes `libndi.dylib` out of it and puts it in the app. If it
can't, the build stops and tells you why. To use a copy you already have:
`COOL_NDI_LIB="/Library/NDI SDK for Apple/lib/macOS/libndi.dylib" npm run dist:mac`. To build without
NDI: `COOL_SKIP_NDI=1 npm run dist:mac`. NDI® is a registered trademark of Vizrt NDI AB.

## Team check-ins

Team check-ins are on the website, **sundays-checkin.vercel.app** (add it to a phone's home screen).
Each person signs in with their own Planning Center account; Operations → Settings → Users gives them
None, View, Check in or Manage.

- **Who's in**: a card per team with how many of the people scheduled have checked in (8/10),
  grouped under ministries. Two or three cards across on a laptop or iPad, one per row on phones.
  Tap a card for who's in and who isn't, and **Check in** anyone by hand (on every service that day
  they're on).
- **Any date**: last week's services are in the list (so Sunday's is still there on Monday), and the
  calendar button jumps to any date.
- **Report**: the printer button prints a report grouped by ministry: totals per ministry and team,
  then who checked in (when, and by whom) and who didn't. This service or the whole day; everyone,
  only who's missing, or totals only.
- **Settings** (Manage): each service type's Check-Ins **event** and each team's **area**, and the
  **ministries**. A Mac running Sundays 1.43 or newer brings its old ministries over by itself
  (merged: nothing set on the website is changed).
- Old phone addresses (`/leads`, `/staff`, `staff.…`, `leads.…`) on the church network now go to the
  website. Kids check-ins by room stay on each service's Check-ins tab in the Mac app, for paging.

## Friendly iPad addresses (kids.yourchurch.org)

Preferences → Network Connections → Kids & Nursery iPads → **Friendly addresses**: enter e.g.
`kids.libertychurch.net` and `nursery.libertychurch.net`. Then:

1. Give the Sundays Mac a fixed IP (a DHCP reservation in the router/firewall).
2. Add a DNS **A record** for each name pointing at that IP: in the router/firewall's local DNS, or
   in the domain's public DNS (it only resolves to something useful on the church network, since the
   IP is private).
3. Set the iPad **Port** to **80** so nobody has to type a port.
4. On the iPads open `http://kids.libertychurch.net` (with `http://`), enter the PIN once, and add it
   to the Home Screen again.

Any address starting with `kids.` or `nursery.` goes to that page, even before the names are
entered in Preferences.

## Check-ins permission

Check-ins need Planning Center **Check-Ins** access. Someone who signed in before Check-Ins was
added is asked to sign in again once (and comes back to the same page). If Planning Center still
says no after that, their Planning Center account doesn't have Check-Ins permission: the Check-ins
tab says so (with Planning Center's own message) instead of asking to sign in again. An
administrator can give access in Planning Center People → the person → Permissions → Check-Ins.
With a shared personal access token, that token's account needs Check-Ins access.

## If something feels slow

Planning Center requests that take longer than a second are noted in
`~/Library/Application Support/Sundays/cool-services.log` (only the request path and timing,
no personal data). Send that file along when reporting slowness.

## GitHub and releases

Your project folder (`~/Downloads/cool-services`) is a git repository with the full history. Updates
from Claude land there as new commits; you publish them to GitHub with one command.

### One-time setup

1. On github.com, create a new **public** repository named `sundays`. Don't add a README,
   license or .gitignore: leave it empty. (Public, so every Sundays can check it for updates
   without a password.)
2. Let git sign in to GitHub once. The easiest way is the GitHub CLI:

   ```bash
   brew install gh
   gh auth login        # GitHub.com → HTTPS → Login with a web browser
   ```

3. In Terminal, in the project folder:

   ```bash
   cd ~/Downloads/cool-services
   npm run set-repo -- YOUR-GITHUB-NAME/sundays
   git add -A && git commit -m "Point updates at GitHub"
   git remote add origin https://github.com/YOUR-GITHUB-NAME/sundays.git
   git push -u origin main
   ```

4. Optional but recommended: `bash scripts/make-signing-cert.sh`, then add the two values it prints
   as repository secrets (Settings → Secrets and variables → Actions): `MAC_CERT_P12` and
   `MAC_CERT_PASSWORD`. Releases are then signed with the church's own certificate instead of ad hoc.
   (Not needed to stop password prompts: since 1.20.0 the app doesn't use the Keychain.) Keep the
   `.p12` file out of the repository (it's in `.gitignore`).

### Publishing a version

Each version has a section in [CHANGELOG.md](CHANGELOG.md): a one-line summary under the version
heading, then what changed. Updates from Claude add it for you. Then:

```bash
npm run release
```

This releases the version the project is at (e.g. 1.18.3): it makes a release commit named
**"Sundays 1.18.3 — <summary>"**, tags `v1.18.3` and pushes both. The GitHub Actions run and the
release get that name, and the release notes come from the changelog. `npm run release -- 1.19.0` picks a version yourself.
GitHub Actions (`.github/workflows/release.yml`) then builds the universal Mac app on a GitHub Mac
(including NDI) and publishes a release with `Sundays-<version>.dmg` (first installs),
`Sundays-<version>-mac.zip` (what the updater downloads) and `SHA256SUMS.txt`. It takes about
15 minutes; follow it under the repo's **Actions** tab. Edit the release notes on GitHub if you like:
they're what "What's new" shows.

The first time, download the `.dmg` from the release and install it on each Mac. After that every
Sundays offers new versions itself (Check for Updates). To rebuild an existing tag, run the
Release workflow by hand from the Actions tab.

## Planning Center app registration

Sundays signs in through one **Public** Planning Center OAuth application. Its Client ID is
built into `server/src/pco/registration.ts`. The registered callback URLs are:

```
http://127.0.0.1:47123/api/auth/callback
http://127.0.0.1:47124/api/auth/callback
http://127.0.0.1:47125/api/auth/callback
```

Add `http://127.0.0.1:5173/api/auth/callback` only if you develop in a browser with `npm run dev`.

**Sign-in button logo:** Planning Center's brand guidelines require their official, unedited logo.
Download it from https://www.planningcenter.com/logos and save the full-colour icon SVG as
`web/public/brand/planning-center-icon.svg` before building. Until then the button shows text only.

## Mics & packs (Shure)

1. Open a service → **Mics & packs** → the ⚙ button (**Set up mics**).
2. Add each receiver: name, model, IP address (from the receiver's network menu or Wireless
   Workbench), and channel count. Click **Test**. This Mac must be on the same network as the receivers.
3. List your mics and packs, which receiver channel each is on, and which positions each is for
   (e.g. Vox 1 → Worship Leader, Vox 2–4 → Vocals, AG Pack → Acoustic Guitar).
4. On each service, click **Auto-assign** or pick people by hand. Assignments stay in Sundays.

**Read-only:** the app only asks receivers questions (Shure's `GET` commands on TCP port 2202):
battery bars, minutes left, charge, transmitter model, frequency, antennas and signal. It never
sets channel names or anything else. The one exception is ULX-D, QLX-D and SLX-D, which have no
plain question for antenna and RF readings. For those, the app briefly turns on meter reports
(`METER_RATE`) for its own connection and turns them off again. This doesn't change any audio,
RF or channel settings.

## Project layout

```
shared/types.ts            Data shapes shared by the UI and server
server/src/app.ts          Built-in server: API + UI on 127.0.0.1
server/src/auth/oauth.ts   Sign in with Planning Center (OAuth + PKCE), sessions
server/src/pco/            Planning Center client, People/Services calls, app registration
server/src/lib/db.ts       Local data file (users, tokens, sessions, staff notes, mics, history)
server/src/lib/shure.ts    Shure receiver status, read-only (TCP 2202)
server/src/lib/board.ts    Mic board / stage display: cards, backgrounds library, logo
web/components/board/SideStage.tsx  The mic board as the display draws it
server/src/lib/propresenter.ts  ProPresenter API client + finding it on the network
server/src/routes/pro.ts   ProPresenter control (slides, timers, stage) for any computer
server/src/lib/smaart.ts   Smaart v9 API client (SPL readings)
server/src/lib/ahConsole.ts Allen & Heath dLive / Avantis channel names (MIDI over TCP)
web/components/settings/Preferences.tsx  the Preferences window (tabs)
desktop/src/embed.ts       Planning Center Chat inside the window
server/src/lib/paging.ts   Parent paging: the on-screen lock, messages, PINs
server/src/kiosk.ts        Kids & Nursery iPad server (network, PIN-locked)
server/src/demo/demo.ts    Sample data for "Explore with sample data"
web/                       The UI (Next.js + Tailwind, exported as static files)
desktop/src/main.ts        The Mac app (Electron)
desktop/src/updater.ts     Check for Updates (GitHub Releases → verify → replace → reopen)
.github/workflows/         Release build on GitHub (tag → DMG + zip + checksums)
scripts/                   set-repo, release, make-signing-cert
desktop/build.mjs          Bundles UI + server into desktop/app
docs/ARCHITECTURE.md       How it all fits together
```

## Developing in a browser (optional)

```bash
npm install
npm run dev        # http://127.0.0.1:5173 (API on :4000)
```

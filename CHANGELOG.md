# What's new

Each version's notes become its GitHub release notes (and what "What's new" shows in the app). Put
the newest version first. The line right under a version heading is its one-line summary: it names
the GitHub Actions run and the release commit.

## 1.45.0
Edit a service's whole flow from Sundays, choose which teams and times show, and a tidier service page.
- **Edit the service like in Planning Center.** On a service, press **Edit** on the Order of
  service: item names, headers, lengths and descriptions change right where they are (each saves to
  Planning Center when you leave the field). The pencil opens notes, songs, arrangements, keys and
  before/during/after. Add items, headers, media or songs anywhere, move items up and down, and
  delete them. While editing, the service's title and series can be changed too.
- **Service times.** **Edit times** next to a service's times adds, changes or removes services,
  rehearsals and other times in Planning Center.
- **Choose what you see.** **View** on a service picks which teams and times show for that service
  type: hide teams you don't need (they leave the roster, the counts and the Matrix) and hide
  rehearsals, other times or a specific time. It's kept with your settings on every Mac you sign in on.
- **Easier to find the next service.** Previous and Next at the top right are now big buttons that
  show the date they go to.
- **Removed: the Check-ins tab, the Run sheet and Chat.** The service page is now just the service.
  The order of service on it replaces the full-page run sheet, and Chat is gone from the sidebar. A
  start page set to a run sheet or check-ins opens the service instead. The Dashboard's Live widget
  stays and links to the service.

## 1.44.0
Sundays AVL works on phones, and bills clients: invoices, card payments, a client portal and reports.
- **AVL on your phone.** Every AVL table now shows each row as a labeled card on a phone instead of
  scrolling sideways: jobs, quotes, purchasing, clients, catalog, pricing, time, kits, a job's budget,
  costing and purchasing, and the quote builder. A job's tabs become a section picker, and the
  schedule opens on two weeks so it fits the screen.
- **Invoices.** A job's new Invoicing tab shows the approved price, what's invoiced (and what
  percent), collected, owed now and what's left to invoice. Make a deposit invoice; progress invoices
  by schedule phase (each phase is a share of the contract), by percent of the contract, or line by
  line on the budget; change-order invoices; and the final invoice, which bills exactly what's left
  and takes off the rest of the deposit. Drafts can be edited before they go out.
- **Getting paid.** Email the invoice to the client with a link to view, print or save a PDF.
  Record checks, transfers and cash by hand and email a receipt. Connect your own Stripe account
  (AVL → Business → Connections, paste your secret key) and clients pay by card; the money goes
  straight to you and a receipt goes out on its own.
- **Invoices page and aging.** Everything owed across jobs, what's overdue, drafts to send, and how
  much each client owes by age (current, 1–30, 31–60, 61–90, over 90 days). Invoice terms and notes
  are in AVL → Business.
- **Client portal.** Clients sign in with a 6-digit code sent to their email (no password) and see
  their proposals and change orders to sign, the project schedule, files you share, invoices to pay,
  and messages with you. The job's new Client tab has the portal link and the messages.
- **Selections.** Offer the client choices after the sale (a finish, a screen size, an upgrade).
  They pick in the portal and the pick joins the job's budget at its price and cost; lock it when
  it's final.
- **Reports.** Pipeline, win rate, revenue by month (invoiced and collected), margin by job, unpaid
  invoices and hours by job.

## 1.43.0
The clock follows ProPresenter's timers, and team check-ins live only on the website, with any date, a grid and printed reports.
- **The clock follows ProPresenter.** In Clock → ProPresenter timers, pick your ProPresenter computer
  and click **Follow ProPresenter**: whatever timer is running there shows as the main timer, and a
  second running timer shows in the aux (left) box. Choose specific timers for main and aux if you
  like. While following, Start, Pause, Reset and ± run ProPresenter's own timer.
- **Your saved timers still win.** Click any saved timer (or press its number) and it takes over the
  clock from ProPresenter. **Back to ProPresenter** (or P) returns to it, or tick "go back when one of
  its timers starts" to do it by itself. Stream Deck / Companion: `follow-pro` and `manual`.
- **Check-ins on the website only.** Team check-ins, their settings and the phone pages (/leads,
  /staff) are gone from the Mac app; everything is at sundays-checkin.vercel.app. Old links and phone
  addresses go there. Kids check-ins by room stay on each service's Check-ins tab, for paging.
- **Your ministries come along.** The first time Sundays opens after this update it brings the Mac's
  ministries to the website by itself (Preferences → Team Check-ins has the button too). A ministry the
  website already has keeps its teams and gets the Mac's teams that weren't in one; new ones are added.
  Nothing set on the website is changed.
- **Any service date.** The check-in page lists last week's services too, so Sunday is still there on
  Monday, and the calendar button jumps to any date, past or future.
- **Print a report.** The printer button (or your menu → Print a report) makes a check-in report
  grouped by ministry: totals per ministry and team, then who checked in (and when, and by whom) and
  who didn't. For this service or the whole day, everyone or just who's missing.
- **A grid on bigger screens.** Team cards sit two or three across on a laptop or iPad and stay one
  per row on phones.
- **Fix: check-in settings were slow to open.** They read every Check-Ins event's areas before showing
  anything. Now they open right away and load areas only for the events you use.

## 1.42.0
The mic board follows the service you're working on, and it's the whole stage display now.
- **The mic board shows the service you're working on.** Open a service under Services, or change
  who's on which mic in its Mics panel, and the board switches to that service within a couple of
  seconds. Before, it could stay on a different service from the weekend, so your changes didn't show.
  The Mic board page's header says which service it's showing.
- **No more banner, and no more mic board / clock switch.** The stage display is always the mic board,
  with the clock (time of day or the production clock) in its middle. The Banner box and the Auto /
  Mic board / Clock buttons are gone, along with their settings.

## 1.41.1
Press F to make the mic board full screen, and a bigger middle on ultrawide screens.
- **F for full screen.** On the display (http://<this Mac>/display) and on the Mic board page,
  press F (or double-click the board) and the board takes over the whole screen: no address bar,
  tabs or menus. F or Esc again to leave. On the Mic board page there's a Full screen button too.
- **Ultrawide screens.** On screens wider than 16:9 (21:9, 32:9), the logo, clock and date in the
  middle grow with the room they have (up to one and a half times), instead of sitting small.

## 1.41.0
Your stage plot on the mic board, under the clock.
- **Stage plot.** In Display settings → Middle of the board, add your stage plot as a PDF (pick the
  page if it has several) or a picture. It shows under the clock and fills the middle of the board,
  cropped to the drawing. **Show it dark** turns a white page dark to match the board (on by default).
  It syncs to every Mac you sign in on, like your backgrounds and logos.

## 1.40.1
The new mic board, released (1.40.0's build didn't finish).
- 1.40.0's Mac app build stopped partway, so it never reached Check for Updates. This release has
  everything from 1.40.0: the new mic board, the battery with its percentage, your logo and its
  schedule, and backgrounds that follow you to every Mac.

## 1.40.0
A new mic board: photo cards down both sides, your logo and the clock in the middle, and backgrounds that follow you to every Mac.
- **New mic board.** Each mic gets a photo card: the mic's name in its own color across the top, a
  line of your own under it ("Worship leader"), a battery at the top right, their picture, and their
  name. Half the mics go down the left side and half down the right, in Mic setup order.
- **A battery on every card, with its percentage,** read from the Shure receiver (read-only, as
  always): the percentage for rechargeable packs, or the bars as a percentage. A low battery turns the
  icon yellow; one to change now flashes red and edges the card in red. "OFF" when the transmitter is off.
- **Packs on the same card.** Someone on a vocal and a pack (acoustic, strings, anything) gets one
  card labeled "VOX 1 + AG PACK", with the battery of their main mic.
- **Your logo over the clock.** In the middle of the board: your logo, and under it the time of day
  (with the date) or just the production clock's countdown with the name of the timer under it.
- **Logo schedule.** Add as many logos as you like, star the default, and put the others on a
  calendar: once, every day, chosen weekdays, monthly or yearly, all day or between two times, until
  a date or for good. The board swaps them in by itself (a Christmas logo Dec 20–26, a youth-night logo
  Wednesdays 6–9 PM). Logos and the schedule sync to every Mac you sign in on.
- **Backgrounds folder, synced.** Upload backgrounds once in Display settings and every Mac you sign
  in on has them. Name one like a person ("Eddie") and it shows behind them, or pick one for a mic
  or a person. Otherwise their Planning Center photo shows.
- **Colors and your own line per mic,** and first or full names, in Display settings.
- **Micboard is gone.** The mic board is now built from the ground up in Sundays, so Micboard (and the
  Python that came with it) is no longer in the app, and Preferences → Micboard is gone. Backgrounds
  you'd given Micboard move into the new library under the same names.

## 1.39.0
Sundays AVL purchasing and job costing: purchase orders, receiving, work orders, vendor bills and change orders.
- **Purchase orders from the budget.** Pick budget lines on a job and Sundays makes one draft PO per
  vendor, with quantities and costs filled in. Add catalog items or custom lines, shipping and tax.
- **PO approval.** Every PO goes to an AVL Manager to approve before it's sent. Approvers get an email
  and a count on Purchasing in the menu; a rejected PO goes back to its creator with the reason.
- **Send POs to vendors.** Email a PO with a link to a clean printable copy, or mark it ordered if you
  placed it another way.
- **Receiving.** Record what arrived, in full or in part. The PO shows what's still outstanding.
- **Work orders for subcontractors.** Send a work order with the scope and dates; the sub accepts it
  online. Mark it done when the work is finished.
- **Vendor bills.** Enter a bill from a PO or work order (lines fill in from what's left to bill) or on
  its own, attach the scan, and mark it paid. Each line can go against a budget line.
- **Change orders.** Add or credit lines after the sale. The client reviews and signs online (or an
  AVL Manager records how they agreed), and the approved lines join the job's budget.
- **Job costing.** A new tab on every job compares each budget line with what's committed (POs, work
  orders), what's actually spent (bills and logged time) and the projected cost and margin. Mark a
  line final once all its costs are in.
- **Purchasing page.** AVL → Purchasing shows every PO, work order and bill, with what's waiting for
  approval, on order and unpaid.

## 1.38.2
Proposal emails say why they didn’t go.
- **Proposal emails say why they didn’t go.** If no email service is set up (or email is off), sending a proposal now says so and where to fix it, instead of showing “Sent”.

## 1.38.1
Wider quantity box on quotes and kits.
- The quantity box on quotes and kits is wider, so 3- and 4-digit quantities show in full.

## 1.38.0
Proposal options A, B, C and sections on quotes.
- **Option A, B, C on proposals.** Mark any line as Option A, B, C or D (or "in every option"). The
  client sees the options side by side with the proposal total for each, picks one and signs. When a
  proposal is accepted, the options and add-ons they didn't pick come off it, so the proposal and the
  job are exactly what was chosen (the version sent still shows everything that was offered).
- **Sections on quotes.** Lines are grouped under their sections. Add a section with one click, rename
  it in place, and add catalog items, custom lines, labor or a kit straight into it.

## 1.37.0
Sundays AVL projects: schedules, crew, tasks, daily logs with photos, job files and time.
- **Job schedule.** Plan a job in phases (Design, Order, Pre-wire, Install, Commission, Training, or
  your own) on a Gantt chart: drag a bar to move it, pull its ends to change the dates, and put people
  on each phase. One click lays out the standard AVL phases on working days.
- **Schedule for every job.** AVL → Schedule shows every job's phases on one calendar, by job or by
  person (who is where, which day), two weeks to a quarter at a time. Drag to move a phase there too.
- **Tasks.** To-dos per job and phase, with who does it, a due date and a checklist. Your open tasks
  and today's work show on the AVL home screen.
- **Daily logs.** What got done on site, issues in the way, people and hours, with photos from your
  phone (big photos are shrunk before they upload).
- **Job files.** Drawings, rack elevations, signal flow PDFs and closeout documents in folders on each
  job, up to 100 MB a file. Mark a file to share with the client (the client portal comes with billing).
- **Time.** Clock in and out on a job (and phase) from your phone, or type hours in after. Each job
  shows hours against the labor hours in its budget, and labor cost at each person's hourly cost
  (AVL → People). AVL Managers see everyone's week in AVL → Time and approve it.
- **AVL Crew.** A new access level for installers: they see only the jobs they're on (schedule, tasks,
  daily logs, files and their own time) and never prices, budgets or clients' proposals.
- Job dashboards show where the job stands on its schedule, its crew, open tasks and hours logged.

## 1.36.0
Sundays AVL estimating: labor rates, markup rules, kits, options the client picks, and proposal versions.
- **Labor rates.** Set up install, programming, travel and other rates with what each costs you and
  what you charge (AVL → Labor & markup). Add them to a proposal from the Labor menu.
- **Markup rules.** Give products a margin by manufacturer, category or vendor. A product added from a
  price list gets the rule that fits it best, or your default margin; you can try it out on the page.
- **Kits.** Save the products, labor and custom lines you use together (a stage-left IEM rig, a
  classroom display) and add them to a proposal in one click, as separate lines or as one line.
  Kits price themselves from today's price lists, markup rules and labor rates.
- **Options the client picks.** Mark proposal lines as an optional add-on, or as alternates where the
  client chooses one (Good / Better / Best). On the proposal link they tick what they want, the total
  follows, and they sign for exactly that. The job is made from what they chose.
- **Proposal versions.** Each time a proposal is sent, what the client saw is kept: v1, v2… with the
  total and date. Open any version from the proposal.
- **Profit view for jobs.** A job's new Profit tab shows price, cost, profit and margin by cost group
  and by kind of cost (materials, labor, subcontract).
- **Kits in job budgets.** Add a kit to a job's budget as its own cost group.

## 1.35.0
Sundays AVL gets a leads board, notes and follow-ups on every lead, client and job, and a report on where work comes from.
- **Leads.** A board of every church you might work with: New, Contacted, Site visit, Proposal
  sent, then Won or Lost. Drag a card to move it, or use the steps on the lead's page. Each card
  shows what it's worth, who owns it and the next follow-up.
- **From lead to job without retyping.** Start a proposal from a lead (the church becomes a client
  if it isn't one yet). Sending the proposal moves the lead to Proposal sent, and the client
  signing it marks the lead won. Winning a lead can create the job straight away.
- **Notes, calls and follow-ups.** Log a note, call, email, meeting or site visit on any lead,
  client or job, and set a follow-up with a date and who it's for. Open follow-ups stay at the top
  until they're ticked off. A lead's timeline also shows every change of stage.
- **Your follow-ups on the AVL home.** Overdue, today and coming up, ticked off right there. The
  top of the home now shows leads in play, proposals out, sales this year and open jobs.
- **Lead sources.** See how many leads each source brings, how many you win and what they're worth,
  for this year, the last 12 months or all time.
- Church teams keep notes and follow-ups on their jobs; leads stay an integrator feature.
- **Operations and AVL keep to themselves in Sundays.** In the Operations or AVL side of the Sundays
  app, the sidebar no longer shows your Planning Center sign-in and the Preferences button, and
  Sundays → Preferences… (⌘,) opens that app's own settings instead of Sundays' Preferences.
- **Fix: the retired apps' last update.** Sundays Services, Workflows, Paging and FOH now get their
  "this is part of Sundays" update in every release, so a Mac that skipped 1.33.0 still gets it.

## 1.34.0
Sundays AVL gets jobs with budgets, and clients can review and e-sign proposals online.
- **Jobs.** A new Jobs page tracks every project from planning to complete, with its client, site,
  dates and manager. A job's dashboard shows price, cost, profit and margin at a glance.
- **Budgets.** Each job has a budget grid of groups and line items, with cost type (material,
  labor, subcontract, other), quantity, unit cost and price. Totals, profit and margin update as you
  type.
- **Signed proposal → job in one click.** Create a job straight from an accepted proposal; its
  sections and items become the budget.
- **Clients sign online.** Sending a proposal gives it a private link you can copy or email. The
  client sees the full proposal on any device and can sign (draw or type), ask for changes or
  decline. You get an email either way, and the proposal shows who signed, when, and the signature.
- **Know when it's been seen.** The proposal shows when the client first opened the link.
- **For church teams too.** In AVL settings, choose whether you're an integrator or a church
  team. Church teams get jobs and budgets without clients and quotes. Set your own job number prefix.
- A deposit is only required to accept a proposal when the proposal asks for one.

## 1.33.0
Three apps instead of seven: Sundays, Sundays Operations and Sundays AVL.
- **Sundays has everything that runs on the Mac.** Services, Workflows, Paging and the FOH companion
  are all in the Sundays app, as they already were; the separate Sundays Services, Sundays
  Workflows, Sundays Paging and Sundays FOH apps are retired.
- **Their last update points to Sundays.** Opening one of them now says it's part of Sundays, opens
  Sundays at the same screen (or its download) and can move itself to the Trash. Sign-in and
  settings are already shared, so nothing needs setting up again.
- **FOH carries on in Sundays.** On a Mac that only had Sundays FOH, Sundays starts as the FOH
  companion with its settings, still linked to the main computer. Elsewhere, choose
  Preferences → Mode → FOH Companion.
- The Apps menu and the app list in the sidebar show only Sundays, Operations and AVL.

## 1.32.1
sundays-checkin.vercel.app opens Team check-ins instead of the Operations sign-in.
- **Fix: the check-in address showed Operations.** Opening sundays-checkin.vercel.app (or the
  app saved to a phone's home screen) went to the Operations sign-in. It now opens Team check-ins
  and signs you in with Planning Center. Signing in comes back to the check-in address too.

## 1.32.0
Team check-ins move to the web: sundays-checkin.vercel.app, where each person signs in with their own Planning Center account.
- **Check-ins on your phone.** Open sundays-checkin.vercel.app and add it to your home screen; it
  gets its own app icon. People sign in with their own Planning Center account and only see what
  Planning Center lets them see. Sundays' own Check-Ins sign-in isn't used.
- **Check-in access on its own.** In Operations → Settings → Users, each person has a "Team
  check-ins" level: None, View, Check in or Manage. Someone can get check-ins and nothing else.
  System admins always manage.
- **Settings live on the website.** People who manage check-ins pick each service's event, each
  team's area, and ministries there. Copy your Mac's settings across once from Preferences → Team
  Check-ins → Copy to the website.
- The church is linked the first time a System admin signs in to the check-in site; Operations →
  Settings → Organization shows the link and can disconnect it. Check-ins on the Mac stay for now.

## 1.31.1
On Micboard, someone on a vocal mic and a pack shows up once, with both mics named on their tile.
- **One tile per person on Micboard.** Someone on more than one mic (a vocal and their acoustic
  guitar's pack) now shows once, on their vocal mic, labelled "Vox 1 + AG Pack". If the folded-in
  pack's battery gets low (3 bars or fewer), it comes back as its own tile until it's changed. The
  setting is under Mic board → Mic board (Micboard) → One tile per person, and it's on by default.
- Sundays keeps this as its own Micboard group ("Sundays · one per person"), made from the group
  you picked. Screens pointed straight at Micboard's address need a reload to see changes.

## 1.31.0
Names on Micboard stay readable on bright background pictures.
- **Readable names.** Micboard writes names in light text, which got lost on bright photos.
  Sundays now darkens bright pictures (yours and Planning Center's) just enough for the names to
  stand out, and leaves dark ones exactly as they are. Your originals are kept. Switch it off in
  Preferences → Micboard ("Keep names readable on bright pictures"). Videos aren't changed.

## 1.30.0
Each service type can have its own mic assignment filter, and the Dashboard's widgets can be dragged into place.
- **Mic filter per service type.** In Services → Mics & packs → Set up mics, tick "Use different
  'For positions' for …" to give that service type its own positions on each mic (Auto-assign and
  each mic's list use them). Other service types keep the shared ones.
- **Hide people who already have a mic.** Someone on Vox 1 isn't offered for Vox 2 (they can still
  get a pack). On by default; switch it per service type with "Hiding assigned" in Mics & packs or
  in Set up mics.
- **Drag and drop on the Dashboard.** Click Edit and drag any widget to where you want it; the
  others move out of the way as you go. There's also a new "Move to the top" button. Press Escape
  while dragging to put it back.

## 1.29.0
Operations now emails the right people when requests come in and change, sent through Sundays or your own email account.
- **Operations emails.** A new work order or supply request emails the team that handles it (or
  its approvers, when it needs approval first). Whoever asked gets an email when it's approved,
  declined (with the reason), put on hold, ordered or done, and people get an email when a request
  is assigned to them. Nobody is emailed about something they did themselves.
- **Email settings** in Operations → Settings → Organization → Email: send through Sundays (nothing
  to set up), your own Brevo or Resend account, or turn emails off; choose the name and reply-to
  address, which emails go out, send yourself a test, and see what was sent lately.
- **Sundays' email relay** in the admin console (Admin → Email): one Brevo or Resend account that
  every organization can send through, up to 300 emails a day each.

## 1.28.0
Sundays is now seven Mac apps (Services, Workflows, Paging, FOH, Operations, AVL and the full Sundays app) that share your sign-in and open each other.
- **Separate apps.** Sundays Services (services, run sheets, team check-ins, ProPresenter, the
  Clock, the Mic board and the Dashboard), Sundays Workflows (workflows and Chat), Sundays Paging
  (parent paging and the Kids & Nursery iPads), Sundays FOH (the FOH companion), Sundays Operations
  and Sundays AVL. Each has its own icon, Dock name and updates. The full Sundays app still has
  everything.
- **They share one Sundays.** Open more than one on the same Mac and they use the same sign-in,
  settings, weekend and Micboard. Whichever opens first runs Sundays in the background; if it quits,
  another app takes over without you noticing.
- **They link to each other.** A link to a screen another app has (a workflow card from the
  Dashboard, say) offers to open it in that app. The new Apps menu and "Sundays apps" in the sidebar
  open the others. Apps you don't have open in the full Sundays app instead, and Operations and AVL
  open on the website.
- **Signing out** in any of them signs you out of all of them on that Mac.
- **Sundays FOH** is always an FOH companion, with its own settings, so it can run on the same Mac
  as the main Sundays.
- **Sundays Operations and Sundays AVL** on the Mac: the same screens as the website, in their own
  app, each linking to the other.

## 1.27.1
The Mic board (and everywhere else that lists service types) now finds service types kept in Planning Center folders.
- **All your service types.** Service types filed in folders in Planning Center now show up in the
  Mic board's service type list, the Clock presets and Services, not just the top-level ones.

## 1.27.0
Sundays | Operations is now a service any church or team can sign up for, with plans, add-on modules, church pricing and a Sundays admin console.
- **Anyone can start an organization.** Sign up, pick a plan and you get your own organization with a
  main campus and the usual request types and supply lists ready to go. Everything is kept separate
  per organization.
- **Belong to more than one organization.** The organization switcher (top of the sidebar) moves
  between them and starts new ones.
- **Invite people by email.** Inviting someone copies a ready-to-send invitation; when they create
  their account with that email they're straight in.
- **Modules.** Technology requests, supply requests, facilities work orders, multiple campuses, custom
  branding and AVL quoting are each a module. A plan includes some, and others can be added on per
  organization. Anything an organization doesn't have is hidden.
- **Plans and pricing.** A public pricing page, monthly or yearly billing, free trials. Churches get
  15% off automatically.
- **Plan & billing** in Settings → Organization shows your plan, modules, discounts and invoices.
- **Sundays admin console** for super admins: every organization (status, plan, modules, discounts,
  full licenses, notes), plans and add-on prices (changes show on the pricing page right away),
  invoices (generate, send, mark paid or void) and who the super admins are. Super admins can open
  any organization to help out without showing up in its people list.

## 1.26.0
Sundays | AVL is its own app with a client list, Sundays | Operations and AVL are on the web for your team, and request types get icons.
- **Sundays | AVL** is now separate from Operations, with its own sidebar and teal look. Operations is
  just the church's business (requests, work queue, teams, campuses, request types). AVL is where you
  handle the other churches you work with.
- **Clients** in AVL: each church you quote for, with its address, notes, tax-exempt status, contacts
  (one marked as the main contact) and every quote it has had. Quotes are filtered by client instead
  of campus.
- **Separate access, one sign-in.** Each person has Operations access and an AVL level, set
  separately. AVL Managers approve AVL sign-ups and give access under AVL → People, and only AVL
  Managers and admins hand out AVL access. Executives no longer see AVL automatically.
- **AVL → Business**: AVL's own name, address, logo, quote prefix and quoting defaults for proposals.
  It starts from the church's details, so nothing changes until you edit it.
- **Add products by hand.** On a vendor or in Product pricing, add a single product (SKU, name, cost,
  MSRP, MAP and more) without a spreadsheet. Click any product to change or remove it.
- **New request types** have an icon picker (or any emoji), a title and a line of subtext, with a live
  preview of the tile staff will see. Managers can also add a type straight from New request.
- **On the web**: a website version of Operations and AVL (in `ops-web`, ready for Vercel), so your team
  can use it from any browser or phone without installing Sundays. Same accounts and data as the
  Mac app; each person sees only the apps they have access to.
- The Mac app's switcher now has three tabs (Sundays, Operations, AVL) and reopens the one you used last.

## 1.25.2
Church Ops is now **Sundays | Operations**, and Smaart SPL readings come through.
- Church Ops is renamed **Sundays | Operations** everywhere: the switcher (Sundays / Operations), the
  sidebar, sign-in and the email confirmation page.
- **Smaart SPL**: Sundays now reads the level however Smaart sends it (meter names with their values,
  text like "LAeq 10m 93.2 dB", or raw meter numbers), asks each measurement for its meters every
  second, and keeps the last reading on screen for up to a minute instead of falling back to
  "Waiting for level data". If it still waits, Preferences → Audio → Smaart → "What Smaart is
  sending" shows exactly what came in.

## 1.25.1
Sundays and Church Ops now feel like two apps in one window, and creating a Church Ops account no longer ends on a broken page.
- A Sundays / Church Ops switcher at the top of the sidebar. Each side has its own sidebar, look
  (Church Ops is violet, with your church's logo once you add it) and home, and the switcher goes back
  to where you were on the other side. Sundays reopens on the side you used last.
- Church Ops is gone from the Sundays menu, and the Weekend picker and campus switcher stay on the
  Sundays side.
- After you create a Church Ops account, Sundays waits for you to click the confirmation link in the
  email and signs you in by itself. The link now opens a short "Your email is confirmed" page instead
  of a broken localhost page.

## 1.25.0
Church Ops inside Sundays (requests, facilities, AVL quoting, with your own accounts), one Weekend everywhere, and settings that follow you to every Mac.
- **Church Ops** (Full Mode only, sidebar → Church Ops): ask for technology, supplies and building
  repairs; a work queue for the teams that handle them (approve, assign, start, hold, order, complete,
  with every step on the record); AVL quotes with vendor price lists, margins, print / PDF; vendors
  with CSV and Excel price-list import; and Settings for users, teams, request types and routing,
  campuses, activity and the organization's logo and quoting defaults.
- Church Ops has its own accounts: people create one with their email, and a manager approves them and
  sets their role (Staff, Manager, Executive, System admin), AVL access and campus. The first account
  becomes System admin. Someone a manager adds ahead of time is straight in when they register.
- Quotes are locked when they're sent; print them or save the PDF for the customer, then record the
  answer (accepted, wants changes, declined). Online sign-and-pay comes later.
- **Weekend picker** in the sidebar: pick the weekend you're working on, and the Dashboard, Mic board
  and displays, Clock, Tuning strip, FOH companion, team check-ins and the start-up view all use that
  weekend's service. Nothing moves on to the next weekend by itself.
- **Sync across your Macs**: sign in with Planning Center on another Mac and it gets the same setup
  (Preferences → About shows when it last synced). Each Mac keeps its own mode, PIN, screens, MIDI
  output and FOH links.

## 1.24.0
Cool Services is now Sundays, with a new icon: a countdown ring around a live dot.
- New name everywhere: the app, its menus and windows, the sign-in screen, the installer
  (Sundays-<version>.dmg) and the GitHub releases.
- New app icon and logo.
- Updating keeps everything: Cool Services.app becomes Sundays.app, and your sign-in, settings, notes
  and Micboard move to ~/Library/Application Support/Sundays on the first launch.

## 1.23.0
Resi: a "Resi live" badge on Services and a Resi widget on the Dashboard showing when you're streaming.
- Connect Resi in Preferences → Video → Resi with an API Client ID and Secret from Resi Studio.
- Services shows a red **Resi live** badge (with the time live) while you're streaming, amber while
  it's starting.
- New Dashboard widget, **Resi live stream**: time live, each encoder's state, the title, and every
  destination (Web, YouTube, Facebook, RTMP) with its state; when you were last live.
- Read-only: Cool Services never starts or stops a stream.

## 1.22.0
Three modes after signing in: Full Mode, Service Mode for a shared computer (PIN to leave it), and FOH Companion; stage plots are removed.
- **Service Mode**: only Services, ProPresenter, Clock, Mic board and Parent paging. Workflows,
  Check-Ins (Team check-ins and the services' Check-ins tab), the Dashboard and Chat are closed, in
  the app and on its server. A PIN you choose is needed to switch back to Full Mode or to open
  Preferences; it unlocks everything for 15 minutes.
- The first sign-in on a computer asks for its mode: **Full Mode**, **Service Mode** or **FOH
  Companion**. Change it in Preferences → Default Startup → This computer (also the PIN).
- **Stage plots are removed** (the Stage plots page, each service's Stage plot tab, and the stage
  plot on the stage display). Auto on the stage display now shows the mic board around rehearsals
  too; a display set to the stage plot shows the mic board.

## 1.21.0
FOH companion: a Tuning strip above the mic strip (the main computer sends the keys to Waves), and you choose which display the strip is on.
- Tuning strip on the FOH companion, right above the mics: Chromatic, Off and each song's key in
  service order, from the service the main computer's Mic board follows.
- Pressing a key sends it to Waves SuperRack from the main computer (its Cool Services window sends
  the MIDI, exactly like its own Tuning bar), so nothing on the companion changes. The key lights
  up there and on the strip.
- The strip no longer takes the focus from the app you're working in when you press it.
- Choose the strip's display in the companion window from a picture of your displays (found again
  by name if macOS renumbers them), or move it to the next display from the strip itself.

## 1.20.2
Mics show up again: receivers Micboard doesn't have are read directly, and a new Micboard starts with the mics from Mic setup.
- Since 1.20.0 the mics showed as not found: Cool Services read the receivers only through Micboard,
  and a new Micboard has no receivers yet. Now any receiver Micboard isn't connected to (not added
  yet, SLX-D which Micboard doesn't support, or one it can't reach) is read directly, as before.
- A Micboard with no slots yet starts with the receivers and mics from Mic setup (through Micboard's
  own config), so it shows them right away. After that, set them up in Micboard as usual.
- The app tells macOS why it uses the local network, for the Local Network permission prompt.

## 1.20.1
Fixes the Mac build for 1.20.0 (Micboard built in): Micboard's Python now ships next to the app archive instead of inside it.
- The 1.20.0 release didn't build: the universal (Apple silicon + Intel) build couldn't merge an app
  archive with all of Python's files unpacked from it. Micboard and its Python now live in
  Cool Services.app/Contents/Resources/micboard.
- Everything from 1.20.0: Micboard built in (creativedamage/micboard, unchanged), names and photos
  from Planning Center, your own backgrounds in Preferences → Micboard, and no more Keychain
  password after updates.

## 1.20.0
Micboard built in (creativedamage/micboard), with names and photos from Planning Center and your own backgrounds; no more Keychain password after updates.
- The mic board is now Micboard itself: creativedamage/micboard, unchanged, running inside the app
  with its own Python (nothing to install). It's on the network at `http://<this Mac>:8058`, and the
  stage display (banner, Auto, network page, second display) shows it.
- Micboard's slots appear in Mic setup by themselves, so people can be put on them in each service's
  Mics panel; their names go to Micboard as extended names.
- Preferences → Micboard: on/off and port, its address and QR code, names (first or full),
  Planning Center photos, and your own background pictures and videos.
- Display settings → Mic board: which Micboard group, TV view and info drawer, and backgrounds.
- While Micboard runs, Cool Services reads the receivers through it instead of connecting twice.
- Updates no longer ask for your Keychain password. The sign-in key moves out of the Keychain on the
  first launch of this version (one last prompt), and the app doesn't use the Keychain after that.

## 1.19.0
FOH companion mic strip: the mics along the bottom of the screen, with page requests still taking over the full screen until answered.
- On an FOH companion, a short always-on-top bar across the bottom of the screen shows every wireless
  mic: name, who's on it, status color, battery, audio and RF. Everything above it stays clickable
  (Waves SuperRack, the console app).
- A page request still takes the full screen; once it's accepted, held or denied, the strip comes back.
- Hover the strip and press the gear (or click Cool Services in the Dock) for the companion window:
  turn the strip on or off, choose its height and which display it's on.
- Also includes 1.18.4 (mic board: hide/show mics, a person's mics stacked on one tile, mics that
  aren't on the network; the board follows the service you have open; Services reopens where you left it).

## 1.18.4
Mic board: hide or show mics, stack a person's mics on one tile, add mics that aren't on the network; the board follows the service you have open; Services reopens where you left it.
- Mic board → Display settings → **Mics on the board**: show or hide each mic, and add mics that
  aren't on the network (they show who has them, without battery or RF).
- **One tile per person**: someone on two mics (a vocal and the acoustic guitar's pack) gets one tile,
  with the other mic stacked under the mic name.
- The board now follows the service you have open in Services (or, if you choose, always the next
  service).
- Services in the sidebar takes you back to the service and tab you were last on.

## 1.18.3
README with screenshots and download links; releases named by version and what changed.
- The README shows every part of the app, with links to download the latest version and to all releases.
- Releases: `npm run release` names the GitHub Actions run and the release after the version and its
  summary, and the release notes come from this file.

## 1.18.2
Mic board: up to 12 tiles per row.
- Tiles per row now goes up to 12 (Fit already puts 10 mics side by side on a widescreen TV).

## 1.18.1
Micboard-style mic board.
- Tall columns: the mic in italics, the person's name, a status block (green, yellow, red, striped when off),
  battery, audio and RF graphs, antennas.
- Pictures behind the name, as a round photo above the name, or none.

## 1.18.0
Mic board and stage display.
- A board of your wireless mics with pictures (Planning Center or your own), battery, RF and audio.
- Banner message across the top (your mission statement or anything else).
- The display switches between the mic board, the stage plot and the clock, by hand or automatically
  (stage plot during rehearsal, mic board for the service).
- Open it on another computer at `http://<this Mac>/display`, or on a second display.

## 1.17.0
Production clock with NDI output.
- Countdown, count up, count to a time, time of day, until service and Live item.
- Saved timers with schedules and "what's next"; title bar, second timer, Information box, messages.
- Outputs: NDI, the church network, a second display, Stream Deck / Companion links.

## 1.16.1
Team Check-ins settings save with a Save button, for your campus only.

## 1.16.0
Volunteer Check-Ins event and each team's area of serving.

## 1.15.0
Team check-ins on phones for team leads and staff.

## 1.14.0
Team check-ins by ministry, FOH companion, workflow access and notifications, inline run sheet editing.

## 1.13.1
A Check-Ins permission problem no longer signs you out.

## 1.13.0
Stay signed in; NDI removed (it returned in 1.17 without needing a compiler).

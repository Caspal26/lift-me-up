# Lift Me Up

A private morning reading for one founder. Every morning at 08:00 (Nairobi
time, adjustable) your phone receives one true founder story, one philosophy
quote whose wording has been checked against a real edition, and one small,
manageable thought to carry into the day. It is written for someone in the
middle of building a company, when the outcome is still uncertain.

- **Installable on Android** as a progressive web app. It opens straight to
  Today's Reading.
- **Researched on the server** before each delivery by Claude, using web
  search and web fetch. Your API key never leaves the server.
- **Checked by the server itself**, not taken on trust. Before an edition can
  be published:
  - the quote's exact wording must be found in the cited edition;
  - at least two story sources must load and name the founder;
  - the story must not repeat anything in the permanent story ledger.
- **One edition per local day.** Refreshes, job retries and restarts always
  return the same reading.
- **Delivery that can't send twice.** Push notifications are the default,
  with optional WhatsApp through the official WhatsApp Business Platform.
- **A reserve** of researched, unused editions covers mornings when research
  is unavailable.
- **Offline**: readings you have opened or saved stay on the phone.
- **"I need encouragement now"** gives a short reflection on demand. It never
  touches the daily edition or its history.

## How a morning works

```
05:30  research job ─► Claude: web search + fetch ─► sourced dossier
                       Claude: writes the edition (structured JSON)
                       server: repeat check against the story ledger
                       server: fetches the quote's edition, matches the wording
                       server: opens every story source
                       ─► stored as this morning's candidate
08:00  publish ─► the candidate, or (if research failed) the best reserve edition
       deliver ─► one push per device, one WhatsApp, each claimed in the
                  database before sending; failures retry with backoff
later  reserve top-up ─► keeps 3 researched, unused editions ready
```

The rotation is decided by the code, not left to the model. Each research job
is asked for the region, industry, kind of episode and philosophical tradition
that have been quiet longest. It also enforces some minimum shares: an African
(often Kenyan) founder at least every four mornings, healthcare or diagnostics
every five, a closure or change of direction every six, and a bootstrapped
company every six. Recently used thinkers are avoided.

The editorial voice, the shape of an edition and the truthfulness rules live
in one file: [`server/research/brief.md`](server/research/brief.md). Edit it to
change the writing.

## 1. Run it on your computer

Requires Node.js 22.13 or newer (it uses the built-in SQLite).

```bash
npm install
```

```bash
APP_PASSCODE=choose-something npm start
```

Open http://localhost:8080 and enter the passcode. On first start the app
loads the researched editions in [`seed/editions`](seed/editions) into the
reserve. It checks their quotes and sources live as it does, which takes about
a minute. Without an API key, every morning is published from that reserve.

To try the whole system without waiting for real mornings:

```bash
npm run simulate
```

```bash
npm test
```

The simulation runs three mornings on a fresh database and writes
[`docs/simulation-report.md`](docs/simulation-report.md).

## 2. Host it

You need an always-on server with HTTPS. Phones only allow push notifications
and app installation over HTTPS, and the morning scheduler runs inside the
app. Use a single machine, because the database is one SQLite file.

**Fly.io** (configuration included; Johannesburg is the nearest region):

```bash
fly launch --no-deploy --copy-config
```

```bash
fly volumes create lift_data --region jnb --size 1
```

```bash
fly secrets set APP_PASSCODE='your passcode' PUBLIC_URL='https://lift-me-up-caspal.fly.dev' VAPID_SUBJECT='mailto:you@example.com'
```

```bash
fly deploy
```

Before `fly launch`, change `app` in `fly.toml` to a name of your own, and use
that name in `PUBLIC_URL`. `fly.toml` keeps one machine running at all times
so the scheduler never sleeps.

**Any other host** (Railway, Render, a VPS): build the `Dockerfile`, mount a
persistent volume at `/data`, and set the environment variables from
[`.env.example`](.env.example). If your host puts idle apps to sleep, set
`CRON_SECRET` and have an external scheduler call this every five minutes:

```
POST https://<your app>/api/cron/tick   (header x-cron-secret: <CRON_SECRET>)
```

It is safe to call as often as you like.

**Backups:** everything — editions, the story and quote ledgers, favourites,
subscriptions — is in `/data/lift-me-up.db`. Copy that file.

## 3. Connect research and writing (Claude)

1. Create an API key at https://platform.claude.com/ under **API keys**.
2. Set it on the server: `fly secrets set ANTHROPIC_API_KEY=sk-ant-...`
   (or `ANTHROPIC_API_KEY` in your host's environment).
3. Restart, then check the connection by researching one edition into the
   reserve now. This usually takes several minutes:

   ```bash
   fly ssh console -C "npm run research"
   ```

Settings → *Behind the scenes* in the app shows whether research is
connected, how many editions are in reserve and how the last run went.

The defaults are Claude Opus 5.5 at high effort, up to 14 searches and 18 page
fetches a run. It also uses Anthropic's server-side fallback, so a request the
model wrongly declines is retried on a fallback model instead of failing. Each
morning costs roughly one or two US dollars in tokens, plus about $0.01 per web
search. To spend less, set `CLAUDE_RESEARCH_EFFORT=medium`, lower
`CLAUDE_MAX_FETCHES`, or choose another model with `CLAUDE_MODEL`. Check
current prices at https://claude.com/pricing.

## 4. Turn on notifications

Push needs no outside account. The server creates its VAPID key pair on first
start and keeps it in the database. If you want the keys to survive a fresh
database, generate them once with `npm run vapid` and set `VAPID_PUBLIC_KEY`
and `VAPID_PRIVATE_KEY`. If the keys change, every device must turn
notifications on again.

On the phone, after installing (next step): **Settings → Turn on
notifications → Allow**, then **Send a test**. Each morning's notification
shows the story's title. Tapping it opens that exact edition, which the phone
has already downloaded, so it opens even without a signal.

## 5. Install on Android

1. Open your app's address (for example `https://lift-me-up-caspal.fly.dev`)
   in **Chrome**.
2. Enter your passcode.
3. Tap **⋮ → Install app** (on some phones, **Add to Home screen**).
4. Open Lift Me Up from the home screen, go to **Settings**, and turn on
   notifications.
5. If Android's battery saver is aggressive (some Tecno, Infinix, Xiaomi and
   Samsung phones), go to **Settings → Apps → Chrome → Battery** and choose
   *Unrestricted*. Then morning notifications won't be held back.

Long-pressing the app icon gives a shortcut straight to **I need
encouragement now**.

## 6. WhatsApp (optional)

WhatsApp delivery uses the official **WhatsApp Business Platform (Cloud
API)**. Messages a business starts must use a template that Meta has
approved, and the recipient must opt in. The app enforces both: you opt in
from Settings with an explicit consent box, and a reply of `STOP` opts you
out.

1. In [Meta for Developers](https://developers.facebook.com/), create an app,
   add the **WhatsApp** product and register a business phone number. That
   number can't already be your personal WhatsApp.
2. Create a permanent access token: Business Settings → System users → add a
   user with `whatsapp_business_messaging` permission → generate a token.
3. In WhatsApp Manager, create a message template:
   - **Name:** `lift_me_up_morning`
   - **Category:** Utility (Meta may reclassify it as Marketing)
   - **Language:** English
   - **Body:** `Good morning. Today's reading is "{{1}}". Open it here: {{2}} Reply STOP to stop these messages.`

   Meta rejects templates that begin or end with a variable, hence the closing
   sentence. Wait for approval.
4. Set on the server:

   ```
   WHATSAPP_TOKEN=...            # the system-user token
   WHATSAPP_PHONE_NUMBER_ID=...  # from WhatsApp → API Setup
   WHATSAPP_TEMPLATE_NAME=lift_me_up_morning
   WHATSAPP_TEMPLATE_LANG=en
   PUBLIC_URL=https://your-app  # used for the link
   ```

5. To honour `STOP` replies: in the WhatsApp product's **Configuration**, set
   the webhook URL to `https://your-app/api/whatsapp/webhook` and choose a
   verify token. Subscribe to `messages`, and set `WHATSAPP_VERIFY_TOKEN` and
   `WHATSAPP_APP_SECRET` (App settings → Basic → App secret).
6. In the app: **Settings → WhatsApp → enter your number → tick the consent
   box → Turn on WhatsApp → Send a test.**

Meta charges per template message; check its current pricing for Kenya.

## Adding to the reserve by hand

Write an edition as JSON in the format at the end of
[`server/research/brief.md`](server/research/brief.md). Put it in
`seed/editions/` and run:

```bash
npm run seed
```

It passes the same gates as a live run: validation, the repeat check, live
quote verification and source checks. Each file keeps its own sources and
research date.

## Project layout

```
server/
  index.js            start-up: database, first-run reserve, scheduler, HTTP
  app.js              HTTP API and the app shell
  scheduler.js        the morning: research → publish → deliver → top up reserve
  editions.js         validation, one-edition-per-day publishing, archive
  research/
    brief.md          the editorial brief (voice, shape, truthfulness, format)
    pipeline.js       every gate between research and the reader
    researcher.js     Claude: research (web search/fetch) and writing (structured output)
    verify.js         independent quote and source checks
    ledger.js         repeat detection against the story ledger
    rotation.js       which region, industry, arc and tradition come next
  delivery/           push, WhatsApp, and duplicate-proof delivery
  encourage.js        "I need encouragement now"
public/               the PWA: app.js, sw.js (offline + push), styles, icons
seed/editions/        hand-researched editions for the reserve
scripts/              simulate, seed, research-now, verify-quote, make-icons
test/                 offline tests (npm test)
```

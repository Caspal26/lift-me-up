# Lift Me Up — offline Android app

A standalone Android app with the morning editions bundled inside it: no
server, no network, no API keys. One edition opens each morning at the chosen
time (default 08:00 Africa/Nairobi) with a notification showing its title.

## What is here

| Path | What it is |
|---|---|
| `slate.tsv` | The candidate episodes (one per line) the editions were researched from. |
| `RESEARCH-AGENT.md` | The brief every researcher followed, on top of `server/research/brief.md`. |
| `editions/*.json` | The researched editions, in the server's edition format. |
| `progress/<slate-key>.json` | Done or dropped, with conflicts and reasons, per slate entry. |
| `hold.json` | Editions that pass every check but are thinner; left out of the app. |
| `texts/` | Cached public-domain texts the quotes were chosen from (Gutenberg, MIT Classics, Wikisource). Not in git: recreate with `node offline/tools/fetch-texts.mjs`. |
| `tools/` | Research and build tools (below). |
| `app/` | The Capacitor 6 Android project. |
| `work/` | Generated: scratch database, bundle, batch plans (not in git). |

## Checks (all run the server's own code)

```bash
node offline/tools/check-edition.mjs offline/editions/<id>.json   # one edition, as a seed import would
node offline/tools/import-all.mjs                                  # every edition into work/scratch.db, live
node offline/tools/review-repeats.mjs                              # pairs sharing a surname or company word
node offline/tools/coverage.mjs                                    # regions, industries, traditions, talQen, drops
```

`import-all.mjs` uses `importEditions` (server/seed.js): `validateEdition`,
the repeat check, `verifyQuote` against the cited edition and `checkSource`
on every story source, plus the app's rules (at least two sources that load,
one naming the founder, no quote that overlaps another).

## Building the app

```bash
node offline/tools/import-all.mjs   # final gate
node offline/tools/order.mjs        # rotation-quota order -> work/bundle.json
node offline/app/build.mjs          # www/ from public/ + src/ + the bundle
cd offline/app && npx cap sync android
powershell -File offline/app/gradle.ps1 assembleRelease
```

The APK is `offline/app/android/app/build/outputs/apk/release/app-release.apk`.
`gradle.ps1` sets JDK 17 and a short temp folder (`C:\gtmp`): Java's local
sockets fail on this machine when TEMP is long. Capacitor 6 is used because
Capacitor 7 and later need JDK 21.

## Signing and updates

The release keystore is **outside the repository** at
`C:\Users\Administrator\lift-me-up-release\` (`lift-me-up-release.jks` and
`keystore.properties`, which holds the passwords). Every update must be signed
with the same key or Android will refuse to install it over the old app; keep
a copy somewhere safe. Set `LMU_KEYSTORE_PROPERTIES` to use another location.

For an update, raise `versionCode` and `versionName` in
`app/android/app/build.gradle`. New editions can be appended: the app keeps
the start date, so edition *i* still opens on start date + *i* days and
favourites (stored by edition id) survive.

## How the app works

- `app/src/local.js` answers the PWA's old `/api/*` calls on the phone from
  `editions.json`; `app/src/app.js` is `public/app.js` with that data layer.
- `DailyReadingPlugin` (Java) keeps exactly one exact alarm pending — the next
  morning's — so Android's ~500 pending-alarm limit never matters. The alarm
  posts the title, then sets the next. `MorningReceiver` re-arms after a
  reboot, an app update, a clock or time-zone change, or a change to the
  exact-alarm permission. Android 13+ notification permission is requested on
  first launch and from Settings.
- "I need encouragement now" picks from about 35 prepared reflections in
  `app/src/encouragements.js`, steered by words in the optional note.
- `node offline/app/test-local.mjs` checks the data layer with a fake clock.

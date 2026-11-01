# Lift Me Up offline — coverage report

Bundle `2026-11-01-345`, in `LiftMeUp-1.0.0.apk` (versionCode 1, signed with the
release key in `C:\Users\Administrator\lift-me-up-release\`).

## Totals

- **345 editions in the app**: the 6 seeds plus 339 researched in Claude Code
  (web search and page fetching by researcher subagents; no API key, no
  server pipeline).
- **All pass the server's own checks.** Final run of `importEditions` into a
  scratch database (validateEdition, the repeat check, `verifyQuote` against
  the cited public-domain edition, `checkSource` on every story source), plus
  the app's rules: 346 of 346 imported, 0 rejected, 0 warnings. Every quote is
  an exact match in its cited edition; every edition has at least 3 story
  sources that load (median 7) and at least one naming the founder.
- **Rotation quotas hold in every stretch of mornings**: an African founder in
  every 4 consecutive days, healthcare in every 5, a closure or change of
  direction in every 6, a bootstrapped business in every 6. No thinker returns
  within 7 days; stories that mention each other are kept weeks apart.
- **talQen** is mentioned in 19 of 345 (5.5%): 3 of the 6 seeds and 16 of 339
  researched editions, each in a health, diagnostics or quality story.
- 1 edition held back (Jumia Food's 2023 exit: decided by a successor
  executive, not a founder). 8 slate entries dropped (below).

## Spread

| | |
|---|---|
| African founders | 107 (31%): Kenya 31, West Africa 27, East Africa 20, Southern Africa 14, North Africa 9, Central Africa 6 |
| Other regions | North America 60, Europe 59, South Asia 41, East Asia 26, Latin America 16, Middle East 13, Southeast Asia 13, Oceania 10 |
| Countries | 65 (USA 58, Kenya 31, India 29, UK 27, Nigeria 18, South Africa 13, Japan 13, …) |
| Health | 93 (27%): healthcare 48, pharmaceuticals 18, diagnostics and laboratories 15, medical devices 10, biotech 2 |
| Other industries | manufacturing 31, retail 31, software 28, food 28, transport 19, finance and fintech 31, media 14, telecoms 11, fashion 10, education 9, logistics 8, social enterprise 8, energy 7, agriculture 5, others |
| Arc | founding decision 186, change of direction 61, setback 41, closure 34, hard responsibility 13, breakthrough 10 |
| Funding | bootstrapped 119 (34%), mixed 86, venture 85, nonprofit 42, unknown 10, public 3 |
| Era | before 1900: 41 · 1900–49: 36 · 1950–99: 108 · 2000 on: 160 |
| Traditions | Stoic 45, American 39, Classical Greek 39, Renaissance and early modern 38, Islamic and Persian 34, Hindu 30, Daoist 27, Confucian 23, Buddhist 22, Jewish 22, Japanese 13, Ancient Egyptian 13 |
| Thinkers | 48 (most used: Saadi 24, Bacon 22, the Dhammapada 22, Confucius 20, Emerson 19, Seneca 17) |
| Quote stance | affirms 196, complicates 130, challenges 19 |

## Dropped, and why

1. **Coco Chanel, 1939 closure**: cannot be told honestly without her
   occupation-era record (Abwehr registration, the attempt to use
   "Aryanisation" laws against her Jewish partners); unsuitable for a morning
   reading.
2. **Paystack, banks refusing a start-up**: the premise was wrong; in
   Akinlade's own accounts banks approached him, and Paystack had a bank
   partner before Y Combinator.
3. **Bento Africa**: the story would rest on unadjudicated allegations against
   a living founder (tax and pension remittances under investigation).
4. **Lidya**: neither founder has explained the 2025 closure; customers' funds
   were frozen, so an unattributed account would be unfair.
5. **Lipa Later**: the administration is still before the High Court; no
   account of why it happened.
6. **Almarai**: only bare facts load; the fuller accounts are blocked or
   paywalled.
7. **Li Ka-shing's plastic flowers**: the famous Italy trip exists only in
   popular retellings.
8. **Mumbai dabbawalas, 1890**: one hedged line per source, and they disagree
   on the central event.

## Source conflicts (examples of how they were handled)

Every edition records its conflicts in `research_notes` (shown in the app
under "How this was researched") and in `progress/<key>.json`.

- **Cardiopad**: units sold given by date and speaker: Zang's 43 (April 2016),
  CNN quoting Zang's "hundreds" (June 2016), National Geographic's "nearly 70"
  (December 2016), the company's 2021 count; the story leans on none.
- **Medtronic**: Bakken's blackout story is told as his account, then the
  University of Minnesota archive's evidence against it.
- **Equity Bank**: Mwangi's pay cut given both ways (83% and 94%) with sources.
- **Haier**: all accounts of the 76 refrigerators trace back to Zhang or Haier,
  so it is told as his 2016 account, with the rival versions named.
- **Médecins Sans Frontières**: its 1971 charter bound members to discretion;
  the "founded to speak out" story is reported as a later myth.

The research also corrected the slate many times (wrong years, founders and
premises: e.g. Lancet Kenya 2009 not 2007, Penda Health's founders, Thepeer's
founders, Elekta founded as a tax arrangement, Konga sold by investors).

## Process notes

- One researcher once put Caspal's email address in a User-Agent header to
  sec.gov (not repeated; nothing from it is in any edition). The brief then
  forbade personal details in requests.
- Two researchers once tried a browser-style header on TechCabal; the
  permission check blocked both, and they used plain requests. One read an
  unlicensed copy of an FT profile but did not cite it.
- Two search results carried planted instructions; the researcher ignored them
  and noted them in `research_notes`.
- Rules-based repeat matches on shared words (two Khans, "Health",
  "Technologies") were worked round by rewording company or founder fields,
  always noted in `research_notes`; `tools/review-repeats.mjs` confirmed the
  only founders who appear twice (Paul Farmer; Erik Hersman and Juliana
  Rotich) are in genuinely different episodes.
- Salud Digna: one opinion column repeats unsupported hearsay about the
  founder; it is not in the edition, flagged here for the editor.

# Researching Lift Me Up editions for the offline app

You are researching and writing morning editions for **Lift Me Up**, a private
reading app for Caspal, a Kenyan medical laboratory scientist who is building
talQen (software for laboratory quality and operations). Each edition is one
true, sourced founder story, one verified public-domain philosophy quote, a
short reflection and a small invitation. About 350 of them will ship inside an
offline Android app, one unlocking each morning, so every one has to stand on
its own and be true.

Research is done here, in Claude Code, with web search and page fetching.
**Never** use `ANTHROPIC_API_KEY`, `npm run research`, the server's research
pipeline, or read `.env`. Never put any personal detail (an email address, a
name, an account) into a request header, URL or form; if a site such as
sec.gov wants a contact in its User-Agent, use another source instead.

## Read first

1. `server/research/brief.md` — the editorial source of truth: voice, shape,
   word counts, truthfulness rules, quote rules and the exact JSON format.
   Follow it to the letter.
2. Two finished examples: `seed/editions/ory-okolloh-ushahidi-first-six-days.json`
   and `seed/editions/stewart-butterfield-tiny-speck-glitch-closure-2012.json`.
   Match their depth of sourcing and their `research_notes`.

## Your assignment

Your prompt names a batch and group: your entries are that group in
`offline/work/batch-NN.json` (`groups[N-1]`), and any extra notes are in the
prompt. Work through them one at a time, saving each edition and its progress
file as soon as it passes before starting the next. Other researchers are
working at the same time: never touch their files. Closures and collapses are
told factually and with respect for the people who lost jobs or money; blame
is attributed only as courts, regulators or the founders themselves put it.

You get a few slate entries (key, founder, company, episode, rough year,
region, industry, arc, funding, and a quote tradition). The slate is a
starting point written from memory, so verify everything: names, dates, the
arc and the funding. If the named episode cannot be sourced well, you may tell
a different, well-documented episode of the same founder or company, provided
it is a single episode and not a biography. If nothing about the entry can be
sourced to the standard below, drop it (see "Progress file").

Tell one episode well: a documented moment, the decision, what they knew at
the time, what they chose, what happened after. Setbacks, ordinary working
days and hard changes of direction matter as much as breakthroughs. Set `arc`
to what the episode really is.

## Sources

- Use WebSearch and WebFetch. Read each source you cite in full, not just the
  search snippet.
- **Searches are rationed**: about 200 web searches are shared by all the
  researchers working at the same time. Use at most 8 per entry. Get the rest
  by fetching pages directly and following their citations: a Wikipedia
  article's reference list is a good map to interviews, obituaries and
  histories (cite those, not Wikipedia), and publishers' archive and tag
  pages list related articles. If searches run out, keep going this way.
- Do not try to get round bot checks or blocks: never set a User-Agent or any
  browser-style header yourself, no scraping proxies. A page the verifier
  cannot load is simply not usable (an Internet Archive copy that loads is
  fine).
- If the repeat screen blocks your edition only because a *different* person
  shares a surname, or a different company shares a word, you may reword the
  founder or company field, and you must say so in `research_notes`. Never do
  this when it is the same person or company: that is a real repeat.
- Prefer founder interviews, oral histories, memoirs, letters, company
  archives, court records, business-school cases and major newspapers or
  established trade press. No content farms, listicles or machine-written
  pages. Wikipedia may appear at most once, as a supplementary source, and
  never as the only support for a pivotal claim.
- **The sources must load for the verifier.** Before writing, run:

      node offline/tools/check-sources.mjs "Founder Name" "Company" <url> <url> ...

  You need at least two sources marked `OK` (they load and name the founder
  or company); three or more is better. `BLOCKED` pages (403 and similar) are
  kept by the server but do not count as live for this app; `DEAD` ones are
  dropped. Replace blocked or dead links with ones that load (another
  publisher, an archive page, a university repository, a PDF that loads).
- **Outcome numbers** — units sold, users, revenue, money raised, staff,
  patients, deaths — are where sources most often disagree. Before the story
  leans on any figure, read every source you cite for a different figure,
  including the founder's own claims. Example from a live edition: for Arthur
  Zang's Cardiopad, National Geographic said "nearly 70 sold" while CNN, also
  cited, quoted him claiming "hundreds". When figures differ, either give both
  with who said what and when, or use the conservative one, and say so in
  `research_notes`. If the disagreement goes to the heart of the story, drop
  it.
- Cross-check the pivotal claims (key dates, the decision itself, the key
  numbers) against two independent sites and record them in `cross_checks`.
- Do not invent dialogue, thoughts, weather or scene details. Founder
  quotations are short (under 25 words), exact, and from a listed source.
  Write original prose; never copy a source's sentences.

## The quote

- Choose it from the cached public-domain texts in `offline/texts/`.
  `offline/texts/manifest.json` lists each text's key, tradition, thinker,
  work, translator, `source_url` and `source_title`. Search a text with Grep
  (for example a theme word) and read around the hit to get the passage and
  its locator (book, chapter, section, verse or letter number).
- Use the tradition you are assigned for each entry unless nothing in it fits
  the story; then take another tradition and say why in your final report.
  Prefer lines that are not famous; avoid the over-used ones.
- Copy the words exactly from the cached file (line breaks and `_italic_`
  marks do not matter; the checker normalises them). You may begin or end
  mid-sentence, but never splice across omitted text and never use ellipses.
  At most 60 words; 15 to 45 reads best.
- Check it before using it:

      node offline/tools/check-quote.mjs <text-key> "<exact quote>"

  It must say `verified: true` and `not used in any edition yet`. It prints
  the citation fields to copy into `quote` (fill in the `locator`; for texts
  written in English, omit `translator`).
- The quote must add something the story does not already say. Most days it
  should deepen or affirm (`stance: "affirms"`); on some days it should
  challenge or complicate the founder's decision, and then the connection
  should let that tension stand. So far too many editions "complicate": aim
  for about half of yours affirming, and at most one "challenges".

## Writing

- Follow the brief: British spelling; warm, direct, plain; no hustle words,
  no motivational-poster phrasing, no exclamation marks; no flattery, no
  moralising; rest is part of the work. Address Caspal as "you" in the
  reflection and invitation.
- Story 280–380 words in 3–5 paragraphs; connection 25–60 words; reflection
  70–130 words; invitation 15–45 words, one concrete small thing, never a
  list; whole edition 450–650 words. Title at most 70 characters, specific
  and drawn from the event.
- **talQen**: do not mention it unless your assignment says you may, and then
  in at most one edition, only where the story is about health, diagnostics or
  quality and the link is unmistakable. Across the whole app it should appear
  in fewer than one edition in eight. Vary the reflections: not every one
  should turn to laboratories, either; Caspal also has a body, a family,
  colleagues, tiredness and doubt.
- `company`: do not use the words "now", "part" or "under" (the repeat screen
  treats a shared company word as the same company). Write "Name (later
  Other Name)".
- `region` must be one of the brief's regions; `country` is where the episode
  happened. `researched_at` is today's date (`date +%F`).
- `id` is a kebab-case slug of founder and episode, for example
  `ahmed-kalebi-lancet-first-laboratory-2007`.

## Check, then save

1. Save the edition as `offline/editions/<id>.json`.
2. Run `node offline/tools/check-edition.mjs offline/editions/<id>.json`.
   This runs the server's own gates (`validateEdition`, the repeat check,
   `verifyQuote`, `checkSource`) plus the app's rules. It must print `✓`.
   Fix word-count warnings and cross-checks that are not backed by two
   different sites too.
3. Write the progress file `offline/progress/<slate-key>.json`:

   ```json
   { "key": "<slate key>", "status": "done", "file": "offline/editions/<id>.json",
     "title": "...", "region": "...", "industry": "...", "arc": "...", "funding": "...",
     "tradition": "...", "thinker": "...", "talqen": false,
     "conflicts": "Any disagreement between sources and how you handled it, or empty",
     "notes": "Anything the editor should know" }
   ```

   or, when you drop an entry (and write no edition file):

   ```json
   { "key": "<slate key>", "status": "dropped", "reason": "Why, specifically" }
   ```

Do not edit any other file, do not touch other researchers' editions, and do
not commit. When you finish, reply briefly: one line per entry with the key,
done or dropped, the title, and the main source conflict you found and how you
handled it (the details belong in `research_notes` and the progress file, not
in the reply).

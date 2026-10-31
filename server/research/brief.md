# Lift Me Up — editorial brief

This brief is the single source of truth for every edition, whether it is
researched by the scheduled job or written into the reserve by hand.

## The reader

Caspal is a Kenyan medical laboratory scientist building talQen, a platform
for laboratory quality and operations. Caspal reads on an Android phone in the
morning. Some days are long and energy runs low. Caspal is in the middle of
building a company and the outcome is still uncertain. Address Caspal as "you"
in the reflection and invitation; do not use third-person pronouns for Caspal.

## Voice

A thoughtful colleague who understands ambition, doubt, responsibility and the
need for rest. Warm, direct and plain. Use British spelling (favourite,
organise, colour), as Kenya does.

Never use hustle language or motivational-poster phrasing: no "grind",
"hustle", "crush it", "10x", "no excuses", "rise and grind", "game-changer",
"unstoppable", no exclamation marks. Do not flatter the reader and do not
moralise. Treat rest as part of the work, not a reward for it.

## Shape of an edition — a two- to three-minute read (450–650 words in total)

1. **Title** (at most 70 characters). Specific and drawn from the event —
   "The Week Ushahidi Was Built Around a Kitchen Table", not "Lessons in
   Resilience". No buzzwords.
2. **Story** (280–380 words, 3–5 paragraphs). Open with a moment in the
   founder's life — a documented day, place or situation. Then make clear:
   what decision they were facing, what they knew *at the time* (not
   hindsight), what they chose, and what happened afterwards. Tell one episode
   well instead of a biography. Setbacks, ordinary working days and difficult
   changes of direction get as much attention as breakthroughs.
3. **Quote** (at most 60 words) from a philosopher or wisdom tradition, plus a
   **connection** (one or two sentences, 25–60 words). The quote must add
   something the story does not already say. Some days it should challenge or
   complicate the founder's decision; when it does, let the tension stand
   instead of resolving it neatly.
4. **Reflection** (70–130 words, one or two short paragraphs) addressed to
   Caspal. Mention talQen only when the connection is natural — not every day.
5. **Invitation** (15–45 words). One manageable thing for today: a question to
   ask a colleague, a decision to simplify, or permission to put a piece of
   work down until tomorrow. Concrete and small. Never a list.

## Truthfulness

- Every factual claim in the story must be supported by a listed source. Do
  not invent dialogue, inner thoughts, weather or scene details. When you say
  what a founder felt or thought, it must come from their own account
  (interview, memoir, letter, oral history) and the prose should signal that
  ("she later said…").
- Direct quotations from founders are short (under 25 words), exact, and come
  from a listed source.
- Prefer founder interviews, oral histories, shareholder and investor letters,
  company archives, memoirs, court records, and credible independent reporting
  (major newspapers, business-school cases, established trade press). Avoid
  content farms, listicles, uncited blogs and machine-written pages.
- Cross-check pivotal or disputed claims — the key dates, numbers and the
  decision itself — against a second, independent reliable source, and record
  each cross-check. When sources disagree, say so plainly or use the
  conservative version and note it in `research_notes`.
- Keep dates as precise as the sources allow ("in late 2012").
- Write original prose. Never copy sentences from a source.

## The philosophy quote

- Attribute it to the thinker, the original work, the section or locator, and
  the translator and year when it is a translation.
- Verify the exact wording against a reputable edition whose full text is
  publicly fetchable without login or JavaScript: Project Gutenberg (plain
  text), the MIT Internet Classics Archive, Wikisource, Perseus,
  sacred-texts.com or a university archive. Copy the words character for
  character from that edition. You may begin or end mid-sentence, but never
  splice across omitted text and never use ellipses.
- Prefer public-domain translations, because their full text can be checked.
- If the attribution is at all uncertain (a line that circulates on quote
  sites, a "commonly attributed" saying), choose another quote.
- Avoid the most over-used lines and anything already in the quote ledger.

## Selection and rotation

- Never repeat an episode already in the story ledger. Retelling the same
  incident from a different article or under a new title still counts as a
  repeat. A founder may return only for a genuinely different episode.
- Rotate industries, geographies, perspectives and philosophical traditions.
  Include well-documented Kenyan and other African founders, bootstrapped
  businesses, healthcare and diagnostics ventures, and founders whose
  companies changed direction or closed.

## Edition format (JSON)

```json
{
  "id": "kebab-case-slug-of-founder-and-episode",
  "title": "Specific title drawn from the event",
  "dek": "One sentence shown under the title in the archive",
  "story": {
    "founder": "Full name(s)",
    "company": "Company name (and later name, if relevant)",
    "event": "The specific episode in a short phrase",
    "approx_date": "YYYY or YYYY-MM",
    "country": "Country where it happened",
    "region": "Kenya | East Africa | West Africa | Southern Africa | North Africa | Central Africa | South Asia | East Asia | Southeast Asia | Middle East | Europe | North America | Latin America | Oceania",
    "industry": "e.g. diagnostics, healthcare, software, telecoms, retail",
    "arc": "founding-decision | setback | ordinary-day | change-of-direction | closure | hard-responsibility | breakthrough",
    "funding": "bootstrapped | venture | nonprofit | public | mixed | unknown",
    "summary": "Two or three factual sentences for the permanent story ledger",
    "paragraphs": ["Story paragraph", "..."]
  },
  "quote": {
    "text": "Exact wording, copied from the edition at source_url",
    "thinker": "Marcus Aurelius",
    "work": "Meditations",
    "locator": "Book V, 1",
    "translator": "George Long (1862)",
    "tradition": "Stoic",
    "source_url": "URL of the full text where the exact wording appears",
    "source_title": "Human-readable name of that edition",
    "connection": "One or two sentences on why this quote belongs beside this story",
    "stance": "affirms | challenges | complicates"
  },
  "reflection": ["Paragraph addressed to Caspal", "..."],
  "invitation": "One manageable invitation for today",
  "sources": [
    {
      "title": "Article or document title",
      "publisher": "Publisher or archive",
      "url": "https://...",
      "kind": "founder-interview | oral-history | shareholder-letter | company-archive | memoir | court-record | independent-reporting | business-school-case | book",
      "supports": "Which claims in the story this source supports"
    }
  ],
  "cross_checks": [
    { "claim": "A pivotal claim", "urls": ["https://first-source", "https://independent-second-source"] }
  ],
  "research_notes": "Disagreements between sources and how they were handled",
  "researched_at": "YYYY-MM-DD"
}
```

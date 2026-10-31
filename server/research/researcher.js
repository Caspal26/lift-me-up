// The Claude-backed researcher: web search and web fetch for research, then a
// structured-output call for the writing. The pipeline treats any object with
// these three methods as a researcher, which is how the simulation swaps in
// fixtures.
import { config } from '../config.js';
import { completeJson, fetchedUrls, getClient, ResearchError, runWithServerTools } from './claude.js';
import { REPEAT_SCHEMA, repeatPrompt } from './ledger.js';
import { quoteRequest, RESEARCH_SYSTEM, researchRequest, WRITER_SYSTEM, ENCOURAGEMENT_SYSTEM } from './prompts.js';
import { ENCOURAGEMENT_SCHEMA, QUOTE_OPTIONS_SCHEMA, WRITER_SCHEMA } from './schema.js';

function webTools() {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: config.claude.maxSearches },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: config.claude.maxFetches },
  ];
}

// The dossier is the last "## Episode" section the researcher wrote, even if
// a paused turn split the writing across messages.
function dossierFrom(messages, heading = '## Episode') {
  const all = messages.filter((m) => m.role === 'assistant')
    .map((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : ''))
    .join('\n');
  const at = all.lastIndexOf(heading);
  return (at === -1 ? all : all.slice(at)).trim();
}

export function createClaudeResearcher(client = getClient()) {
  return {
    name: 'claude',

    async draftEdition({ today, brief, ledgerLines, quoteLines, exclude }) {
      const { messages } = await runWithServerTools({
        max_tokens: 64000,
        output_config: { effort: config.claude.researchEffort },
        system: RESEARCH_SYSTEM,
        tools: webTools(),
        messages: [{ role: 'user', content: researchRequest({ today, brief, ledgerLines, quoteLines, exclude }) }],
      }, client);
      const dossier = dossierFrom(messages);
      if (dossier.length < 800 || !dossier.includes('## Quote candidates')) {
        throw new ResearchError('thin_dossier', 'The research step did not produce a complete dossier');
      }
      const draft = await completeJson({
        max_tokens: 16000,
        output_config: { effort: config.claude.writingEffort },
        system: WRITER_SYSTEM,
        messages: [{ role: 'user', content: `Today is ${today}.\n\nRotation brief:\n${brief.text}\n\nDossier:\n\n${dossier}` }],
      }, WRITER_SCHEMA, client);
      return { draft, dossier, openedUrls: fetchedUrls(messages) };
    },

    async judgeRepeat(story, flags) {
      const v = await completeJson({
        max_tokens: 4000,
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: repeatPrompt(story, flags) }],
      }, REPEAT_SCHEMA, client);
      return { repeat: v.repeat, matches: v.matching_piece_ids, reason: v.reason, judged_by: 'claude' };
    },

    async findMoreQuotes({ edition, tradition, avoid }) {
      const { messages } = await runWithServerTools({
        max_tokens: 32000,
        output_config: { effort: 'medium' },
        system: RESEARCH_SYSTEM,
        tools: webTools(),
        messages: [{ role: 'user', content: quoteRequest({ edition, tradition, avoid }) }],
      }, client);
      const notes = dossierFrom(messages, '## Quote candidates');
      const out = await completeJson({
        max_tokens: 8000,
        output_config: { effort: config.claude.writingEffort },
        system: WRITER_SYSTEM,
        messages: [{
          role: 'user',
          content: `Edition so far:\n${JSON.stringify({ title: edition.title, story: edition.story, reflection: edition.reflection })}\n\nQuote research:\n\n${notes}\n\nReturn quote_options for these candidates.`,
        }],
      }, QUOTE_OPTIONS_SCHEMA, client);
      return out.quote_options || [];
    },

    async encourage({ note, todayStory }) {
      const context = [
        todayStory ? `Today's edition: "${todayStory.title}" — ${todayStory.summary}` : null,
        note ? `What the reader says is weighing on them right now: ${note}` : null,
      ].filter(Boolean).join('\n\n');
      const out = await completeJson({
        max_tokens: 4000,
        output_config: { effort: config.claude.encouragementEffort },
        system: ENCOURAGEMENT_SYSTEM,
        messages: [{ role: 'user', content: context || 'No extra context today.' }],
      }, ENCOURAGEMENT_SCHEMA, client);
      return out.paragraphs.join('\n\n');
    },
  };
}

// JSON schemas for structured output. The writer returns several quote
// options so the server can fall back to the next one if verification fails.
import { ARCS, REGIONS, FUNDING, STANCES, SOURCE_KINDS } from '../editions.js';

const str = { type: 'string' };
const strings = { type: 'array', items: str };

const SOURCE = {
  type: 'object',
  properties: { title: str, publisher: str, url: str, kind: { type: 'string', enum: SOURCE_KINDS }, supports: str },
  required: ['title', 'publisher', 'url', 'kind', 'supports'],
  additionalProperties: false,
};

export const QUOTE_OPTION = {
  type: 'object',
  properties: {
    text: str, thinker: str, work: str, locator: str, translator: str, tradition: str,
    source_url: str, source_title: str, connection: str,
    stance: { type: 'string', enum: STANCES },
  },
  required: ['text', 'thinker', 'work', 'locator', 'translator', 'tradition', 'source_url', 'source_title', 'connection', 'stance'],
  additionalProperties: false,
};

export const WRITER_SCHEMA = {
  type: 'object',
  properties: {
    id: str,
    title: str,
    dek: str,
    story: {
      type: 'object',
      properties: {
        founder: str, company: str, event: str, approx_date: str, country: str,
        region: { type: 'string', enum: REGIONS },
        industry: str,
        arc: { type: 'string', enum: ARCS },
        funding: { type: 'string', enum: FUNDING },
        summary: str,
        paragraphs: strings,
      },
      required: ['founder', 'company', 'event', 'approx_date', 'country', 'region', 'industry', 'arc', 'funding', 'summary', 'paragraphs'],
      additionalProperties: false,
    },
    quote_options: { type: 'array', items: QUOTE_OPTION },
    reflection: strings,
    invitation: str,
    sources: { type: 'array', items: SOURCE },
    cross_checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { claim: str, urls: strings },
        required: ['claim', 'urls'],
        additionalProperties: false,
      },
    },
    research_notes: str,
  },
  required: ['id', 'title', 'dek', 'story', 'quote_options', 'reflection', 'invitation', 'sources', 'cross_checks', 'research_notes'],
  additionalProperties: false,
};

export const QUOTE_OPTIONS_SCHEMA = {
  type: 'object',
  properties: { quote_options: { type: 'array', items: QUOTE_OPTION } },
  required: ['quote_options'],
  additionalProperties: false,
};

export const ENCOURAGEMENT_SCHEMA = {
  type: 'object',
  properties: { paragraphs: strings },
  required: ['paragraphs'],
  additionalProperties: false,
};

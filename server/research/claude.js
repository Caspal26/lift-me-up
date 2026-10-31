import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export class ResearchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let shared;
export function getClient() {
  // Credentials come from the environment (ANTHROPIC_API_KEY) and never
  // leave the server.
  shared ??= new Anthropic({ maxRetries: 3, timeout: 20 * 60 * 1000 });
  return shared;
}

function withFallbacks(params) {
  if (config.claude.fallbacks === 'off') return params;
  return { ...params, betas: [...(params.betas || []), 'server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

// One streamed request; returns the final message.
export async function complete(params, client = getClient()) {
  const stream = client.beta.messages.stream(withFallbacks({
    model: config.claude.model,
    thinking: { type: 'adaptive' },
    ...params,
  }));
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new ResearchError('refusal', `The model declined the request (${message.stop_details?.category || 'no category'})`);
  }
  return message;
}

// A conversation that uses server tools (web search, web fetch). Long tool
// loops can pause; the paused turn is appended unchanged and resumed.
export async function runWithServerTools(params, client = getClient(), maxContinuations = 8) {
  const messages = [...params.messages];
  for (let i = 0; i <= maxContinuations; i++) {
    const message = await complete({ ...params, messages: [...messages] }, client);
    messages.push({ role: 'assistant', content: message.content });
    if (message.stop_reason !== 'pause_turn') return { message, messages };
  }
  throw new ResearchError('paused', 'Research did not finish within the allowed continuations');
}

export function textOf(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

export async function completeJson(params, schema, client = getClient()) {
  const message = await complete({
    ...params,
    output_config: { ...(params.output_config || {}), format: { type: 'json_schema', schema } },
  }, client);
  if (message.stop_reason === 'max_tokens') throw new ResearchError('truncated', 'The response hit max_tokens');
  try {
    return JSON.parse(textOf(message));
  } catch {
    throw new ResearchError('bad_json', 'The model returned invalid JSON');
  }
}

// URLs the model actually opened with web_fetch during research.
export function fetchedUrls(messages) {
  const urls = new Set();
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'server_tool_use' && b.name === 'web_fetch' && b.input?.url) urls.add(b.input.url);
      if (b.type === 'web_fetch_tool_result' && b.content?.type === 'web_fetch_result' && b.content.url) urls.add(b.content.url);
    }
  }
  return [...urls];
}

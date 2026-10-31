import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function int(name, fallback) {
  const n = Number.parseInt(env(name, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int('PORT', 8080),
  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  // Public HTTPS origin of the app, used for links in WhatsApp messages.
  publicUrl: env('PUBLIC_URL').replace(/\/+$/, ''),
  production: env('NODE_ENV') === 'production',

  passcode: env('APP_PASSCODE'),
  allowNoPasscode: env('ALLOW_NO_PASSCODE') === '1',
  sessionSecret: env('SESSION_SECRET'),

  readerName: env('READER_NAME', 'Caspal'),
  defaultTimezone: env('DEFAULT_TIMEZONE', 'Africa/Nairobi'),
  defaultDeliveryTime: env('DEFAULT_DELIVERY_TIME', '08:00'),

  // The research job starts this long before delivery so a slow run or a
  // retry still finishes in time; the reserve covers anything that doesn't.
  researchLeadMinutes: int('RESEARCH_LEAD_MINUTES', 150),
  researchGraceMinutes: int('RESEARCH_GRACE_MINUTES', 20),
  researchMaxAttempts: int('RESEARCH_MAX_ATTEMPTS', 3),
  reserveTarget: int('RESERVE_TARGET', 3),
  deliveryWindowHours: int('DELIVERY_WINDOW_HOURS', 12),
  encouragementsPerDay: int('ENCOURAGEMENTS_PER_DAY', 12),
  tickSeconds: int('TICK_SECONDS', 60),
  cronSecret: env('CRON_SECRET'),

  claude: {
    model: env('CLAUDE_MODEL', 'claude-opus-5-5'),
    researchEffort: env('CLAUDE_RESEARCH_EFFORT', 'high'),
    writingEffort: env('CLAUDE_WRITING_EFFORT', 'high'),
    encouragementEffort: env('CLAUDE_ENCOURAGEMENT_EFFORT', 'low'),
    // "default" opts into Anthropic's server-side fallback when the model
    // declines a request; "off" disables it.
    fallbacks: env('CLAUDE_FALLBACKS', 'default'),
    maxSearches: int('CLAUDE_MAX_SEARCHES', 14),
    maxFetches: int('CLAUDE_MAX_FETCHES', 18),
  },

  vapid: {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT', 'mailto:lift-me-up@localhost'),
  },

  whatsapp: {
    token: env('WHATSAPP_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    templateName: env('WHATSAPP_TEMPLATE_NAME'),
    templateLang: env('WHATSAPP_TEMPLATE_LANG', 'en'),
    // Order of the template's body variables {{1}}, {{2}}, ...
    templateParams: env('WHATSAPP_TEMPLATE_PARAMS', 'title,url').split(',').map((s) => s.trim()).filter(Boolean),
    graphVersion: env('WHATSAPP_GRAPH_VERSION', 'v23.0'),
    appSecret: env('WHATSAPP_APP_SECRET'),
    verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
    apiBase: env('WHATSAPP_API_BASE', 'https://graph.facebook.com'),
  },
};

export function researchConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.RESEARCH_ENABLED === '1');
}

export function whatsappConfigured() {
  const w = config.whatsapp;
  return Boolean(w.token && w.phoneNumberId && w.templateName);
}

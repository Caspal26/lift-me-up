// The server-side morning. Every tick reconciles the day against the clock:
// research ahead of delivery, publish at delivery time (falling back to the
// reserve), deliver once, and keep the reserve topped up during quiet hours.
// Each step is idempotent, so ticking twice, restarting, or retrying a run
// never produces a second edition or a second notification.
import { clock } from './clock.js';
import { config } from './config.js';
import { getSetting } from './db.js';
import { deliverForDate } from './delivery/deliver.js';
import { countReserve, getPublished, hasCandidateFor, publishForDate } from './editions.js';
import { jobRuns, jobsSince } from './jobs.js';
import { researchEdition } from './research/pipeline.js';
import { addDays, localDate, zonedTimeToUtc } from './time.js';

const MIN = 60 * 1000;

export function morningSchedule(db, now = clock.now()) {
  const tz = getSetting(db, 'timezone', config.defaultTimezone);
  const time = getSetting(db, 'delivery_time', config.defaultDeliveryTime);
  const today = localDate(now, tz);
  const deliverAt = zonedTimeToUtc(today, time, tz);
  const researchAt = new Date(deliverAt.getTime() - config.researchLeadMinutes * MIN);
  return { tz, time, now, today, deliverAt, researchAt };
}

// The next delivery still to come: today's if it hasn't happened, else tomorrow's.
export function nextDeliveryAt(db, now = clock.now()) {
  const s = morningSchedule(db, now);
  return s.deliverAt > now ? s.deliverAt : zonedTimeToUtc(addDays(s.today, 1), s.time, s.tz);
}

export function createScheduler({ db, researcher = null, log = console, deliverOpts = {}, verifyOpts = {} }) {
  const inFlight = new Map();
  let timer = null;
  let ticking = null;

  function startResearch(key, forDate) {
    const run = researchEdition(db, { researcher, forDate, log, verifyOpts }).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
  }

  async function reconcile({ awaitResearch }) {
    const s = morningSchedule(db);
    const events = [];
    const emit = (e) => {
      events.push(e);
      log.info?.(`[scheduler] ${e}`);
    };
    const researchKey = `research:${s.today}`;
    let published = getPublished(db, s.today);

    // 1. Research this morning's edition ahead of delivery. New attempts
    //    only start before delivery time; after that the reserve takes over.
    if (!published && researcher && s.now >= s.researchAt && s.now < s.deliverAt
      && !hasCandidateFor(db, s.today) && !inFlight.has(researchKey)) {
      const runs = jobRuns(db, 'research', s.today);
      const last = runs.at(-1);
      const cooledOff = !last || s.now - new Date(last.started_at) >= 15 * MIN;
      if (runs.length < config.researchMaxAttempts && cooledOff) {
        emit(`research started for ${s.today} (attempt ${runs.length + 1})`);
        const run = startResearch(researchKey, s.today);
        if (awaitResearch) await run;
      }
    }

    // 2. Publish at delivery time. Give a running research job a short grace
    //    period, then fall back to the reserve rather than deliver late.
    if (!published && s.now >= s.deliverAt) {
      const waiting = inFlight.has(researchKey) && s.now - s.deliverAt < config.researchGraceMinutes * MIN;
      if (!waiting) {
        const r = publishForDate(db, s.today);
        published = r.piece;
        if (r.created) emit(`published ${r.piece.id} for ${s.today} from ${r.source}`);
        else if (!r.piece) emit(`nothing to publish for ${s.today}: research unavailable and reserve empty`);
      }
    }

    // 3. Deliver, but only within the morning's window; a server that was
    //    down all day should not send this morning's notification at night.
    if (published && s.now >= s.deliverAt && s.now - s.deliverAt < config.deliveryWindowHours * 60 * MIN) {
      const d = await deliverForDate(db, s.today, deliverOpts);
      for (const r of d.results) {
        if (r.sent) emit(`delivered ${s.today} via ${r.channel} to ${r.target} (attempt ${r.attempt})`);
        else if (r.error) emit(`delivery ${r.channel} ${r.target} failed: ${r.error}`);
      }
    }

    // 4. Top up the reserve outside the morning window.
    const nearMorning = s.now >= new Date(s.researchAt.getTime() - 30 * MIN) && s.now <= new Date(s.deliverAt.getTime() + 60 * MIN);
    if (researcher && !nearMorning && inFlight.size === 0 && countReserve(db) < config.reserveTarget) {
      const recent = jobsSince(db, 'replenish', new Date(s.now.getTime() - 24 * 60 * MIN).toISOString());
      const last = recent.at(-1);
      if (recent.length < 3 && (!last || s.now - new Date(last.started_at) >= 4 * 60 * MIN)) {
        emit('reserve top-up started');
        const run = startResearch(`replenish:${s.now.toISOString()}`, null);
        if (awaitResearch) await run;
      }
    }

    return { today: s.today, now: s.now.toISOString(), events };
  }

  function tick({ awaitResearch = false } = {}) {
    // Ticks never overlap; a caller arriving mid-tick shares its result.
    ticking ??= reconcile({ awaitResearch }).finally(() => { ticking = null; });
    return ticking;
  }

  return {
    tick,
    inFlight: () => [...inFlight.keys()],
    idle: () => Promise.allSettled([...inFlight.values()]),
    start() {
      const run = () => tick().catch((err) => log.error?.(`[scheduler] tick failed: ${err.stack || err}`));
      run();
      timer = setInterval(run, config.tickSeconds * 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

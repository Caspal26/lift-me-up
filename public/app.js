// Lift Me Up — client. No framework: a small router, a handful of views, and
// a service worker that keeps opened readings available offline.

const DATA_CACHE = 'lmu-data-v1';
const PENDING_KEY = 'lmu-pending-favourites';

const $view = document.getElementById('view');
const $banner = document.getElementById('banner');
const $tabs = document.getElementById('tabs');

const state = { saved: null, installPrompt: null, today: null };

// ---- helpers ------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');
const paras = (list) => (list || []).map((p) => `<p>${esc(p)}</p>`).join('');
const multiline = (text) => paras(String(text || '').split(/\n\s*\n/));

function fmtDate(ymd, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
}

function fmtTime(iso, tz) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}

function fmtWhen(iso, tz) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}

const ICON = {
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M7.5 18a4.5 4.5 0 0 1 9 0M12 8v2.5M6.3 11.3l1.6 1.6M17.7 11.3l-1.6 1.6M12 3.5l2 2.5h-4z"/></svg>',
};

const KIND = {
  'founder-interview': 'Founder interview', 'oral-history': 'Oral history', 'shareholder-letter': 'Shareholder letter',
  'company-archive': 'Company archive', memoir: 'Memoir', 'court-record': 'Court record',
  'independent-reporting': 'Independent reporting', 'business-school-case': 'Business-school case', book: 'Book',
};

class AuthError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const fromCache = res.headers.get('x-lmu-from-cache');
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/api/login') throw new AuthError('signed out');
  if (!res.ok) {
    const err = new Error(data?.error || (data?.offline ? 'You are offline and this page has not been saved on this phone yet.' : `Request failed (${res.status})`));
    err.status = res.status;
    err.offline = Boolean(data?.offline);
    throw err;
  }
  return { data, fromCache };
}

function banner(text) {
  $banner.textContent = text || '';
  $banner.hidden = !text;
}

function showOfflineState(fromCache) {
  if (fromCache || !navigator.onLine) banner('You are offline — showing the copy kept on this phone.');
  else banner('');
}

// ---- favourites (with offline queue) ------------------------------------------

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); } catch { return {}; }
}
function writePending(p) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

async function loadSaved() {
  try {
    const { data, fromCache } = await api('/api/favourites');
    state.saved = data;
    state.savedFromCache = Boolean(fromCache);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    state.saved ??= [];
    state.savedFromCache = true;
  }
  const pending = readPending();
  for (const [date, p] of Object.entries(pending)) {
    state.saved = state.saved.filter((s) => s.date !== date);
    if (p.saved) state.saved.unshift(p.summary);
  }
  return state.saved;
}

const isSaved = (date) => (state.saved || []).some((s) => s.date === date);

async function keepOffline(date) {
  if (!('caches' in window)) return;
  try {
    const res = await fetch(`/api/editions/${date}`, { credentials: 'same-origin' });
    if (res.ok) await (await caches.open(DATA_CACHE)).put(`/api/editions/${date}`, res);
  } catch { /* already cached when it was opened */ }
}

async function toggleSave(edition, button) {
  const want = !isSaved(edition.date);
  const summary = { date: edition.date, id: edition.id, title: edition.title, dek: edition.dek, founder: edition.story.founder, company: edition.story.company, country: edition.story.country, minutes: edition.minutes, saved_at: new Date().toISOString() };
  state.saved = (state.saved || []).filter((s) => s.date !== edition.date);
  if (want) state.saved.unshift(summary);
  setSaveButton(button, want);
  if (want) keepOffline(edition.date);
  try {
    await api(`/api/favourites/${edition.date}`, { method: want ? 'PUT' : 'DELETE' });
    const pending = readPending();
    delete pending[edition.date];
    writePending(pending);
  } catch (err) {
    if (err instanceof AuthError) return go('/login');
    const pending = readPending();
    pending[edition.date] = { saved: want, summary };
    writePending(pending);
    banner('Saved on this phone. It will sync when you are back online.');
  }
}

async function flushPending() {
  const pending = readPending();
  for (const [date, p] of Object.entries(pending)) {
    try {
      await api(`/api/favourites/${date}`, { method: p.saved ? 'PUT' : 'DELETE' });
      delete pending[date];
    } catch { break; }
  }
  writePending(pending);
}

function setSaveButton(button, saved) {
  button.setAttribute('aria-pressed', String(saved));
  button.innerHTML = `${ICON.bookmark}<span>${saved ? 'Saved' : 'Save'}</span>`;
}

// ---- edition rendering --------------------------------------------------------

function quoteCaption(q) {
  const parts = [`— ${esc(q.thinker)}, <cite>${esc(q.work)}</cite>`];
  if (q.locator) parts[0] += `, ${esc(q.locator)}`;
  if (q.translator) parts.push(`translated by ${esc(q.translator)}`);
  return parts.join(' · ');
}

function stanceLabel(stance) {
  if (stance === 'challenges') return '<span class="stance">This quote pushes back</span>';
  if (stance === 'complicates') return '<span class="stance">This quote complicates it</span>';
  return '';
}

function editionHtml(e, { kicker, withLift }) {
  const year = String(e.story.approx_date || '').slice(0, 4);
  const v = e.quote.verification;
  const checkedOn = v?.checkedAt ? fmtDate(v.checkedAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const crossChecks = (e.cross_checks || []).map((c) => `<li>${esc(c.claim)} — ${(c.urls || []).map((u, i) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">source ${i + 1}</a>`).join(', ')}</li>`).join('');
  return `
    ${withLift ? `<a class="lift" href="/encourage" data-link><span class="sun">${ICON.sun}</span><span>I need encouragement now<small>A short word for a heavy moment</small></span></a>` : ''}
    <header>
      <p class="kicker">${esc(kicker)}</p>
      <h1 class="title">${esc(e.title)}</h1>
      <p class="dek">${esc(e.dek)}</p>
      <p class="meta"><span>${e.minutes} min read</span><span>${esc(e.story.founder)}</span><span>${esc(e.story.country)}${year ? `, ${esc(year)}` : ''}</span></p>
      <div class="edition-actions"><button class="btn" type="button" data-save></button></div>
    </header>
    <article class="reading">
      <section class="story">${paras(e.story.paragraphs)}</section>
      <figure class="quote">
        <blockquote><p>${esc(e.quote.text)}</p></blockquote>
        <figcaption>${quoteCaption(e.quote)}</figcaption>
        <p class="connection">${esc(e.quote.connection)}</p>
        ${stanceLabel(e.quote.stance)}
      </figure>
      <h2>For you, today</h2>
      ${paras(e.reflection)}
      <aside class="invitation"><h2>Today's invitation</h2><p>${esc(e.invitation)}</p></aside>
      <section class="sources" aria-labelledby="src-h">
        <h2 id="src-h">Sources</h2>
        <h3>The story</h3>
        <ol>${(e.sources || []).map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><span class="src-meta">${esc(s.publisher)}${s.kind ? ` · ${esc(KIND[s.kind] || s.kind)}` : ''}</span></li>`).join('')}</ol>
        <h3>The quote</h3>
        <p><a href="${esc(safeUrl(e.quote.source_url))}" target="_blank" rel="noopener noreferrer">${esc(e.quote.source_title)}</a>
          <span class="src-meta">${v?.verified ? `<span class="check">✓ Exact wording checked</span> against this edition${checkedOn ? ` on ${esc(checkedOn)}` : ''}` : 'Wording from this edition'}</span></p>
        <details>
          <summary>How this was researched</summary>
          <p class="note">Researched ${esc(fmtDate(e.researched_at, { day: 'numeric', month: 'long', year: 'numeric' }))}.${crossChecks ? ' Pivotal claims were checked against two independent sources:' : ''}</p>
          ${crossChecks ? `<ul class="note">${crossChecks}</ul>` : ''}
          ${e.research_notes ? `<p class="note">${esc(e.research_notes)}</p>` : ''}
        </details>
      </section>
    </article>
    <div class="end-actions">
      <a class="btn" href="/encourage" data-link>I need encouragement now</a>
      <a class="btn btn-quiet" href="/archive" data-link>Earlier readings</a>
    </div>`;
}

async function showEdition(e, opts) {
  if (state.saved === null) await loadSaved().catch(() => {});
  $view.innerHTML = editionHtml(e, opts);
  const button = $view.querySelector('[data-save]');
  setSaveButton(button, isSaved(e.date));
  button.addEventListener('click', () => toggleSave(e, button));
  document.title = `${e.title} · Lift Me Up`;
}

// ---- views --------------------------------------------------------------------------

async function viewToday() {
  const { data, fromCache } = await api('/api/today');
  state.today = data.today;
  showOfflineState(fromCache);
  if (data.edition) {
    return showEdition(data.edition, { kicker: `${fmtDate(data.today)} · Today's reading`, withLift: true });
  }
  const at = fmtTime(data.deliverAt, data.timezone);
  if (data.previous) {
    await showEdition(data.previous, { kicker: `${fmtDate(data.previous.date)} · Previous reading`, withLift: true });
    $view.querySelector('header').insertAdjacentHTML('beforebegin',
      `<div class="upcoming"><strong>Today's reading arrives at ${esc(at)}.</strong>Until then, here is the last one.</div>`);
    return;
  }
  $view.innerHTML = `
    <a class="lift" href="/encourage" data-link><span class="sun">${ICON.sun}</span><span>I need encouragement now<small>A short word for a heavy moment</small></span></a>
    <h1 class="page-title">Good morning</h1>
    <div class="upcoming"><strong>Your first reading arrives at ${esc(at)}.</strong>Turn on notifications in Settings so it reaches you even when the app is closed.</div>`;
  document.title = 'Lift Me Up';
}

async function viewEdition(date) {
  const { data, fromCache } = await api(`/api/editions/${date}`);
  showOfflineState(fromCache);
  const isToday = state.today === date;
  await showEdition(data, { kicker: `${fmtDate(date)}${isToday ? " · Today's reading" : ''}`, withLift: isToday });
}

function listHtml(items) {
  return `<ul class="list">${items.map((it) => `
    <li><a href="/e/${esc(it.date)}" data-link>
      <span class="day"><b>${esc(String(Number(it.date.slice(8, 10))))}</b><small>${esc(fmtDate(it.date, { weekday: 'short' }))}</small></span>
      <span><span class="t">${esc(it.title)}</span><span class="s">${esc(it.founder)} · ${esc(it.country)} · ${it.minutes} min</span></span>
    </a></li>`).join('')}</ul>`;
}

function byMonth(items) {
  const groups = new Map();
  for (const it of items) {
    const key = fmtDate(it.date, { month: 'long', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups].map(([month, list]) => `<h2 class="month">${esc(month)}</h2>${listHtml(list)}`).join('');
}

async function viewArchive() {
  const { data, fromCache } = await api('/api/archive');
  showOfflineState(fromCache);
  document.title = 'Archive · Lift Me Up';
  $view.innerHTML = `<h1 class="page-title">Archive</h1>${data.length ? byMonth(data) : '<p class="empty">Your readings will collect here, one for each morning.</p>'}`;
}

async function viewSaved() {
  const saved = await loadSaved();
  showOfflineState(state.savedFromCache);
  document.title = 'Saved · Lift Me Up';
  $view.innerHTML = `<h1 class="page-title">Saved</h1>
    ${saved.length ? listHtml(saved) : '<p class="empty">Tap Save on a reading to keep it here. Saved readings stay on this phone, so you can open them without a connection.</p>'}`;
}

async function viewEncourage() {
  document.title = 'Encouragement · Lift Me Up';
  banner(navigator.onLine ? '' : 'You are offline. A prepared reflection will appear instead of a new one.');
  $view.innerHTML = `
    <h1 class="page-title">A word for right now</h1>
    <p class="encourage-intro">This doesn't change today's reading. It's a short reflection for a heavy moment.</p>
    <form id="enc-form">
      <div class="field">
        <label for="enc-note">What's weighing on you? <span class="optional">(optional)</span></label>
        <textarea id="enc-note" maxlength="500" placeholder="A sentence is plenty."></textarea>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Lift me up</button>
    </form>
    <div id="enc-out"></div>
    <section class="earlier" id="enc-earlier"></section>`;

  const form = $view.querySelector('#enc-form');
  const out = $view.querySelector('#enc-out');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    button.textContent = 'A moment…';
    try {
      const { data } = await api('/api/encourage', { method: 'POST', body: { note: form.querySelector('#enc-note').value } });
      out.innerHTML = `<div class="encouragement" tabindex="-1">${multiline(data.text)}</div>`;
      out.firstElementChild.focus();
    } catch (err) {
      if (err instanceof AuthError) return go('/login');
      out.innerHTML = `<div class="encouragement">${multiline(OFFLINE_WORD)}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Lift me up';
    }
  });

  try {
    const { data } = await api('/api/encouragements');
    if (data.length) {
      $view.querySelector('#enc-earlier').innerHTML = `<h2 class="month">Earlier</h2>${data.map((d) => `
        <details><summary>${esc(new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d.created_at)))}</summary>
        <div class="encouragement">${multiline(d.text)}</div></details>`).join('')}`;
    }
  } catch { /* history is optional */ }
}

const OFFLINE_WORD = 'You are offline, so here is something simple. Put the phone down for a minute. Breathe out slowly, twice. Whatever felt urgent a moment ago will still be there in ten minutes, and you will meet it better rested.\n\nPick one small thing you can finish in the next hour — or give that hour to rest. Both count.';

function urlB64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function enableNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('This browser cannot receive push notifications. On Android, open the app in Chrome and install it first.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them for Lift Me Up in your phone\'s settings, then try again.');
  const reg = await navigator.serviceWorker.ready;
  const { data } = await api('/api/push/key');
  const key = urlB64ToBytes(data.publicKey);
  let sub = await reg.pushManager.getSubscription();
  const sameKey = sub?.options?.applicationServerKey
    && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
  if (sub && !sameKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function viewSettings() {
  const { data: s, fromCache } = await api('/api/settings');
  showOfflineState(fromCache);
  document.title = 'Settings · Lift Me Up';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [s.timezone];
  if (!zones.includes(s.timezone)) zones.unshift(s.timezone);
  const sub = await currentSubscription().catch(() => null);
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const research = s.research;

  $view.innerHTML = `
    <h1 class="page-title">Settings</h1>

    <section class="card">
      <h2>Morning delivery</h2>
      <p>Next reading: ${esc(fmtWhen(s.nextDeliveryAt, s.timezone))}</p>
      <form id="delivery" class="row">
        <div class="field field-time"><label for="time">Time</label><input id="time" type="time" value="${esc(s.deliveryTime)}" required></div>
        <div class="field"><label for="tz">Time zone</label><select id="tz">${zones.map((z) => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
        <div class="field field-button"><button class="btn btn-primary" type="submit">Save</button></div>
      </form>
      <p class="status" id="delivery-status" role="status"></p>
    </section>

    <section class="card">
      <h2>Notifications</h2>
      <p>The reading's title arrives on your phone at delivery time, even when the app is closed. Tap it to open that morning's reading.</p>
      <div class="row">
        <button class="btn btn-primary" id="push-on" type="button">${sub ? 'Notifications are on' : 'Turn on notifications'}</button>
        <button class="btn" id="push-test" type="button" ${sub ? '' : 'disabled'}>Send a test</button>
      </div>
      <p class="status ${sub ? 'ok' : ''}" id="push-status" role="status">${sub ? `On for this phone · ${s.push.devices} device${s.push.devices === 1 ? '' : 's'} in total` : permission === 'denied' ? 'Blocked in your phone settings.' : ''}</p>
    </section>

    ${s.whatsapp.available ? `
    <section class="card">
      <h2>WhatsApp (optional)</h2>
      ${s.whatsapp.optedIn ? `
        <p>Each morning a WhatsApp message with the title and a link goes to ${esc(s.whatsapp.phone)}. Reply STOP at any time to stop.</p>
        <div class="row"><button class="btn" id="wa-test" type="button">Send a test</button><button class="btn btn-quiet" id="wa-off" type="button">Turn off WhatsApp</button></div>` : `
        <p>Also receive the morning title and a link on WhatsApp, through the official WhatsApp Business Platform.</p>
        <form id="wa-form">
          <div class="field"><label for="wa-phone">WhatsApp number</label><input id="wa-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+254 712 345 678" required></div>
          <label class="check-row"><input type="checkbox" id="wa-consent" required><span>I agree to receive one Lift Me Up message on WhatsApp each morning. I can reply STOP or turn this off here at any time.</span></label>
          <button class="btn btn-primary" type="submit">Turn on WhatsApp</button>
        </form>`}
      <p class="status" id="wa-status" role="status"></p>
    </section>` : ''}

    <section class="card">
      <h2>Install on your phone</h2>
      ${standalone ? '<p class="status ok">Installed. Lift Me Up opens straight to today\'s reading.</p>' : `
        <p>In Chrome on Android, tap the menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>. Installed, it opens like an app and notifications are more reliable.</p>
        <button class="btn" id="install" type="button" ${state.installPrompt ? '' : 'hidden'}>Install Lift Me Up</button>`}
    </section>

    <section class="card">
      <h2>Behind the scenes</h2>
      <dl class="facts">
        <dt>Research</dt><dd>${research.configured ? 'Researched fresh before each delivery' : 'Not connected — mornings come from the reserve'}</dd>
        <dt>Reserve</dt><dd>${research.reserve} researched edition${research.reserve === 1 ? '' : 's'} ready</dd>
        ${research.lastRun ? `<dt>Last run</dt><dd>${esc(fmtWhen(research.lastRun.at, s.timezone))} · ${esc(research.lastRun.outcome || 'running')}</dd>` : ''}
      </dl>
    </section>

    <button class="btn btn-quiet btn-block" id="signout" type="button">Sign out</button>`;

  const deliveryStatus = $view.querySelector('#delivery-status');
  $view.querySelector('#delivery').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const { data } = await api('/api/settings', { method: 'PUT', body: { deliveryTime: $view.querySelector('#time').value, timezone: $view.querySelector('#tz').value } });
      deliveryStatus.className = 'status ok';
      deliveryStatus.textContent = `Saved. Next reading: ${fmtWhen(data.nextDeliveryAt, data.timezone)}.`;
    } catch (err) {
      deliveryStatus.className = 'status warn';
      deliveryStatus.textContent = err.message;
    }
  });

  const pushStatus = $view.querySelector('#push-status');
  $view.querySelector('#push-on').addEventListener('click', async (ev) => {
    const button = ev.currentTarget;
    button.disabled = true;
    try {
      await enableNotifications();
      pushStatus.className = 'status ok';
      pushStatus.textContent = 'Notifications are on for this phone.';
      button.textContent = 'Notifications are on';
      $view.querySelector('#push-test').disabled = false;
    } catch (err) {
      pushStatus.className = 'status warn';
      pushStatus.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
  $view.querySelector('#push-test').addEventListener('click', async () => {
    try {
      const { data } = await api('/api/push/test', { method: 'POST' });
      pushStatus.className = data.sent ? 'status ok' : 'status warn';
      pushStatus.textContent = data.sent ? 'Test sent. It should appear in a few seconds.' : 'The test could not be delivered. Try turning notifications on again.';
    } catch (err) {
      pushStatus.className = 'status warn';
      pushStatus.textContent = err.message;
    }
  });

  const waStatus = $view.querySelector('#wa-status');
  $view.querySelector('#wa-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/whatsapp/optin', { method: 'POST', body: { phone: $view.querySelector('#wa-phone').value, consent: $view.querySelector('#wa-consent').checked } });
      viewSettings();
    } catch (err) {
      waStatus.className = 'status warn';
      waStatus.textContent = err.message;
    }
  });
  $view.querySelector('#wa-off')?.addEventListener('click', async () => {
    await api('/api/whatsapp/optout', { method: 'POST' });
    viewSettings();
  });
  $view.querySelector('#wa-test')?.addEventListener('click', async () => {
    try {
      await api('/api/whatsapp/test', { method: 'POST' });
      waStatus.className = 'status ok';
      waStatus.textContent = 'Test sent to WhatsApp.';
    } catch (err) {
      waStatus.className = 'status warn';
      waStatus.textContent = err.message;
    }
  });

  $view.querySelector('#install')?.addEventListener('click', async () => {
    const prompt = state.installPrompt;
    if (!prompt) return;
    state.installPrompt = null;
    await prompt.prompt();
    viewSettings();
  });

  $view.querySelector('#signout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    go('/login');
  });
}

async function viewLogin() {
  document.title = 'Sign in · Lift Me Up';
  banner('');
  $tabs.hidden = true;
  $view.innerHTML = `
    <div class="signin">
      <img class="mark" src="/icons/icon-192.png" alt="">
      <h1>Lift Me Up</h1>
      <p>Enter your passcode to open your readings.</p>
      <form id="login">
        <div class="field"><label for="passcode">Passcode</label><input id="passcode" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary btn-block" type="submit">Open</button>
        <p class="error" id="login-error" role="alert"></p>
      </form>
    </div>`;
  $view.querySelector('#passcode').focus();
  $view.querySelector('#login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { passcode: $view.querySelector('#passcode').value } });
      $tabs.hidden = false;
      const next = new URLSearchParams(location.search).get('next');
      go(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      $view.querySelector('#login-error').textContent = err.message;
    }
  });
}

// ---- router ------------------------------------------------------------------

const ROUTES = [
  [/^\/$/, viewToday, 'today'],
  [/^\/e\/(\d{4}-\d{2}-\d{2})$/, viewEdition, 'archive'],
  [/^\/archive$/, viewArchive, 'archive'],
  [/^\/saved$/, viewSaved, 'saved'],
  [/^\/settings$/, viewSettings, 'settings'],
  [/^\/encourage$/, viewEncourage, 'today'],
  [/^\/login$/, viewLogin, null],
];

async function render() {
  const path = location.pathname;
  const [pattern, view, tab] = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const args = path.match(pattern)?.slice(1) || [];
  if (tab) $tabs.hidden = false;
  for (const a of $tabs.querySelectorAll('a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  try {
    await view(...args);
  } catch (err) {
    if (err instanceof AuthError) return go(`/login?next=${encodeURIComponent(path)}`, { replace: true });
    $view.innerHTML = `<h1 class="page-title">Not available</h1><p class="empty">${esc(err.message)}</p>
      <p><a href="/" data-link>Back to today's reading</a></p>`;
  }
}

function go(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  window.scrollTo(0, 0);
  render().then(() => $view.focus({ preventScroll: true }));
}

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-link]');
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  go(a.getAttribute('href'));
});

window.addEventListener('popstate', render);
window.addEventListener('online', () => { banner(''); flushPending(); });
window.addEventListener('offline', () => banner('You are offline. Readings you have opened are still here.'));
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  state.installPrompt = ev;
  document.getElementById('install')?.removeAttribute('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  // A tapped notification may ask an already-open window to show a reading.
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'open') go(new URL(ev.data.url, location.origin).pathname);
  });
}

flushPending();
render();

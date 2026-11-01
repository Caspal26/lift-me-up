// Lift Me Up — offline Android client. The PWA's views and markup
// (public/app.js), with the server replaced by local.js: readings are
// bundled, favourites and settings stay on the phone, and the morning
// notification is scheduled natively by the DailyReading plugin.
import { AppPlugin, DailyReading, localApi, syncNotifications } from './local.js';

const $view = document.getElementById('view');
const $banner = document.getElementById('banner');
const $tabs = document.getElementById('tabs');

const state = { saved: null, today: null };

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

async function api(path, opts) {
  return { data: await localApi(path, opts) };
}

function banner(text) {
  $banner.textContent = text || '';
  $banner.hidden = !text;
}

// ---- favourites (kept on the phone) ---------------------------------------------

async function loadSaved() {
  state.saved = (await api('/api/favourites')).data;
  return state.saved;
}

const isSaved = (date) => (state.saved || []).some((s) => s.date === date);

async function toggleSave(edition, button) {
  const want = !isSaved(edition.date);
  setSaveButton(button, want);
  try {
    await api(`/api/favourites/${edition.date}`, { method: want ? 'PUT' : 'DELETE' });
    await loadSaved();
  } catch (err) {
    setSaveButton(button, !want);
    banner(err.message);
  }
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
        <p class="note">Links open in your browser and need a connection; the reading itself is stored on this phone.</p>
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
  const { data } = await api('/api/today');
  state.today = data.today;
  banner('');
  if (data.edition) {
    return showEdition(data.edition, { kicker: `${fmtDate(data.today)} · Today's reading`, withLift: true });
  }
  const at = fmtTime(data.deliverAt, data.timezone);
  if (data.previous) {
    await showEdition(data.previous, { kicker: `${fmtDate(data.previous.date)} · Previous reading`, withLift: true });
    const note = data.finished
      ? `<div class="upcoming"><strong>All ${data.total} readings in this app have opened.</strong>They are all in the Archive. An update to the app can add more.</div>`
      : `<div class="upcoming"><strong>Today's reading arrives at ${esc(at)}.</strong>Until then, here is the last one.</div>`;
    $view.querySelector('header').insertAdjacentHTML('beforebegin', note);
    return;
  }
  $view.innerHTML = `
    <a class="lift" href="/encourage" data-link><span class="sun">${ICON.sun}</span><span>I need encouragement now<small>A short word for a heavy moment</small></span></a>
    <h1 class="page-title">Good morning</h1>
    <div class="upcoming"><strong>Your first reading arrives at ${esc(at)}.</strong>Allow notifications in Settings so it reaches you even when the app is closed.</div>`;
  document.title = 'Lift Me Up';
}

async function viewEdition(date) {
  const { data } = await api(`/api/editions/${date}`);
  banner('');
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
  const { data } = await api('/api/archive');
  banner('');
  document.title = 'Archive · Lift Me Up';
  $view.innerHTML = `<h1 class="page-title">Archive</h1>${data.length ? byMonth(data) : '<p class="empty">Your readings will collect here, one for each morning.</p>'}`;
}

async function viewSaved() {
  const saved = await loadSaved();
  banner('');
  document.title = 'Saved · Lift Me Up';
  $view.innerHTML = `<h1 class="page-title">Saved</h1>
    ${saved.length ? listHtml(saved) : '<p class="empty">Tap Save on a reading to keep it here.</p>'}`;
}

async function viewEncourage() {
  document.title = 'Encouragement · Lift Me Up';
  banner('');
  $view.innerHTML = `
    <h1 class="page-title">A word for right now</h1>
    <p class="encourage-intro">This doesn't change today's reading. It's a short reflection for a heavy moment, chosen from a prepared set; a few words about what is weighing on you help pick the one that fits.</p>
    <form id="enc-form">
      <div class="field">
        <label for="enc-note">What's weighing on you? <span class="optional">(optional, stays on this phone)</span></label>
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
    try {
      const { data } = await api('/api/encourage', { method: 'POST', body: { note: form.querySelector('#enc-note').value } });
      out.innerHTML = `<div class="encouragement" tabindex="-1">${multiline(data.text)}</div>`;
      out.firstElementChild.focus();
    } finally {
      button.disabled = false;
    }
  });

  const { data } = await api('/api/encouragements');
  if (data.length) {
    $view.querySelector('#enc-earlier').innerHTML = `<h2 class="month">Earlier</h2>${data.map((d) => `
      <details><summary>${esc(new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d.created_at)))}</summary>
      <div class="encouragement">${multiline(d.text)}</div></details>`).join('')}`;
  }
}

function notificationStatus(n) {
  if (!n) return { text: 'Notifications are only available in the Android app.', cls: '' };
  if (n.permission === 'denied' || !n.enabled) return { text: 'Notifications are turned off for Lift Me Up in your phone settings.', cls: 'warn' };
  if (n.permission === 'prompt') return { text: 'Not yet allowed. Tap below so the morning title can reach you.', cls: '' };
  return { text: n.exact ? 'On. The title arrives at your chosen time, even when the app is closed.' : 'On, though Android may deliver it a few minutes late.', cls: 'ok' };
}

async function viewSettings() {
  const { data: s } = await api('/api/settings');
  banner('');
  document.title = 'Settings · Lift Me Up';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [s.timezone];
  if (!zones.includes(s.timezone)) zones.unshift(s.timezone);
  const n = s.notifications;
  const ns = notificationStatus(n);
  const allowed = n && n.permission === 'granted' && n.enabled;

  $view.innerHTML = `
    <h1 class="page-title">Settings</h1>

    <section class="card">
      <h2>Morning delivery</h2>
      <p id="next-line">${s.nextDeliveryAt ? `Next reading: ${esc(fmtWhen(s.nextDeliveryAt, s.timezone))}` : `All ${s.total} readings have opened.`}</p>
      <form id="delivery" class="row">
        <div class="field field-time"><label for="time">Time</label><input id="time" type="time" value="${esc(s.deliveryTime)}" required></div>
        <div class="field"><label for="tz">Time zone</label><select id="tz">${zones.map((z) => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
        <div class="field field-button"><button class="btn btn-primary" type="submit">Save</button></div>
      </form>
      <p class="status" id="delivery-status" role="status"></p>
    </section>

    <section class="card">
      <h2>Notifications</h2>
      <p>Each morning the reading's title appears on your phone at delivery time. Tap it to open that morning's reading.</p>
      <div class="row">
        ${n && !allowed ? `<button class="btn btn-primary" id="push-on" type="button">${n.permission === 'denied' || (n.permission === 'granted' && !n.enabled) ? 'Open phone settings' : 'Allow notifications'}</button>` : ''}
        <button class="btn" id="push-test" type="button" ${allowed ? '' : 'disabled'}>Send a test</button>
      </div>
      <p class="status ${ns.cls}" id="push-status" role="status">${esc(ns.text)}</p>
    </section>

    <section class="card">
      <h2>Your readings</h2>
      <dl class="facts">
        <dt>In this app</dt><dd>${s.total} researched readings, stored on this phone</dd>
        <dt>Opened so far</dt><dd>${s.opened} of ${s.total}</dd>
        <dt>Started</dt><dd>${esc(fmtDate(s.startDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</dd>
        <dt>Last one opens</dt><dd>${esc(fmtDate(s.lastDate, { day: 'numeric', month: 'long', year: 'numeric' }))}</dd>
      </dl>
      <p class="note">Everything works without a connection. Nothing you save or write here leaves the phone.</p>
    </section>`;

  const deliveryStatus = $view.querySelector('#delivery-status');
  $view.querySelector('#delivery').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const { data } = await api('/api/settings', { method: 'PUT', body: { deliveryTime: $view.querySelector('#time').value, timezone: $view.querySelector('#tz').value } });
      deliveryStatus.className = 'status ok';
      deliveryStatus.textContent = data.nextDeliveryAt ? `Saved. Next reading: ${fmtWhen(data.nextDeliveryAt, data.timezone)}.` : 'Saved.';
      $view.querySelector('#next-line').textContent = data.nextDeliveryAt ? `Next reading: ${fmtWhen(data.nextDeliveryAt, data.timezone)}` : `All ${data.total} readings have opened.`;
    } catch (err) {
      deliveryStatus.className = 'status warn';
      deliveryStatus.textContent = err.message;
    }
  });

  const pushStatus = $view.querySelector('#push-status');
  $view.querySelector('#push-on')?.addEventListener('click', async () => {
    if (n.permission === 'prompt') {
      await DailyReading.requestNotificationPermission().catch(() => null);
      await syncNotifications();
      viewSettings();
    } else {
      await DailyReading.openNotificationSettings().catch(() => null);
    }
  });
  $view.querySelector('#push-test').addEventListener('click', async () => {
    const { data } = await api('/api/today');
    const date = data.edition?.date || data.previous?.date;
    const r = DailyReading && date ? await DailyReading.sendTest({ date }).catch(() => null) : null;
    pushStatus.className = r?.sent ? 'status ok' : 'status warn';
    pushStatus.textContent = r?.sent ? 'Test sent. Look at the top of your screen.' : 'The test could not be shown. Check that notifications are allowed.';
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
];

async function render() {
  const path = location.pathname;
  const [pattern, view, tab] = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const args = path.match(pattern)?.slice(1) || [];
  $tabs.hidden = false;
  for (const a of $tabs.querySelectorAll('a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  try {
    await view(...args);
  } catch (err) {
    $view.innerHTML = `<h1 class="page-title">Not available</h1><p class="empty">${esc(err.message)}</p>
      <p><a href="/" data-link>Back to today's reading</a></p>`;
  }
}

function go(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  window.scrollTo(0, 0);
  render().then(() => $view.focus({ preventScroll: true }));
}

// A tapped notification opens its morning's reading.
function openReading(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  go(date === state.today ? '/' : `/e/${date}`);
}

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-link]');
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  go(a.getAttribute('href'));
});

window.addEventListener('popstate', render);

async function start() {
  if (location.pathname === '/index.html') history.replaceState({}, '', '/');
  await render();
  if (!DailyReading) return;
  DailyReading.addListener('readingOpened', ({ date }) => openReading(date));
  AppPlugin.addListener('backButton', ({ canGoBack }) => (canGoBack && location.pathname !== '/' ? history.back() : AppPlugin.exitApp()));
  // Back in the app after a while: the morning may have turned over.
  AppPlugin.addListener('appStateChange', ({ isActive }) => { if (isActive && location.pathname === '/') render(); });
  const launch = await DailyReading.takeLaunchDate().catch(() => null);
  if (launch?.date) openReading(launch.date);
  const status = await syncNotifications();
  // Ask once, after the first reading is on screen.
  if (status?.permission === 'prompt' && !localStorage.getItem('lmu.asked')) {
    localStorage.setItem('lmu.asked', '1');
    await DailyReading.requestNotificationPermission().catch(() => null);
    await syncNotifications();
  }
}

start();

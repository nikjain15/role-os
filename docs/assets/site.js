// Supabase config is loaded from assets/config.js (gitignored, injected at deploy time).
// See assets/config.example.js for the expected shape.
window.SUPABASE_URL = window.SUPABASE_URL || '';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
window.CHAT_ENDPOINT = window.CHAT_ENDPOINT || null;

// ===== Load core data.json (used on every page) =====
const DATA_BASE = /\/(case-study|faq|confirmed|privacy|roles)\//.test(window.location.pathname) ? '../' : './';
// Live stats straight from Supabase (public_index_stats RPC) — real-time, no
// rebuild. Memoized; returns null on any failure so we fall back to the static
// JSON (which the pipeline still emits as a baseline/fallback).
let _livePromise;
function loadLiveStats() {
  if (_livePromise !== undefined) return _livePromise;
  _livePromise = (async () => {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    try {
      const r = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/public_index_stats`, {
        method: 'POST',
        headers: {
          apikey: window.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const s = await r.json();
      return s && typeof s.totalRoles === 'number' ? s : null;
    } catch { return null; }
  })();
  return _livePromise;
}

async function loadData() {
  const r = await fetch(DATA_BASE + 'data.json?t=' + Date.now()).catch(() => null);
  const base = r && r.ok ? await r.json() : null;
  const live = await loadLiveStats();
  if (!base && !live) return null;
  const d = base || { headline: {}, distributions: {}, funnel: [], cost: {}, gaps: [] };
  if (live) {
    d.headline = d.headline || {};
    d.headline.structured = live.totalRoles;
    d.headline.companies = live.totalCompanies;
    d.headline.mustHavesExtracted = live.mustHaves;
    d.distributions = Object.assign({}, d.distributions, live.distributions);
  }
  return d;
}
async function loadDataset() {
  const r = await fetch(DATA_BASE + 'dataset.json?t=' + Date.now()).catch(() => null);
  const base = r && r.ok ? await r.json() : null;
  const live = await loadLiveStats();
  if (!base && !live) return null;
  const ds = base || {};
  if (live) {
    ds.totalCompanies = live.totalCompanies;
    ds.totalRoles = live.totalRoles;
    ds.topCompanies = live.topCompanies;
    ds.allCompanies = live.allCompanies;
    ds.archetypes = live.archetypes;
  }
  return ds;
}

// ===== Homepage init =====
async function initHome() {
  const d = await loadData();
  const ds = await loadDataset();
  if (!d) return;

  // Fill any <span data-fill="..."> placeholders with live numbers
  const companies = ds ? ds.totalCompanies : d.headline.companies;
  const roles = d.headline.structured;
  document.querySelectorAll('[data-fill]').forEach(el => {
    const key = el.dataset.fill;
    if (key === 'companies') el.textContent = companies;
    else if (key === 'roles') el.textContent = roles;
    else if (key === 'companies-minus-4') el.textContent = Math.max(companies - 4, 0);
  });

  // Stats row — three numbers (dropped salary + cost per tone direction)
  const statsEl = document.getElementById('stats');
  if (statsEl) {
    const stats = [
      [ds ? ds.totalCompanies : d.headline.companies, 'Companies we’re tracking'],
      [d.headline.structured, 'Roles RO has read'],
      [d.headline.mustHavesExtracted.toLocaleString(), 'Requirements extracted, verbatim'],
    ];
    statsEl.innerHTML = stats.map(([n, l]) =>
      `<div class="stat"><div class="num">${n}</div><div class="lbl">${l}</div></div>`
    ).join('');
  }

  // Company treemap — top 12 by role count, tiered visually (filled / outlined / subtle)
  const colEl = document.getElementById('company-list');
  if (colEl && ds) {
    const top = ds.topCompanies.slice(0, 12);
    const large = top.slice(0, 2);
    const med = top.slice(2, 6);
    const small = top.slice(6, 12);
    const esc = s => String(s).replace(/"/g, '&quot;');
    const cell = (cls, c, sizeMod = '') =>
      `<button type="button" class="treemap-cell ${sizeMod} ${cls}" data-company="${esc(c.name)}" data-count="${c.count}"><span class="tm-name">${c.name}</span><span class="tm-count">${c.count}${sizeMod === 'large' ? ' roles' : ''}</span></button>`;
    colEl.innerHTML = `
      <div class="treemap">
        <div class="treemap-left" style="grid-template-rows: ${large.map(c => c.count + 'fr').join(' ')}">
          ${large.map(c => cell('tm-filled', c, 'large')).join('')}
        </div>
        <div class="treemap-right-col">
          <div class="treemap-mid" style="grid-template-columns: ${med.slice(0,2).map(c => c.count + 'fr').join(' ')};">
            ${med.slice(0,2).map(c => cell('tm-outlined', c)).join('')}
          </div>
          <div class="treemap-mid" style="grid-template-columns: ${med.slice(2,4).map(c => c.count + 'fr').join(' ')};">
            ${med.slice(2,4).map(c => cell('tm-outlined', c)).join('')}
          </div>
          <div class="treemap-small-grid">
            ${small.map(c => cell('tm-subtle', c, 'small')).join('')}
          </div>
        </div>
      </div>
      <a class="treemap-more" id="see-all-companies" href="#" aria-disabled="true">See all ${ds.totalCompanies} →</a>
    `;

    // 'See all' is a placeholder — the dedicated page is being built separately.
    // Block clicks so it doesn't navigate or render anything inline.
    document.getElementById('see-all-companies')?.addEventListener('click', (e) => e.preventDefault());

    // Click any company cell → prefill chat
    colEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-company]');
      if (!t) return;
      askRoAbout(`Tell me about ${t.dataset.company} — what roles are in the Index and what do they look like?`);
    });
  }

  // Archetype list — simple rows with tier-colored percentage (matches prod layout).
  // Homepage shows only the top few so the panel stays scannable; the full list
  // lives on the dedicated /roles page behind the "See all" link.
  const aEl = document.getElementById('archetype-list');
  if (aEl && ds) {
    const ARCHETYPE_PREVIEW = 10;
    const all = ds.archetypes || [];
    aEl.innerHTML = renderArchetypeRows(all.slice(0, ARCHETYPE_PREVIEW));
    if (all.length > ARCHETYPE_PREVIEW) {
      aEl.insertAdjacentHTML('afterend',
        `<a class="treemap-more browse-more" href="roles/">See all ${all.length} role types →</a>`);
    }
    aEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-archetype]');
      if (!t) return;
      askRoAbout(`Show me ${t.dataset.archetype} roles in the Index`);
    });
  }

  // Distributions
  if (d.distributions) {
    renderDist('dist-seniority', d.distributions.seniority);
    renderDist('dist-years', d.distributions.yearsRequired);
    renderDist('dist-location', d.distributions.locationType);
    renderDist('dist-visa', d.distributions.visaSponsorship);
  }

  // Cost line
  const cost = document.getElementById('cost-line');
  if (cost) {
    const perJD = d.cost.total && d.headline.structured ? (d.cost.total / d.headline.structured).toFixed(4) : '—';
    cost.textContent = `$${d.cost.total.toFixed(2)} total · $${perJD} per JD · ${d.cost.runs} pipeline run(s)`;
  }

  // Footer timestamp
  const ts = document.getElementById('ts');
  if (ts) ts.textContent = new Date(d.generatedAt).toLocaleString();
}

function renderDist(id, obj) {
  const el = document.getElementById(id);
  if (!el || !obj) return;
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...entries.map(([, v]) => v), 1);
  el.innerHTML = entries.map(([k, v]) =>
    `<div class="item"><span>${k}</span><div class="bar"><div style="width:${(v/max)*100}%"></div></div><span class="v">${v}</span></div>`
  ).join('') || '<div style="color:var(--ink-3);font-size:13px">(no data yet)</div>';
}

// ===== Archetype rows (shared by homepage preview + /roles full list) =====
function renderArchetypeRows(list) {
  const tierClass = (pct) => pct >= 15 ? 'tier-1' : pct >= 5 ? 'tier-2' : 'tier-3';
  return (list || []).map(a =>
    `<button type="button" class="list-row ${tierClass(a.pct)}" data-archetype="${a.name.replace(/"/g, '&quot;')}"><span class="name">${a.name}</span><span class="val">${a.count} · ${a.pct}%</span></button>`
  ).join('');
}

// ===== Role-types page init (/roles) — the full archetype breakdown =====
async function initRoles() {
  const el = document.getElementById('all-archetypes');
  if (!el) return;
  const ds = await loadDataset();
  const all = ds?.archetypes || [];
  if (!all.length) { el.innerHTML = '<div style="color:var(--ink-3);font-size:14px">(no data yet)</div>'; return; }
  el.innerHTML = renderArchetypeRows(all);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-archetype]');
    if (!t) return;
    // No chat on this page — send the question to the homepage chat.
    window.location.href = '../#meet-ro';
  });
  const countEl = document.getElementById('archetype-count');
  if (countEl) countEl.textContent = all.length;
}

// ===== Case-study sub-page init =====
async function initCaseStudy() {
  const d = await loadData();
  if (!d) return;
  const funnelEl = document.getElementById('funnel');
  if (funnelEl) {
    const maxF = Math.max(...d.funnel.map(s => s.count), 1);
    funnelEl.innerHTML = d.funnel.map(s => {
      const pct = (s.count / maxF) * 100;
      const status = s.status || 'done';
      return `<div class="row" data-status="${status}">
        <div class="stage"><span class="marker"></span>${s.stage}</div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <div class="count">${s.count}</div>
      </div>`;
    }).join('');
  }
  const ts = document.getElementById('ts');
  if (ts) ts.textContent = new Date(d.generatedAt).toLocaleString();
}

// ===== Waitlist =====
async function submitWaitlist(form, msgEl, source, pendingTab) {
  const email = form.email.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msgEl.textContent = 'Please enter a valid email.'; msgEl.className = 'form-msg error';
    if (pendingTab) pendingTab.close();
    return;
  }
  msgEl.textContent = 'Joining…'; msgEl.className = 'form-msg';
  try {
    const r = await fetch(`${window.SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ email, source })
    });
    if (r.ok) {
      msgEl.textContent = "You're on the list."; msgEl.className = 'form-msg success'; form.reset();
      const url = 'confirmed/?email=' + encodeURIComponent(email);
      if (pendingTab && !pendingTab.closed) pendingTab.location.href = url;
      else window.location.href = url;
    }
    else {
      const err = await r.text();
      const isDup = err.includes('duplicate');
      msgEl.textContent = isDup ? "You're already on the list." : 'Something went wrong. Try again?';
      msgEl.className = 'form-msg error';
      if (pendingTab && !pendingTab.closed) {
        if (isDup) pendingTab.location.href = 'confirmed/?email=' + encodeURIComponent(email);
        else pendingTab.close();
      }
    }
  } catch {
    msgEl.textContent = 'Network error. Try again?'; msgEl.className = 'form-msg error';
    if (pendingTab && !pendingTab.closed) pendingTab.close();
  }
}
document.querySelectorAll('form.waitlist-form').forEach(form => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Open the tab synchronously inside the submit handler so the popup blocker allows it.
    const pendingTab = window.open('about:blank', '_blank');
    const msgId = form.id === 'waitlist-hero' ? 'msg-hero' : 'msg-bottom';
    submitWaitlist(e.target, document.getElementById(msgId), form.id.replace('waitlist-', ''), pendingTab);
  });
});

// ===== Helper: jump to RO chat with a pre-filled question =====
function askRoAbout(question) {
  const input = document.getElementById('chat-input');
  const form = document.getElementById('chat-form');
  const section = document.getElementById('meet-ro');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (input && form) {
    input.value = question;
    // Submit shortly after scroll begins so the answer appears in view
    setTimeout(() => form.requestSubmit(), 350);
  }
}

// ===== Chat (embedded panel — single mode, just about the Index) =====
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
let chatHistory = [];

if (chatLog) {
  function addMsg(text, who, citations) {
    const el = document.createElement('div');
    el.className = `chat-msg ${who}`;
    el.textContent = text;
    chatLog.appendChild(el);
    if (Array.isArray(citations) && citations.length) {
      const cite = document.createElement('div');
      cite.className = 'chat-citations';
      cite.innerHTML = '<span class="cite-label">Sources RO read:</span> ' +
        citations.slice(0, 6).map(c => {
          const label = c.name || c.slug;
          return c.url
            ? `<a class="cite-chip" href="${c.url}" target="_blank" rel="noopener">${label}</a>`
            : `<span class="cite-chip">${label}</span>`;
        }).join(' ');
      chatLog.appendChild(cite);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  addMsg("Hi — I'm RO. Ask me anything about the senior roles in the Index — who's hiring, what they pay (when they say), who sponsors visas, which archetypes are common. I'll answer from what I've actually read.", 'bot');

  document.querySelectorAll('.chat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('chat-input').value = chip.dataset.q;
      chatForm.requestSubmit();
    });
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    addMsg(text, 'user');
    input.value = '';
    chatHistory.push({ role: 'user', content: text });

    if (!window.CHAT_ENDPOINT) {
      setTimeout(() => addMsg("RO is in private beta — the live chat opens for waitlist users in the coming weeks. Drop your email and we'll let you know when it's your turn.", 'bot'), 400);
      return;
    }
    try {
      const r = await fetch(window.CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory })
      });
      const data = await r.json();
      if (data.reply) {
        chatHistory.push({ role: 'assistant', content: data.reply });
        addMsg(data.reply, 'bot', data.citations);
      } else {
        addMsg('Something went wrong. Try again?', 'bot');
      }
    } catch {
      addMsg('Network error. Try again?', 'bot');
    }
  });
}

// ===== Route =====
if (document.getElementById('stats')) initHome();
if (document.getElementById('funnel')) initCaseStudy();
if (document.getElementById('all-archetypes')) initRoles();

// Any other page with data-fill spans (e.g. faq) — fill them from live stats too,
// so every surface shows the real-time corpus number, not a baked-in fallback.
if (!document.getElementById('stats') && document.querySelector('[data-fill]')) {
  (async () => {
    const [d, ds] = await Promise.all([loadData(), loadDataset()]);
    const companies = ds?.totalCompanies ?? d?.headline?.companies;
    const roles = d?.headline?.structured ?? ds?.totalRoles;
    document.querySelectorAll('[data-fill]').forEach((el) => {
      const k = el.dataset.fill;
      if (k === 'companies' && companies != null) el.textContent = companies;
      else if (k === 'roles' && roles != null) el.textContent = roles;
      else if (k === 'companies-minus-4' && companies != null) el.textContent = Math.max(companies - 4, 0);
    });
  })();
}

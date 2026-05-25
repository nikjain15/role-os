// Supabase config (anon key safe — RLS = insert-only)
window.SUPABASE_URL = 'https://REDACTED.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbW9mZ2tsb3dtZGxqZ3h6ZG1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2Njg1NDIsImV4cCI6MjA5NTI0NDU0Mn0.3ZmjH1S5oEe9acipRdGmEyt0n4DB-76IyHYq6CiJrPw';
window.CHAT_ENDPOINT = null;

// ===== Load core data.json (used on every page) =====
const DATA_BASE = window.location.pathname.includes('/case-study/') ? '../' : './';
async function loadData() {
  const r = await fetch(DATA_BASE + 'data.json?t=' + Date.now()).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
}
async function loadDataset() {
  const r = await fetch(DATA_BASE + 'dataset.json?t=' + Date.now()).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json();
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
    const cell = (cls, c, sizeMod = '') =>
      `<div class="treemap-cell ${sizeMod} ${cls}"><span class="tm-name">${c.name}</span><span class="tm-count">${c.count}${sizeMod === 'large' ? ' roles' : ''}</span></div>`;
    colEl.innerHTML = `
      <div class="treemap">
        <div class="treemap-left" style="grid-template-rows: ${large.map(c => c.count + 'fr').join(' ')}">
          ${large.map(c => cell('tm-filled', c, 'large')).join('')}
        </div>
        <div style="display: grid; gap: 6px; grid-template-rows: 1fr 1fr;">
          <div class="treemap-mid" style="grid-template-columns: ${med.slice(0,2).map(c => c.count + 'fr').join(' ')}; gap: 6px;">
            ${med.slice(0,2).map(c => cell('tm-outlined', c)).join('')}
          </div>
          <div class="treemap-mid" style="grid-template-columns: ${med.slice(2,4).map(c => c.count + 'fr').join(' ')}; gap: 6px;">
            ${med.slice(2,4).map(c => cell('tm-outlined', c)).join('')}
          </div>
          <div class="treemap-right" style="grid-template-columns: repeat(3, 1fr); grid-template-rows: 1fr 1fr; grid-row: span 2; margin-top: 6px; gap: 6px;">
            ${small.map(c => cell('tm-subtle', c, 'small')).join('')}
          </div>
        </div>
      </div>
      <div class="treemap-more">See all ${ds.totalCompanies} →</div>
    `;
  }

  // Archetype list
  const aEl = document.getElementById('archetype-list');
  if (aEl && ds) {
    aEl.innerHTML = ds.archetypes.map(a =>
      `<div class="list-row"><span class="name">${a.name}</span><span class="val">${a.count} · ${a.pct}%</span></div>`
    ).join('');
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
async function submitWaitlist(form, msgEl, source) {
  const email = form.email.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msgEl.textContent = 'Please enter a valid email.'; msgEl.className = 'form-msg error'; return;
  }
  msgEl.textContent = 'Joining…'; msgEl.className = 'form-msg';
  try {
    const r = await fetch(`${window.SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: { 'apikey': window.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ email, source })
    });
    if (r.ok) { msgEl.textContent = "You're on the list. We'll be in touch."; msgEl.className = 'form-msg success'; form.reset(); }
    else { const err = await r.text(); msgEl.textContent = err.includes('duplicate') ? "You're already on the list." : 'Something went wrong. Try again?'; msgEl.className = 'form-msg error'; }
  } catch { msgEl.textContent = 'Network error. Try again?'; msgEl.className = 'form-msg error'; }
}
document.querySelectorAll('form.waitlist-form').forEach(form => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const msgId = form.id === 'waitlist-hero' ? 'msg-hero' : 'msg-bottom';
    submitWaitlist(e.target, document.getElementById(msgId), form.id.replace('waitlist-', ''));
  });
});

// ===== Chat (embedded panel — single mode, just about the Index) =====
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
let chatHistory = [];

if (chatLog) {
  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = `chat-msg ${who}`;
    el.textContent = text;
    chatLog.appendChild(el);
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
        addMsg(data.reply, 'bot');
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

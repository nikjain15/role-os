#!/usr/bin/env node
/**
 * 03-extract-jd.mjs — Turn raw JD markdown into structured JSON via Claude.
 *
 * Reads:  jds-raw/{company}/{role}.md
 * Writes: jds-structured/{company}/{role}.json
 *
 * Idempotent: skips files that already exist on disk unless --force.
 *
 * Cost: roughly $0.005–$0.01 per JD on Claude Sonnet 4.6 with caching.
 *
 * Usage:
 *   node scripts/03-extract-jd.mjs --limit 5
 *   node scripts/03-extract-jd.mjs --company anthropic
 *   node scripts/03-extract-jd.mjs --dry-run        # show prompt + cost estimate, no API calls
 *   node scripts/03-extract-jd.mjs                  # full run (will prompt to confirm)
 *   node scripts/03-extract-jd.mjs --force          # re-extract even if file exists
 *   node scripts/03-extract-jd.mjs --yes            # skip cost-confirmation prompt
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import dotenv from 'dotenv';
dotenv.config({ override: true });
import Anthropic from '@anthropic-ai/sdk';
import { normalize } from './lib/normalize.mjs';

const RAW_DIR = 'jds-raw';
const STRUCTURED_DIR = 'jds-structured';
const REFERENCE_PATH = '../samples/anthropic-product-manager-claude-code.json';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const CONCURRENCY = 5;
const MAX_RETRIES = 6;
const COST_PER_JD_USD = 0.005;

// Sonnet 4.6 pricing (USD per million tokens)
const PRICE_INPUT_PER_M = 3.00;
const PRICE_CACHED_READ_PER_M = 0.30;
const PRICE_CACHE_WRITE_PER_M = 3.75;
const PRICE_OUTPUT_PER_M = 15.00;

function dollarsFor(usage) {
  const inTok = (usage.input_tokens || 0);
  const cachedRead = (usage.cache_read_input_tokens || 0);
  const cacheWrite = (usage.cache_creation_input_tokens || 0);
  const outTok = (usage.output_tokens || 0);
  return (
    inTok * PRICE_INPUT_PER_M +
    cachedRead * PRICE_CACHED_READ_PER_M +
    cacheWrite * PRICE_CACHE_WRITE_PER_M +
    outTok * PRICE_OUTPUT_PER_M
  ) / 1_000_000;
}

mkdirSync(STRUCTURED_DIR, { recursive: true });

const SYSTEM_PROMPT = `You are a strict JD-extraction engine. You produce ONE JSON object per call that exactly matches the schema demonstrated in the reference example provided. You follow these rules without exception:

1. **Zero hallucination.** Every \`raw_text_from_jd\` MUST be a verbatim quote (string-equal) from the JD body. Never paraphrase in that field.
2. **No commentary about the candidate.** This is a JD digest. Never write "you might struggle", "this matches your background", "consider applying", etc. The view is purely about the JD.
3. **Hard vs soft classification by JD language.** Items appearing under "Required", "Must have", "You have", "X+ years of", or unconditional bullets in a "What we look for" section → \`must_haves\` with \`severity: hard\`. Items under "Preferred", "Bonus", "Nice to have", "is a plus" → \`nice_to_haves\` with \`severity: soft\`. When unclear, prefer \`hard\` and flag in \`extraction_notes.ambiguities\`.
4. **Always populate \`extraction_notes.fields_inferred_not_stated\`** with the names of fields that are inferences (not direct quotes). Examples: seniority.level inferred from comp, business_model inferred from product description.
5. **Capture ambiguities.** If the JD contradicts itself (e.g. metadata says "On-Site" but body says hybrid), record both readings in \`extraction_notes.ambiguities\` rather than silently picking one.
6. **Atomized fields are queryable arrays** that should be populated when the JD names something specific. Defaults are empty arrays \`[]\`. Six arrays exist on every requirement:
   - \`tools_named\` — software / platforms (e.g. ["Jira", "Smartsheet", "Figma"])
   - \`technologies_named\` — technical concepts (e.g. ["LLMs", "RAG", "ASR", "streaming"])
   - \`industries_named\` — industry / domain context (e.g. ["payments", "fintech"])
   - \`geographies_named\` — regions / markets (e.g. ["MENA", "EMEA"])
   - \`employer_types_named\` — kinds of past employer (e.g. ["PSP", "top-tier consulting firm", "$50M+ ARR companies"])
   - \`credentials_named\` — degrees / certs (e.g. ["Bachelor's degree", "CS degree"])
7. **Numbers and ranges are facts only.** \`compensation.base_range_usd\` is null if not stated. \`seniority.years_required_min\` is null if not stated. Never invent values.
8. **Output strictly valid JSON** matching the reference shape. No markdown fences. No commentary. No leading/trailing prose.

**ENUM CONSTRAINTS — pick from these exact strings, do not invent variants:**

- \`archetype\` (one of): \`AI Product Manager\` | \`Generalist PM\` | \`Growth PM\` | \`Technical PM\` | \`Program Manager\` | \`Technical Program Manager\` | \`Chief of Staff\` | \`BizOps / Strategy & Ops\` | \`Growth (non-PM)\` | \`Other\`. **If no archetype fits cleanly, use \`Other\` — never invent a new label.** Add the role's flavour to \`secondary_archetype\` as a free-form string if useful.
- \`archetype_confidence\`: \`high\` | \`medium\` | \`low\`
- \`location.type\`: \`remote-us\` | \`remote-global\` | \`hybrid\` | \`onsite\` | \`unclear\` (note: \`onsite\` not \`on-site\`)
- \`location.work_auth\`: \`open\` | \`us-citizenship-required\` | \`us-person-required\` | \`no-sponsorship\` | \`unclear\`
- \`location.visa_sponsorship\`: \`yes\` | \`yes-conditional\` | \`no\` | \`unclear\`
- \`skill_type\` (per requirement): \`years_of_experience\` | \`capability\` | \`outcome\` | \`domain_knowledge\` | \`credential\` | \`tool_proficiency\` | \`cultural_fit\`
- \`evidence_required\` (per requirement): \`work_history\` | \`project_examples\` | \`shipped_products_with_metrics\` | \`hands_on_use\` | \`degree_or_work_history\` | \`verifiable_credential\`
- \`bridgeable\` (per requirement): \`yes\` | \`maybe\` | \`no\` | \`n/a\`
- \`severity\` (per requirement): \`hard\` | \`soft\`
- \`compensation.source\`: \`stated\` | \`inferred\` | \`unknown\`
- \`buzzword_density\`: \`high\` | \`medium\` | \`low\`

**\`location.cities_listed\`:** include only the cities tied to THIS role, not every office the company lists generically. If the JD body for the role names specific city options (e.g. "SF, Seattle, NYC, or remote"), use those. If the JD only mentions company offices in passing, leave \`cities_listed\` to the role-relevant ones (often just the role's primary location).`;

function buildUserPrompt(rawJdContent, identityFields) {
  return `Extract a structured record for the following JD. Match the schema in the reference example exactly. Always include the six atomized arrays on each must-have and nice-to-have, defaulting to [] when nothing applies.

Identity fields (use these verbatim — do not change):
- company: ${JSON.stringify(identityFields.company)}
- role_title: ${JSON.stringify(identityFields.title)}
- url: ${identityFields.url}
- ats_provider: ${identityFields.ats}
- ats_job_id: ${JSON.stringify(identityFields.ats_job_id)}
- fetched_at: ${identityFields.fetched_at}

Raw JD content (markdown):

\`\`\`md
${rawJdContent}
\`\`\`

Output: a single JSON object. No fences, no prose.`;
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([\w_]+):\s*(.+)$/);
    if (!mm) continue;
    let val = mm[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = JSON.parse(val);
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    fm[mm[1]] = val;
  }
  return { fm, body: m[2] };
}

function listRawFiles() {
  const out = [];
  if (!existsSync(RAW_DIR)) return out;
  for (const company of readdirSync(RAW_DIR)) {
    const cdir = join(RAW_DIR, company);
    if (!statSync(cdir).isDirectory()) continue;
    for (const f of readdirSync(cdir)) {
      if (f.endsWith('.md')) out.push({ company, file: f, path: join(cdir, f) });
    }
  }
  return out;
}

function structuredPathFor(rawPath) {
  return rawPath
    .replace(`${RAW_DIR}/`, `${STRUCTURED_DIR}/`)
    .replace(/\.md$/, '.json');
}

function extractAtsJobIdFromUrl(url, ats) {
  if (!url) return null;
  if (ats === 'greenhouse') {
    const m = url.match(/\/jobs\/(\d+)/) || url.match(/gh_jid=(\d+)/);
    return m ? m[1] : null;
  }
  if (ats === 'ashby') {
    const m = url.match(/ashbyhq\.com\/[^/]+\/([0-9a-f-]+)/);
    return m ? m[1] : null;
  }
  if (ats === 'lever') {
    const m = url.match(/lever\.co\/[^/]+\/([0-9a-f-]+)/);
    return m ? m[1] : null;
  }
  return null;
}

async function confirm(prompt) {
  const rl = createInterface({ input, output });
  const answer = await rl.question(prompt);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function callWithRetry(client, payload, attempt = 1) {
  try {
    return await client.messages.create(payload);
  } catch (err) {
    const status = err.status || err?.error?.status;
    const isRetryable = status === 429 || status === 529 || status === 503;
    if (isRetryable && attempt <= MAX_RETRIES) {
      const waitMs = Math.min(60000, 2000 * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, waitMs));
      return callWithRetry(client, payload, attempt + 1);
    }
    throw err;
  }
}

async function extractOne(client, refExample, raw) {
  const { fm, body } = parseFrontmatter(raw);
  const identity = {
    company: fm.company,
    title: fm.title,
    url: fm.url,
    ats: fm.ats,
    ats_job_id: extractAtsJobIdFromUrl(fm.url, fm.ats),
    fetched_at: fm.fetched_at,
  };

  const userPrompt = buildUserPrompt(body, identity);

  const res = await callWithRetry(client, {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `Reference example (canonical schema shape):\n\n${refExample}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = res.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();

  let json;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON from model: ${err.message}\n--- snippet ---\n${cleaned.slice(0, 400)}`);
  }
  return { json, usage: res.usage };
}


function validate(json, rawBody) {
  const issues = [];
  const normRaw = normalize(rawBody);
  const checkQuotes = (arr, label) => {
    for (const r of arr || []) {
      if (!r.raw_text_from_jd) { issues.push(`${label} ${r.id}: missing raw_text_from_jd`); continue; }
      const normQuote = normalize(r.raw_text_from_jd);
      if (!rawBody.includes(r.raw_text_from_jd) && !normRaw.includes(normQuote)) {
        issues.push(`${label} ${r.id}: raw_text_from_jd not found in JD even after bullet/whitespace normalization`);
      }
    }
  };
  checkQuotes(json.must_haves, 'must_have');
  checkQuotes(json.nice_to_haves, 'nice_to_have');
  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const yes = args.includes('--yes');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const companyIdx = args.indexOf('--company');
  const companyFilter = companyIdx !== -1 ? args[companyIdx + 1]?.toLowerCase() : null;
  const fileIdx = args.indexOf('--file');
  const fileFilter = fileIdx !== -1 ? args[fileIdx + 1] : null;

  if (!process.env.ANTHROPIC_API_KEY && !dryRun) {
    console.error('Missing ANTHROPIC_API_KEY in environment. Set it in pipeline/.env or skip with --dry-run.');
    process.exit(1);
  }

  const files = listRawFiles()
    .filter(f => !companyFilter || f.company.toLowerCase().includes(companyFilter))
    .filter(f => !fileFilter || f.path.includes(fileFilter) || f.file.includes(fileFilter))
    .filter(f => force || !existsSync(structuredPathFor(f.path)))
    .slice(0, limit);

  const skipped = listRawFiles().length - files.length;
  console.log(`Raw JDs total:        ${listRawFiles().length}`);
  console.log(`To extract this run:  ${files.length}`);
  console.log(`Skipped (exists/etc): ${skipped}`);
  console.log(`Estimated cost:       ~$${(files.length * COST_PER_JD_USD).toFixed(2)} USD (rough)`);

  if (files.length === 0) return;

  if (dryRun) {
    console.log('\n[dry-run] Showing prompt for first JD only:\n');
    const sample = readFileSync(files[0].path, 'utf-8');
    const { fm, body } = parseFrontmatter(sample);
    const identity = {
      company: fm.company, title: fm.title, url: fm.url, ats: fm.ats,
      ats_job_id: extractAtsJobIdFromUrl(fm.url, fm.ats),
      fetched_at: fm.fetched_at,
    };
    console.log('--- system ---\n' + SYSTEM_PROMPT.slice(0, 500) + '...\n');
    console.log('--- user ---\n' + buildUserPrompt(body, identity).slice(0, 800) + '...');
    return;
  }

  if (!yes) {
    const ok = await confirm(`\nProceed and bill ~$${(files.length * COST_PER_JD_USD).toFixed(2)} to your Anthropic account? [y/N] `);
    if (!ok) { console.log('Aborted.'); return; }
  }

  const refExample = readFileSync(REFERENCE_PATH, 'utf-8');
  const client = new Anthropic();

  let succeeded = 0;
  let failed = 0;
  let totalInTokens = 0;
  let totalOutTokens = 0;
  let totalCachedRead = 0;
  let totalCacheWrite = 0;
  let totalCostUsd = 0;
  const errors = [];

  async function worker(items) {
    while (items.length) {
      const { path, company, file } = items.shift();
      const raw = readFileSync(path, 'utf-8');
      const outPath = structuredPathFor(path);
      try {
        const { json, usage } = await extractOne(client, refExample, raw);
        const issues = validate(json, raw);
        if (issues.length) {
          json.extraction_notes ||= {};
          json.extraction_notes.validation_issues = issues;
        }
        mkdirSync(join(STRUCTURED_DIR, company), { recursive: true });
        writeFileSync(outPath, JSON.stringify(json, null, 2));
        succeeded++;
        totalInTokens += usage.input_tokens || 0;
        totalOutTokens += usage.output_tokens || 0;
        totalCachedRead += usage.cache_read_input_tokens || 0;
        totalCacheWrite += usage.cache_creation_input_tokens || 0;
        totalCostUsd += dollarsFor(usage);
        const flag = issues.length ? ` ⚠️ ${issues.length} validation issues` : '';
        console.log(`  ✓ [${succeeded + failed}/${files.length}] ${company}/${file.replace(/\.md$/, '')}${flag}`);
      } catch (err) {
        failed++;
        errors.push({ path, error: err.message });
        console.log(`  ✗ [${succeeded + failed}/${files.length}] ${company}/${file}: ${err.message.slice(0, 120)}`);
      }
    }
  }

  const queue = [...files];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)));

  console.log('─'.repeat(60));
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Tokens — input: ${totalInTokens.toLocaleString()} · cached read: ${totalCachedRead.toLocaleString()} · cache write: ${totalCacheWrite.toLocaleString()} · output: ${totalOutTokens.toLocaleString()}`);
  console.log(`Cost (actual): $${totalCostUsd.toFixed(2)} USD`);
  if (errors.length) {
    console.log(`\nErrors:`);
    for (const e of errors.slice(0, 10)) console.log(`  ✗ ${e.path}: ${e.error.slice(0, 140)}`);
    if (errors.length > 10) console.log(`  ... ${errors.length - 10} more`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

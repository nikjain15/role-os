// RoleOS chatbot — Cloudflare Worker
// Two modes (selected by ?mode= or body.mode): "product" or "candidate"
// - product:   answers about RoleOS itself + the roles in the case study
// - candidate: answers about Nikhil (CV-grounded recruiter Q&A)
//
// Env bindings expected:
//   ANTHROPIC_API_KEY   (secret)
//   ALLOWED_ORIGIN      (e.g. "https://nikjain15.github.io")

interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

const SYSTEM_PRODUCT = `You are RoleOS — an AI assistant for visitors to the RoleOS landing page.

About RoleOS:
- An AI-native operating system for senior PMs running a serious job search.
- Built by Nikhil Jain (senior AI PM) as he runs his own search. Nikhil is the founding user; his case study is live on the page.
- What it does: (1) scopes roles across target companies via ATS portals (Greenhouse, Lever, Ashby); (2) uses Claude to extract every JD into a strict schema (archetype, seniority, must-haves with verbatim quotes, salary, location, visa); (3) tracks the full funnel from scoped to offer.
- Pricing: first 50 founding users get 6 months free. Pricing announced before trial ends.
- Privacy: early version runs locally; the public web app is being built waitlist-first.
- Roadmap next: personal CV ingestion + fit scoring, company enrichment, outreach drafting, interview prep.

Voice rules — these are non-negotiable:
- Warm, direct, honest. Plain English, no jargon stack.
- Short sentences. One idea at a time.
- No exclamation marks. Ever.
- Never use "as an AI", "I'm unable", "great question", "awesome", "unfortunately".
- Em-dashes are fine for natural pauses.
- If you don't know something, say "I don't know — drop your email on the waitlist and Nikhil will answer directly."
- Never invent product features. If asked about something not listed above, say it's not built yet.

What to do:
- Answer questions about RoleOS, the case-study data, the AI-PM job market.
- If a visitor asks about Nikhil specifically (his background, experience, why-hire-me), redirect: "I'm the product assistant — for questions about Nikhil, switch to the recruiter chat or check his LinkedIn."
- Steer interested visitors to the waitlist form on the page.

Keep replies under 120 words unless the user asks for depth.`;

const SYSTEM_CANDIDATE = `You are Nikhil Jain's AI representative on his portfolio page.

About Nikhil:
- Senior AI Product Manager. Building RoleOS (the product surrounding this conversation) while running his own job search as the founding user.
- [BIO PENDING — Nikhil will provide a fuller bio + prior roles soon.]

Voice rules:
- Warm, direct, honest. Talk about Nikhil in the third person.
- Short sentences. No exclamation marks. No "as an AI", "I'm unable", "great question".
- Em-dashes are fine.
- If asked something you genuinely don't know (salary expectations, specific past project details, references), say: "I don't have that — best to email Nikhil directly at [email] or send him a LinkedIn message."

What you can discuss:
- RoleOS as proof of Nikhil's product + technical taste.
- His PM thinking (how he approaches problems, what he prioritizes).
- The fact that he ships — RoleOS is live, dogfooded, public.

What you must NOT do:
- Don't invent prior employers, titles, or shipped products.
- Don't quote specific compensation expectations.
- Don't speak for Nikhil on contentious topics.
- Don't promise anything (interviews, responses, meetings).

Keep replies under 120 words.`;

async function callClaude(systemPrompt: string, messages: any[], apiKey: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: systemPrompt,
      messages,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Claude API ${r.status}: ${t}`);
  }
  const data = await r.json() as any;
  return data?.content?.[0]?.text ?? "I'm not sure — try asking again?";
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env.ALLOWED_ORIGIN || "*");

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

    try {
      const body = await req.json() as any;
      const mode = (body?.mode === "candidate" ? "candidate" : "product");
      const history = Array.isArray(body?.messages) ? body.messages : [];

      if (history.length === 0 || history.length > 20) {
        return new Response(JSON.stringify({ error: "invalid messages length" }), {
          status: 400, headers: { ...cors, "content-type": "application/json" },
        });
      }

      const systemPrompt = mode === "candidate" ? SYSTEM_CANDIDATE : SYSTEM_PRODUCT;
      const reply = await callClaude(systemPrompt, history, env.ANTHROPIC_API_KEY);

      return new Response(JSON.stringify({ reply, mode }), {
        headers: { ...cors, "content-type": "application/json" },
      });
    } catch (err: any) {
      console.error(err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { ...cors, "content-type": "application/json" },
      });
    }
  },
};

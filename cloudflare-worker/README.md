# roleos-chat — Cloudflare Worker

Two-mode chatbot for the RoleOS landing page.

## Modes
- **product** — answers about RoleOS itself and the case-study data.
- **candidate** — answers questions about Nikhil (CV-grounded recruiter Q&A).

## Deploy

```bash
cd cloudflare-worker
npm install
npx wrangler login                              # one-time
npx wrangler secret put ANTHROPIC_API_KEY        # paste sk-ant-... when prompted
npm run deploy
```

After deploy, copy the Worker URL (something like `https://roleos-chat.<your-subdomain>.workers.dev`)
and paste it into `docs/index.html` as `window.CHAT_ENDPOINT`.

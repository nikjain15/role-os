// Triggered by Supabase Database Webhook on INSERT into public.waitlist.
// Sends an email notification via Resend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_TO = "nikjain1588@gmail.com";

serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload?.record;
    if (!record?.email) {
      return new Response("no email in payload", { status: 400 });
    }

    const { email, source = "unknown", created_at = new Date().toISOString() } = record;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "RoleOS <onboarding@resend.dev>",
        to: NOTIFY_TO,
        subject: `New RoleOS waitlist signup — ${email}`,
        text: [
          "New signup on RoleOS waitlist.",
          "",
          `Email:   ${email}`,
          `Source:  ${source}`,
          `Time:    ${created_at}`,
          "",
          "View all signups: https://supabase.com/dashboard/project/REDACTED/editor",
        ].join("\n"),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("resend failed:", res.status, err);
      return new Response(`resend failed: ${err}`, { status: 500 });
    }

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response(`error: ${err.message}`, { status: 500 });
  }
});

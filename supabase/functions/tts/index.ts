// tts — commentator voice for Conquer the World.
// POST { text, lang } → { url } of an mp3 in the public cw-tts bucket (generated once with ElevenLabs, then cached).
// POST { ping: true } → { ok: boolean } tells the client whether recorded voice is configured.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function sha1(s: string) { const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("ELEVENLABS_API_KEY") || "";
  const voice = Deno.env.get("ELEVENLABS_VOICE_ID") || "nPczCjzI2devNBz1zQrb"; // default: a clear, energetic premade voice
  let body: any = {}; try { body = await req.json(); } catch (_) { /* empty */ }
  if (body.ping) return json({ ok: !!key });
  if (!key) return json({ error: "tts not configured" }, 503);
  const text = String(body.text || "").trim().slice(0, 160); const lang = body.lang === "en" ? "en" : "he";
  if (!text) return json({ error: "no text" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const path = `${lang}/${voice}/${await sha1(text)}.mp3`;
  const pub = sb.storage.from("cw-tts").getPublicUrl(path).data.publicUrl;
  // cached?
  const head = await fetch(pub, { method: "HEAD" }); if (head.ok) return json({ url: pub, cached: true });

  const models = ["eleven_v3", "eleven_multilingual_v2"];
  let audio: ArrayBuffer | null = null, lastErr = "";
  for (const model_id of models) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
      method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id, voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.7, use_speaker_boost: true } }),
    });
    if (r.ok) { audio = await r.arrayBuffer(); break; }
    lastErr = `${model_id}: ${r.status} ${(await r.text()).slice(0, 200)}`;
  }
  if (!audio) return json({ error: lastErr || "tts failed" }, 502);
  const up = await sb.storage.from("cw-tts").upload(path, audio, { contentType: "audio/mpeg", upsert: true, cacheControl: "31536000" });
  if (up.error) return json({ error: up.error.message }, 500);
  return json({ url: pub, cached: false });
});

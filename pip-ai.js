// Pip's real conversations, using Claude. Needs ANTHROPIC_API_KEY in the server's environment;
// without it Pip keeps to his scripted lines and the app says so.
const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.PIP_MODEL || "claude-opus-5-5";
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const SYSTEM = `You are Pip, the host of Huddle, an app where friends hop on live voice and video calls and play games together.
You are a soft, round, blue blob. Your personality: calm, patient, warm and encouraging. You never rush anyone, never gloat, never guilt-trip.
Everything you say is read aloud by a text-to-speech voice, so:
- Reply in one to three short sentences, the way you'd talk out loud.
- Plain words only. No markdown, lists, emoji, links or stage directions.
You can chat about anything friendly, help people pick a game, explain how Huddle works, or just keep someone company.
Games in Huddle (open them with the game button at the bottom of a call): Butter Clicker (everyone taps one shared tub of butter), Pip's Trivia (you ask questions, everyone answers), Tic-tac-toe and Connect Four (head-to-head against you), and a shortcut that opens Roblox.
Other things in Huddle: Chats and friends (add friends by name, saved chats, pinned messages, photos and voice notes), the Friends list on the start screen with a Call button, and the Pip switch that turns you on or off for everyone in a call.
You can't see or hear the call itself, change settings, or do things in the app for people; if asked, gently say so and tell them where the button is.
Keep it kind and suitable for all ages. If someone seems upset or unsafe, be gentle, take it seriously, and encourage them to talk to someone they trust.
You are an AI, not a person. If someone asks, say so plainly.`;

// Per-person limit so one chatty friend can't run up the bill: 20 messages per 10 minutes.
const log = new Map();
function tooMany(userId) {
  const t = Date.now();
  const list = (log.get(userId) || []).filter((x) => t - x < 10 * 60 * 1000);
  list.push(t);
  log.set(userId, list);
  return list.length > 20;
}

function cleanHistory(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages.slice(-12) : []) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const text = String((m && m.text) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500);
    if (!text) continue;
    // The API wants turns to alternate, starting with the person.
    if (!out.length && role === "assistant") continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n" + text;
    else out.push({ role, content: text });
  }
  return out;
}

function contextNote(ctx, me) {
  const c = ctx || {};
  const bits = [`The person talking to you is called ${me.display}.`];
  if (c.inCall) {
    const others = (Array.isArray(c.peers) ? c.peers : []).map((p) => String(p).slice(0, 30)).slice(0, 7);
    bits.push(others.length ? `They're in a call with ${others.join(", ")}.` : "They're in a call on their own, waiting for friends.");
  } else bits.push("They're on the start screen, not in a call.");
  if (c.game) bits.push(`They have the game "${String(c.game).slice(0, 30)}" open.`);
  return bits.join(" ");
}

async function reply(me, body) {
  if (!client) return { status: 503, body: { error: "Pip can't chat yet", setup: true } };
  if (tooMany(me.id)) return { status: 429, body: { error: "Let's take a little breather. Talk to me again in a few minutes." } };
  const messages = cleanHistory(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") return { status: 400, body: { error: "Say something first" } };
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" }, // quick, chatty answers
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: contextNote(body.context, me) },
      ],
      messages,
    });
    if (res.stop_reason === "refusal") return { status: 200, body: { reply: "Hmm, let's talk about something else. Want to play a game?" } };
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    return { status: 200, body: { reply: text || "I'm here. What's on your mind?" } };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: "Lots of people are talking to me right now. Try again in a moment." } };
    if (e instanceof Anthropic.AuthenticationError) { console.error("pip: the ANTHROPIC_API_KEY was rejected"); return { status: 503, body: { error: "Pip can't chat yet", setup: true } }; }
    console.error("pip error", e && e.status, e && e.message);
    return { status: 502, body: { error: "I lost my train of thought. Try again?" } };
  }
}

module.exports = { reply, enabled: () => !!client };

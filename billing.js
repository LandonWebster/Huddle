// Pay-as-you-go phone calls: people (except the phone's owner) add money with Stripe, and each
// phone call takes off exactly what Twilio charged for it. Off until STRIPE_SECRET_KEY is set
// in Render; until then phone calls stay free for everyone, like before.
//
// How a call is charged: when a call starts, a "pending" row is saved with Twilio's call id.
// A minute or two after it ends, Twilio has priced it: we add up the price of the call and its
// connected legs (and the voicemail recording, if any) and take that off the balance. If Twilio
// still has no price after two hours, it's charged by the minute at the rates below instead.
//
// Money added: Stripe Checkout (Stripe's own payment page): $1, $5, $10 or $20 of credit, plus
// Stripe's card fee (about 2.9% + 30c) on top. Getting a personal number charges exactly the
// first month + $1 of call credit + the card fee (e.g. $1.15 + $1.00 + 38c = $2.53). After
// paying, the exact fee Stripe reports is taken out and the rest lands on their balance. The
// payment is checked with Stripe when they come back to Huddle, and every minute in the
// background, so no Stripe webhook is needed.
//
// Personal numbers: each person who pays gets their own Huddle number (forward your cell to it,
// and people can call it). It costs PHONE_NUMBER_MONTHLY a month from their balance. If the
// balance can't cover the next month, they get 7 days to add money, then the number is given back.
//
// Settings (Render > Environment):
//  STRIPE_SECRET_KEY   from Stripe > Developers > API keys (sk_test_... to try it, sk_live_... for real)
//  PHONE_CARD_FEE      "customer" (default): people pay the card fee on top; "owner": you cover it
//  PHONE_NUMBER_MONTHLY what a personal Huddle number costs each month (default 1.15, Twilio's price)
//  PHONE_911_MONTHLY   added to a number's month once it has a 911 address (default 0.75, Twilio's fee)
//  PHONE_RATE_OUT      backup cost per minute for calls out, in dollars (default 0.02)
//  PHONE_RATE_IN       backup cost per minute for calls in (default 0.015)
const store = require("./store");

const env = (k, d) => (process.env[k] || d || "").trim();
const KEY = () => env("STRIPE_SECRET_KEY");
const active = () => /^sk_(test|live)_/.test(KEY());
const testMode = () => /^sk_test_/.test(KEY());
const M = 1e6; // amounts are kept in millionths of a dollar
const RATE = { out: () => Number(env("PHONE_RATE_OUT", "0.02")) || 0.02, in: () => Number(env("PHONE_RATE_IN", "0.015")) || 0.015 };
const AMOUNTS = [1, 5, 10, 20]; // dollars you can add at once
const RECORDING_PER_MIN = 0.0025;
const MONTHLY = () => Number(env("PHONE_NUMBER_MONTHLY", "1.15")) || 1.15;
const E911_MONTHLY = () => Number(env("PHONE_911_MONTHLY", "0.75")) || 0.75;
const DAY = 24 * 3600 * 1000, MONTH = 30 * DAY, GRACE = 7 * DAY;

let twilio = null; // set by phone.js: (method, path, form) => Promise<json>
function init(twilioFn) { twilio = twilioFn; }

// ---------- Balance ----------
const balance = (userId) => store.ledgerBalance(userId);
// The longest call (in minutes) this person can afford right now. kind: "out" | "in".
async function minutesLeft(userId, kind) {
  return Math.floor((await balance(userId)) / (RATE[kind]() * M));
}

// ---------- Charging calls ----------
// A call started (outgoing from the app, or incoming to someone who pays). callSid: the main call.
async function trackCall(userId, callSid, number, kind) {
  if (!active() || !userId || !callSid) return;
  if (await store.ledgerByRef("call", callSid)) return;
  await store.ledgerAdd(userId, "call", callSid, 0, "pending", { number, kind }).catch((e) => console.warn("billing track", e.message));
}
// A voicemail was recorded on this call: add the recording's cost.
async function addRecording(callSid, seconds) {
  const row = callSid && await store.ledgerByRef("call", callSid);
  if (!row || row.status !== "pending") return;
  row.detail.recordingSeconds = Number(seconds) || 0;
  await store.ledgerUpdate(row.id, { amount: 0, status: "pending", detail: row.detail });
}
const dollars = (price) => Math.abs(Number(price) || 0); // Twilio prices are negative strings, e.g. "-0.01400"
async function priceCall(row) {
  const age = Date.now() - row.at;
  if (age < 60 * 1000) return;
  let call, legs;
  try {
    call = await twilio("GET", `/Calls/${row.ref}.json`);
    legs = (await twilio("GET", `/Calls.json?ParentCallSid=${encodeURIComponent(row.ref)}&PageSize=50`)).calls || [];
  } catch (e) {
    if (e.status === 404) return store.ledgerUpdate(row.id, { amount: 0, status: "failed", detail: row.detail });
    return; // try again next time
  }
  const all = [call, ...legs];
  if (all.some((c) => ["queued", "ringing", "in-progress"].includes(c.status))) return; // still going
  const unpriced = all.some((c) => c.price == null && Number(c.duration) > 0);
  if (unpriced && age < 2 * 3600 * 1000) return; // Twilio prices calls shortly after they end
  const secs = Number(call.duration) || 0;
  let cost = all.reduce((sum, c) => sum + dollars(c.price), 0);
  if (unpriced) cost = Math.ceil(secs / 60) * RATE[row.detail.kind === "in" ? "in" : "out"]();
  const rec = row.detail.recordingSeconds || 0;
  cost += Math.ceil(rec / 60) * RECORDING_PER_MIN;
  const detail = { ...row.detail, seconds: secs, estimated: unpriced || undefined };
  await store.ledgerUpdate(row.id, { amount: -Math.round(cost * M), status: "done", detail });
}

// ---------- Personal numbers ----------
const pretty = (n) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n);
// Buy a local number (near their cell's area code when possible) and charge the first month.
async function buyNumber(user, base, nearCell) {
  if (await store.numberOf(user.id)) throw Object.assign(new Error("You already have a Huddle number"), { status: 400 });
  const need = MONTHLY(); // the first month
  if ((await balance(user.id)) < need * M) throw Object.assign(new Error(`Add money first: a number needs at least $${need.toFixed(2)} on your balance`), { status: 402 });
  let found = null;
  const area = /^\+1\d{10}$/.test(nearCell || "") ? nearCell.slice(2, 5) : null;
  for (const qs of [area && `AreaCode=${area}&`, ""].filter((x) => x !== null && x !== undefined && x !== false)) {
    const j = await twilio("GET", `/AvailablePhoneNumbers/US/Local.json?${qs}VoiceEnabled=true&PageSize=1`).catch(() => ({}));
    found = (j.available_phone_numbers || [])[0];
    if (found) break;
  }
  if (!found) throw Object.assign(new Error("No numbers are available right now. Try again later."), { status: 503 });
  const bought = await twilio("POST", "/IncomingPhoneNumbers.json", {
    PhoneNumber: found.phone_number, FriendlyName: `Huddle: ${user.username}`.slice(0, 64),
    VoiceUrl: `${base}/twilio/incoming`, VoiceMethod: "POST", StatusCallback: `${base}/twilio/call-status`, StatusCallbackMethod: "POST",
  });
  const paidUntil = Date.now() + MONTH;
  await store.saveNumber(user.id, bought.phone_number, bought.sid, paidUntil);
  await store.ledgerAdd(user.id, "number", `${bought.sid}:${paidUntil}`, -MONTHLY() * M, "done", { number: bought.phone_number });
  return bought.phone_number;
}
async function releaseNumber(userId, why) {
  const n = await store.numberOf(userId);
  if (!n) return;
  const e = await store.e911Of(userId);
  if (e) await twilio("POST", `/IncomingPhoneNumbers/${n.sid}.json`, { EmergencyAddressSid: "" }).catch(() => {});
  await twilio("DELETE", `/IncomingPhoneNumbers/${n.sid}.json`).catch((err) => console.warn("release number", err.message));
  if (e) twilio("DELETE", `/Addresses/${e.addressSid}.json`).catch(() => {}); // fails while still attached; harmless
  await store.deleteE911(userId);
  await store.deleteNumber(userId);
  console.log(`Released a personal number (${why})`);
}
// Each month: charge the next month, or give the number back after the grace week.
async function renewNumbers() {
  for (const n of await store.numbersDue(Date.now())) {
    // Twilio charges a little more each month for a number with a 911 address.
    const month = MONTHLY() + ((await store.e911Of(n.userId)) ? E911_MONTHLY() : 0);
    if ((await balance(n.userId)) >= month * M) {
      const next = n.paidUntil + MONTH;
      await store.ledgerAdd(n.userId, "number", `${n.sid}:${next}`, -month * M, "done", { number: n.number });
      await store.setNumberPaidUntil(n.userId, next);
    } else if (Date.now() > n.paidUntil + GRACE) {
      await releaseNumber(n.userId, "balance ran out");
    }
  }
}

// ---------- Adding money (Stripe Checkout) ----------
async function stripe(method, path, form) {
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: { authorization: "Bearer " + KEY(), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || `Stripe said ${r.status}`), { status: r.status });
  return j;
}
// What they pay (cents) for `credit` dollars: the credit plus Stripe's usual US card fee
// (2.9% + 30c) on top: $1 -> $1.34, $5 -> $5.46. The exact fee is read from Stripe after paying.
const customerPaysFee = () => env("PHONE_CARD_FEE", "customer").toLowerCase() !== "owner";
const payFor = (credit) => (customerPaysFee() ? Math.ceil((Math.round(credit * 100) + 30) / (1 - 0.029)) : Math.round(credit * 100));
const UPGRADE_CREDIT = 1; // the extra dollar of call credit that comes with a new number
const upgradeCredit = () => Math.round((MONTHLY() + UPGRADE_CREDIT) * 100) / 100;
async function startTopup(user, amount, base, buyNumberAfter) {
  if (buyNumberAfter) amount = upgradeCredit();
  else if (!AMOUNTS.includes(amount)) throw Object.assign(new Error("Pick an amount"), { status: 400 });
  const back = `${base}/?phone=billing`;
  const s = await stripe("POST", "/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(payFor(amount)),
    "line_items[0][price_data][product_data][name]": buyNumberAfter ? `Your Huddle number (first month $${MONTHLY().toFixed(2)}) + $${UPGRADE_CREDIT.toFixed(2)} call credit` : `Huddle phone credit: $${amount}`,
    ...(customerPaysFee() ? { "line_items[0][price_data][product_data][description]": "Includes the card processing fee" } : {}),
    client_reference_id: user.id,
    "metadata[user_id]": user.id,
    success_url: back,
    cancel_url: back,
  });
  await store.ledgerAdd(user.id, "topup", s.id, amount * M, "pending", { paid: payFor(amount) / 100, buyNumber: !!buyNumberAfter, base });
  return s.url;
}
// Ask Stripe whether a started payment went through.
async function checkTopup(row) {
  let s;
  try { s = await stripe("GET", `/checkout/sessions/${encodeURIComponent(row.ref)}?expand[]=payment_intent.latest_charge.balance_transaction`); }
  catch (e) { if (e.status === 404) await store.ledgerUpdate(row.id, { amount: row.amount, status: "failed", detail: row.detail }); return; }
  if (s.metadata && s.metadata.user_id !== row.userId) return;
  if (s.payment_status === "paid") {
    // Credit = what they paid minus the exact fee Stripe took (when Stripe says; else as quoted).
    const paid = Number(s.amount_total) || Math.round(row.detail.paid * 100);
    const bt = s.payment_intent && s.payment_intent.latest_charge && s.payment_intent.latest_charge.balance_transaction;
    const fee = !customerPaysFee() ? 0
      : bt && typeof bt === "object" && Number.isFinite(Number(bt.fee)) ? Number(bt.fee)
      : paid - Math.round((row.amount / M) * 100);
    const detail = { ...row.detail, fee: fee / 100 };
    await store.ledgerUpdate(row.id, { amount: ((paid - fee) / 100) * M, status: "done", detail });
    if (row.detail.buyNumber && !(await store.numberOf(row.userId))) {
      const u = await store.userById(row.userId);
      await buyNumber({ id: row.userId, username: u ? u.username : "" }, row.detail.base, await store.cellOf(row.userId))
        .catch((e) => console.warn("number after payment:", e.message));
    }
  } else if (s.status === "expired" || Date.now() - row.at > 2 * 24 * 3600 * 1000) await store.ledgerUpdate(row.id, { amount: row.amount, status: "failed", detail: row.detail });
}

// ---------- Background: price finished calls, confirm payments ----------
let busy = false;
async function sweep(onlyUser) {
  if (!active() || busy) return;
  busy = true;
  try {
    for (const row of await store.ledgerPending("topup")) if (!onlyUser || row.userId === onlyUser) await checkTopup(row);
    if (!onlyUser && twilio) for (const row of await store.ledgerPending("call")) await priceCall(row).catch((e) => console.warn("billing price", e.message));
    if (!onlyUser && twilio) await renewNumbers();
  } catch (e) { console.warn("billing sweep", e.message); }
  finally { busy = false; }
}
setInterval(sweep, 60 * 1000).unref();

// ---------- /api/phone/billing ----------
// free: this person never pays (the owner, or billing is off).
async function route(method, user, body, base, free) {
  if (method === "POST" && (body.action === "buy-number" || body.action === "release-number")) {
    if (!active() || free) return { status: 400, body: { error: "You use the main Huddle number" } };
    try {
      if (body.action === "release-number") { await releaseNumber(user.id, "given up"); return { status: 200, body: { ok: true } }; }
      return { status: 200, body: { number: await buyNumber(user, base, await store.cellOf(user.id)) } };
    } catch (e) {
      console.warn("number:", e.message);
      return { status: e.status && e.status < 500 && e.status !== 401 ? e.status : 503, body: { error: e.status && e.status < 500 && e.status !== 401 ? e.message : "Couldn't get a number right now. Try again later." } };
    }
  }
  if (method === "POST") {
    if (!active() || free) return { status: 400, body: { error: "Phone calls are free for you" } };
    try { return { status: 200, body: { url: await startTopup(user, Number(body.amount), base, body.action === "upgrade") } }; }
    catch (e) { console.warn("Stripe:", e.message); return { status: e.status === 400 ? 400 : 503, body: { error: e.status === 400 ? e.message : "Couldn't reach the payment service. Try again." } }; }
  }
  if (!active() || free) return { status: 200, body: { active: false } };
  await sweep(user.id);
  const rows = await store.ledgerRecent(user.id, 100);
  const num = await store.numberOf(user.id);
  return { status: 200, body: {
    active: true, test: testMode(), amounts: AMOUNTS.map((d) => ({ credit: d, pay: payFor(d) / 100, fee: (payFor(d) - d * 100) / 100 })),
    upgrade: { pay: payFor(upgradeCredit()) / 100, fee: (payFor(upgradeCredit()) - Math.round(upgradeCredit() * 100)) / 100, month: MONTHLY(), credit: UPGRADE_CREDIT },
    monthly: MONTHLY(), myNumber: num ? { number: num.number, paidUntil: num.paidUntil, overdue: num.paidUntil < Date.now() } : null,
    balance: await balance(user.id) / M,
    items: rows.map((r) => ({ kind: r.kind, status: r.status, amount: r.amount / M, at: r.at, ref: r.kind === "call" ? r.ref : undefined,
      number: r.detail.number || null, dir: r.detail.kind || (r.kind === "number" ? "number" : null), seconds: r.detail.seconds ?? null, estimated: !!r.detail.estimated, paid: r.detail.paid || null, fee: r.detail.fee ?? null })),
  } };
}

module.exports = { init, active, releaseNumber, balance, minutesLeft, trackCall, addRecording, route, sweep, _payFor: payFor };

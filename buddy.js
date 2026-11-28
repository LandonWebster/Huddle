// Huddle Buddies (for Sleep Mode, public/sleep.js). You tap a friend and ask them to be your
// Huddle Buddy; when they accept, you're each other's Buddy. Everyone has at most one Buddy:
// accepting a new one ends your old pair (and theirs), and that old Buddy is told.
// The pair is saved in each person's prefs ("buddy", notify.js). Requests waiting for an answer
// are kept in app_settings as "buddyreq:<toUserId>" = { fromUserId: askedAtMs }.
const store = require("./store");
const { notify, getPrefs, setBuddy } = require("./notify");

const REQ_DAYS = 14;
async function requestsTo(userId) {
  let r = {};
  try { r = JSON.parse((await store.getSetting("buddyreq:" + userId)) || "{}") || {}; } catch {}
  const cut = Date.now() - REQ_DAYS * 864e5;
  for (const [k, at] of Object.entries(r)) if (!(Number(at) > cut)) delete r[k];
  return r;
}
const saveRequests = (userId, r) => store.setSetting("buddyreq:" + userId, JSON.stringify(r));

async function view(userId) {
  const p = await getPrefs(userId);
  const user = (id) => store.userById(id).then((u) => (u ? store.publicUser(u) : null)).catch(() => null);
  const incoming = [];
  for (const id of Object.keys(await requestsTo(userId))) {
    const u = await user(id);
    if (u && (await store.isFriend({ id: userId }, id))) incoming.push(u);
  }
  // A request you sent that's still waiting.
  let sent = null;
  try { sent = (await store.getSetting("buddysent:" + userId)) || null; } catch {}
  if (sent && !(userId in (await requestsTo(sent)))) sent = null;
  return { buddy: p.buddy ? await user(p.buddy) : null, incoming, sent: sent ? await user(sent) : null };
}

// Ends userId's current pair (if any) and tells the old Buddy.
async function unpair(userId, push, quiet) {
  const p = await getPrefs(userId);
  const old = p.buddy;
  if (!old) return;
  await setBuddy(userId, null);
  const op = await getPrefs(old);
  if (op.buddy === userId) {
    await setBuddy(old, null);
    if (!quiet) push(old, { type: "buddy", what: "ended" });
  }
}

// /api/buddy/... GET state | POST ask {userId} | accept {userId} | decline {userId} | cancel | end
async function route(method, sub, me, body, push) {
  if (method === "GET" && sub === "state") return { status: 200, body: await view(me.id) };
  if (method !== "POST") return { status: 404, body: { error: "Not found" } };
  const other = body && typeof body.userId === "string" ? body.userId.slice(0, 64) : "";

  if (sub === "ask") {
    if (!other || other === me.id || !(await store.isFriend(me, other))) return { status: 400, body: { error: "You can only ask a friend" } };
    if ((await getPrefs(me.id)).buddy === other) return { status: 400, body: { error: "You're already Huddle Buddies" } };
    // They already asked you: that's a yes from both.
    if (other in (await requestsTo(me.id))) return accept(me, other, push);
    // One open request at a time: asking someone new replaces the last one.
    const prev = await store.getSetting("buddysent:" + me.id).catch(() => null);
    if (prev && prev !== other) {
      const r = await requestsTo(prev); delete r[me.id]; await saveRequests(prev, r);
      push(prev, { type: "buddy", what: "changed" });
    }
    const r = await requestsTo(other);
    r[me.id] = Date.now();
    await saveRequests(other, r);
    await store.setSetting("buddysent:" + me.id, other);
    push(other, { type: "buddy", what: "request", from: store.publicUser(me) });
    notify(other, { kind: "text", cat: "chat", title: `${me.display} wants to be Huddle Buddies`, body: "Huddle Buddies can call each other in Sleep Mode. Open Huddle to say yes.", tag: "buddy-" + me.id, url: "/" });
    return { status: 200, body: await view(me.id) };
  }
  if (sub === "accept") {
    if (!other || !(other in (await requestsTo(me.id)))) return { status: 400, body: { error: "That request isn't there anymore" } };
    if (!(await store.isFriend(me, other))) return { status: 400, body: { error: "You can only be Huddle Buddies with a friend" } };
    return accept(me, other, push);
  }
  if (sub === "decline") {
    const r = await requestsTo(me.id); delete r[other]; await saveRequests(me.id, r);
    if (other) push(other, { type: "buddy", what: "declined" });
    return { status: 200, body: await view(me.id) };
  }
  if (sub === "cancel") {
    const to = await store.getSetting("buddysent:" + me.id).catch(() => null);
    if (to) { const r = await requestsTo(to); delete r[me.id]; await saveRequests(to, r); push(to, { type: "buddy", what: "changed" }); }
    await store.setSetting("buddysent:" + me.id, "");
    return { status: 200, body: await view(me.id) };
  }
  if (sub === "end") {
    await unpair(me.id, push);
    return { status: 200, body: await view(me.id) };
  }
  return { status: 404, body: { error: "Not found" } };
}

async function accept(me, other, push) {
  // One Buddy each: end both people's old pairs first.
  await unpair(me.id, push);
  await unpair(other, push);
  await setBuddy(me.id, other);
  await setBuddy(other, me.id);
  const r = await requestsTo(me.id); delete r[other]; await saveRequests(me.id, r);
  for (const [a, b] of [[me.id, other], [other, me.id]]) {
    const sent = await store.getSetting("buddysent:" + a).catch(() => null);
    if (sent === b) await store.setSetting("buddysent:" + a, "");
  }
  push(other, { type: "buddy", what: "paired", with: store.publicUser(me) });
  push(me.id, { type: "buddy", what: "paired" });
  notify(other, { kind: "text", cat: "chat", title: `You and ${me.display} are Huddle Buddies`, body: "You can call each other in Sleep Mode.", tag: "buddy-" + me.id, url: "/" });
  return { status: 200, body: await view(me.id) };
}

module.exports = { route };

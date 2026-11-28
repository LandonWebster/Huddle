// Notifications: turn them on for this device, and open the right screen when one is tapped.
// They cover calls to your Huddle number, voicemails, chat messages, call invites and alarms.
// iPhone: only works after Huddle is added to the Home Screen (Safari > Share > Add to Home Screen).
(() => {
  "use strict";
  const H = () => window.huddle || {};
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  async function api(method, path, body) {
    const r = await fetch("/api/push/" + path, {
      method,
      headers: { authorization: "Bearer " + (token() || ""), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Something went wrong");
    return j;
  }
  function keyBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function currentSub() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  // "on" | "off" | "blocked" | "unsupported" | "ios-home" (iPhone, not on the Home Screen yet) | "android-app"
  async function state() {
    if (H().isNativeApp) return "android-app";
    if (!supported()) return isIOS && !standalone() ? "ios-home" : "unsupported";
    if (Notification.permission === "denied") return "blocked";
    return Notification.permission === "granted" && (await currentSub()) ? "on" : "off";
  }
  const HELP = {
    "android-app": "In the Android app, alarms ring by themselves, and calls and messages notify while Huddle is running in the background.",
    "ios-home": "On iPhone, add Huddle to your Home Screen first (Safari > Share > Add to Home Screen), then open it from there.",
    unsupported: "This browser can't show Huddle notifications.",
    blocked: "Notifications are blocked for Huddle. Turn them on in your browser or phone settings, then try again.",
  };
  async function enable() {
    const st = await state();
    if (HELP[st]) throw new Error(HELP[st]);
    if (!token()) throw new Error("Sign in first");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(HELP.blocked);
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api("GET", "key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await api("POST", "subscribe", { subscription: sub.toJSON() });
    return "on";
  }
  async function disable() {
    const sub = await currentSub();
    if (sub) {
      await api("POST", "unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    return "off";
  }
  // Already on: make sure the server has this device under the account that's signed in now.
  async function resync() {
    try {
      if (!token() || (await state()) !== "on") return;
      const sub = await currentSub();
      await api("POST", "subscribe", { subscription: sub.toJSON() });
    } catch {}
  }
  window.addEventListener("huddle:signed-in", resync, { once: true });

  // ---------- Opening the right place from a notification ----------
  // "Answer" on a ringing call notification: pick up that call as soon as it reaches the app.
  function autoAnswer(u) {
    const phone = u.searchParams.get("phone");
    if (!phone || u.searchParams.get("answer") !== "1") return;
    window.huddleAutoAnswer = { from: phone, until: Date.now() + 40000 };
    window.dispatchEvent(new Event("huddle:auto-answer"));
  }
  function open(url) {
    let u;
    try { u = new URL(url, location.origin); } catch { return; }
    autoAnswer(u);
    const room = u.pathname.match(/^\/r\/([A-Za-z0-9]+)/);
    if (room && !H().inCall && H().joinRoom) { H().joinRoom(room[1].toUpperCase()); return; }
    const chat = u.searchParams.get("chat");
    if (chat) window.dispatchEvent(new CustomEvent("huddle:open-chat", { detail: chat }));
    const phone = u.searchParams.get("phone");
    if (phone) window.dispatchEvent(new CustomEvent("huddle:open-phone", { detail: phone }));
    if (u.searchParams.has("alarm") && window.HuddleTabs) window.HuddleTabs.select("alarms");
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "huddle-open") open(e.data.url); });
  }
  // Opened fresh from a notification (?chat=… or ?phone=…): open it once the app is ready.
  const q = new URLSearchParams(location.search);
  if (q.has("chat") || q.has("phone") || q.has("alarm")) {
    const url = location.href;
    autoAnswer(new URL(url));
    history.replaceState(history.state, "", location.pathname);
    setTimeout(() => open(url), 1500);
  }

  window.huddleOpen = open; // the Android app calls this when one of its notifications is tapped
  window.huddleNotify = { state, enable, disable, HELP };
})();

// The Video and Photos tabs: posts people share. Video is a full-screen feed you swipe through;
// Photos is a grid you scroll (tap one to open it). Like, comment, save, post with +, and
// report or block from any post. The newest ones also show on Home.
(() => {
  "use strict";
  const T = window.HuddleTabs;
  if (!T) return;
  const H = () => window.huddle || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const token = () => { try { return localStorage.getItem("huddle:token"); } catch { return null; } };
  const toast = (m, ms) => (H().toast ? H().toast(m, ms) : null);
  const me = () => (window.HuddleAccount && window.HuddleAccount.user) || {};
  async function api(method, path, body) {
    const r = await fetch("/api" + path, {
      method,
      headers: { authorization: "Bearer " + (token() || ""), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Something went wrong");
    return j;
  }
  const mediaUrl = (p, part = "main") => `/api/post-media/${encodeURIComponent(p.id)}/${part}`;
  function ago(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    if (s < 604800) return Math.floor(s / 86400) + "d";
    return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  }
  const count = (n) => (n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));
  const svg = (d, fill) => `<svg viewBox="0 0 24 24" fill="${fill || "none"}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    heart: '<path d="M12 20s-7.5-4.6-9-9.3C2 7.4 4.2 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.1 0 5.3 2.9 4.3 6.2-1.5 4.7-9 9.3-9 9.3z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
    muted: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
  };
  function paint(el, u) { if (H().paintAvatar && u) H().paintAvatar(el, u, u.display); }

  // ---------- Menus ----------
  function sheet(headHtml, items) {
    const wrap = document.createElement("div");
    wrap.className = "ch-sheet-wrap fd-sheet";
    wrap.innerHTML = `<div class="ch-sheet" role="menu">${headHtml}${items.map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`).join("")}<button type="button" class="cancel">Cancel</button></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    wrap.querySelector(".cancel").onclick = close;
    for (const b of wrap.querySelectorAll("[data-i]")) b.onclick = () => { close(); items[Number(b.dataset.i)].run(); };
  }
  const REASONS = [
    ["mean", "Being mean or bullying"],
    ["inappropriate", "Inappropriate or not okay for kids"],
    ["unsafe", "Makes me feel unsafe"],
    ["spam", "Spam or a scam"],
    ["pretending", "Pretending to be someone else"],
    ["other", "Something else"],
  ];
  function reportSheet(post, comment, after) {
    const what = comment ? "this comment" : "this post";
    sheet(`<p class="ch-sheet-title">Report ${what}<small>What's wrong with it? ${esc((comment || post).user.display)} won't know you reported it.</small></p>`,
      REASONS.map(([reason, label]) => ({ label, run: async () => {
        try {
          await api("POST", `/posts/${encodeURIComponent(post.id)}/report`, { reason, commentId: comment ? comment.id : undefined });
          const who = (comment || post).user;
          sheet(`<p class="ch-sheet-title">Thanks for telling us.<small>The report is saved. Posts that get reported by several people are hidden. You can also block ${esc(who.display)}.</small></p>`, [
            { label: `🚫 Block ${who.display}`, danger: true, run: () => block(who, after) },
          ]);
          if (reason === "unsafe" && window.Pip && window.Pip.say) window.Pip.say("If you ever feel unsafe, tell a grown-up you trust. You did the right thing.", { replace: true });
        } catch (ex) { toast(ex.message); }
      } })));
  }
  async function block(user, after) {
    try {
      await api("POST", "/blocks", { userId: user.id });
      toast(`${user.display} is blocked. You won't see their posts.`, 3000);
      if (after) after();
      reloadAll();
    } catch (ex) { toast(ex.message); }
  }
  function moreMenu(post, after) {
    if (post.mine) {
      sheet(`<p class="ch-sheet-title">Your post${post.hidden ? "<small>Hidden for review: it was reported by several people.</small>" : ""}</p>`, [
        { label: "🗑️ Delete this post", danger: true, run: () => sheet('<p class="ch-sheet-title">Delete this post?<small>It\'s removed for everyone.</small></p>', [
          { label: "Delete", danger: true, run: async () => {
            try { await api("POST", `/posts/${encodeURIComponent(post.id)}/delete`); toast("Post deleted"); if (after) after(); reloadAll(); }
            catch (ex) { toast(ex.message); }
          } },
        ]) },
      ]);
      return;
    }
    sheet(`<p class="ch-sheet-title">${esc(post.user.display)}'s post</p>`, [
      { label: "⚠️ Report this post", run: () => reportSheet(post, null, after) },
      { label: `🚫 Block ${post.user.display}`, danger: true, run: () => sheet(`<p class="ch-sheet-title">Block ${esc(post.user.display)}?<small>You won't see each other's posts, and they can't message or call you. They aren't told.</small></p>`, [
        { label: `Block ${post.user.display}`, danger: true, run: () => block(post.user, after) },
      ]) },
    ]);
  }

  // Like and save, shared by both feeds. Updates every copy of the post on screen.
  const live = new Map(); // post id -> post object (latest)
  function track(p) { const old = live.get(p.id); if (old) Object.assign(old, p); else live.set(p.id, p); return live.get(p.id); }
  function refreshMarks(p, extra) {
    const els = new Set(document.querySelectorAll(`[data-post="${CSS.escape(p.id)}"]`));
    if (extra) els.add(extra);
    for (const el of els) {
      for (const b of el.querySelectorAll('[data-act="like"]')) {
        b.setAttribute("aria-pressed", String(p.liked));
        b.classList.toggle("on", p.liked);
        const n = b.querySelector(".n"); if (n) n.textContent = count(p.likes);
        const s = b.querySelector("svg"); if (s) s.setAttribute("fill", p.liked ? "currentColor" : "none");
      }
      for (const b of el.querySelectorAll('[data-act="save"]')) {
        b.setAttribute("aria-pressed", String(p.saved));
        b.classList.toggle("on", p.saved);
        const s = b.querySelector("svg"); if (s) s.setAttribute("fill", p.saved ? "currentColor" : "none");
      }
      for (const n of el.querySelectorAll('[data-act="comments"] .n')) n.textContent = count(p.comments);
    }
  }
  async function toggle(p, what) {
    const on = what === "like" ? !p.liked : !p.saved;
    if (what === "like") { p.liked = on; p.likes += on ? 1 : -1; } else p.saved = on;
    refreshMarks(p);
    try { const r = await api("POST", `/posts/${encodeURIComponent(p.id)}/${what}`, { on }); Object.assign(p, r.post); refreshMarks(p); }
    catch (ex) {
      if (what === "like") { p.liked = !on; p.likes += on ? -1 : 1; } else p.saved = !on;
      refreshMarks(p); toast(ex.message);
    }
    if (what === "save" && on) toast("Saved");
  }
  // Wires the like / comment / save / more buttons inside el for post p.
  function wire(el, p, after) {
    el.dataset.post = p.id;
    for (const b of el.querySelectorAll("[data-act]")) {
      const act = b.dataset.act;
      if (act === "like" || act === "save") b.onclick = (e) => { e.stopPropagation(); toggle(p, act); };
      else if (act === "comments") b.onclick = (e) => { e.stopPropagation(); comments(p); };
      else if (act === "more") b.onclick = (e) => { e.stopPropagation(); moreMenu(p, after); };
    }
    for (const a of el.querySelectorAll(".fd-av")) paint(a, p.user);
    refreshMarks(p, el);
  }

  // ---------- Comments ----------
  async function comments(p) {
    const wrap = document.createElement("div");
    wrap.className = "ch-sheet-wrap fd-sheet";
    wrap.innerHTML = `
      <div class="fd-comments" role="dialog" aria-modal="true" aria-label="Comments">
        <header><strong>Comments</strong><button type="button" class="ch-icon" data-act="close" aria-label="Close">✕</button></header>
        <ul class="fd-clist"><li class="fd-muted">Loading…</li></ul>
        <form class="fd-cform"><input maxlength="300" placeholder="Add a comment" aria-label="Add a comment" enterkeyhint="send" autocomplete="off"><button type="submit" class="fd-send" aria-label="Send">${svg(IC.send)}</button></form>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    wrap.querySelector('[data-act="close"]').onclick = close;
    const list = wrap.querySelector(".fd-clist");
    let items = [];
    const render = () => {
      list.innerHTML = items.length ? items.map((c, i) => `
        <li><span class="fd-av sm"></span><div class="fd-cbody"><b>${esc(c.user.display)}</b> <small>${ago(c.at)}</small><p>${esc(c.body)}</p></div>
          <button type="button" class="ch-icon fd-cmore" data-i="${i}" aria-label="More">${svg(IC.more)}</button></li>`).join("")
        : '<li class="fd-muted">No comments yet. Say something nice.</li>';
      list.querySelectorAll(".fd-av").forEach((a, i) => paint(a, items[i].user));
      for (const b of list.querySelectorAll(".fd-cmore")) b.onclick = () => {
        const c = items[Number(b.dataset.i)];
        const opts = [];
        if (c.mine || p.mine) opts.push({ label: "🗑️ Delete comment", danger: true, run: async () => {
          try { await api("POST", `/comments/${encodeURIComponent(c.id)}/delete`); items = items.filter((x) => x !== c); p.comments = Math.max(0, p.comments - 1); refreshMarks(p); render(); }
          catch (ex) { toast(ex.message); }
        } });
        if (!c.mine) {
          opts.push({ label: "⚠️ Report comment", run: () => reportSheet(p, c, close) });
          opts.push({ label: `🚫 Block ${c.user.display}`, danger: true, run: () => block(c.user, close) });
        }
        sheet("", opts);
      };
    };
    try { items = (await api("GET", `/posts/${encodeURIComponent(p.id)}/comments`)).comments; render(); }
    catch (ex) { list.innerHTML = `<li class="fd-muted">${esc(ex.message)}</li>`; }
    const form = wrap.querySelector("form"), input = form.querySelector("input");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      input.disabled = true;
      try {
        const r = await api("POST", `/posts/${encodeURIComponent(p.id)}/comments`, { body });
        items.push(r.comment); p.comments++; refreshMarks(p); render(); input.value = "";
        list.scrollTop = list.scrollHeight;
      } catch (ex) { toast(ex.message); }
      input.disabled = false; input.focus();
    };
  }

  // ---------- Posting ----------
  let canVideo = true;
  function pickFile(kind) {
    if (kind === "video" && !canVideo) {
      toast("Posting videos isn't turned on yet.", 3500);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "video" ? "video/mp4,video/webm,video/quicktime,video/*" : "image/*";
    input.onchange = () => { if (input.files && input.files[0]) compose(kind, input.files[0]); };
    input.click();
  }
  async function shrinkPhoto(file) {
    if (file.type === "image/gif" && file.size <= 8 * 1024 * 1024) {
      const bmp = await createImageBitmap(file).catch(() => null);
      return { blob: file, w: bmp ? bmp.width : undefined, h: bmp ? bmp.height : undefined };
    }
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
    if (!bmp) return { blob: file };
    const max = 1600, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return { blob: blob || file, w: c.width, h: c.height };
  }
  // A still picture from the video, for the grid and while it loads.
  function videoInfo(file) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      let done = false;
      const finish = (r) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(r); };
      setTimeout(() => finish({}), 6000);
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      v.onloadedmetadata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch { finish({ duration: v.duration, w: v.videoWidth, h: v.videoHeight }); } };
      v.onseeked = () => {
        const max = 720, k = Math.min(1, max / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k));
        try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); } catch {}
        c.toBlob((b) => finish({ duration: v.duration, w: v.videoWidth, h: v.videoHeight, thumb: b }), "image/jpeg", 0.8);
      };
      v.onerror = () => finish({});
    });
  }
  function upload(url, blob, type, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", url);
      x.setRequestHeader("authorization", "Bearer " + (token() || ""));
      x.setRequestHeader("content-type", type);
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let j = {}; try { j = JSON.parse(x.responseText); } catch {}
        if (x.status >= 200 && x.status < 300) resolve(j);
        else reject(new Error(j.error || (x.status === 413 ? "That file is too big" : "Couldn't post that")));
      };
      x.onerror = () => reject(new Error("Couldn't reach Huddle. Check your connection."));
      x.send(blob);
    });
  }
  // Videos are made smaller before they're posted (about 720p, a few MB a minute), so the free
  // storage holds many more. The phone plays the video once, quietly, and records a smaller copy;
  // it takes as long as the video. Already-small videos, and browsers that can't, post as they are.
  const MAX_VIDEO_SECONDS = 60;
  const VIDEO_BITRATE = 1800000;
  function recorderType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    // H.264 MP4 only, so every phone (iPhone too) can play the smaller copy.
    for (const t of ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4;codecs=avc1.42E01E"]) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
    }
    return null;
  }
  // Made inside the tap (so the video may play with sound): { run(onProgress) -> Blob or null, cancel() }.
  function shrinkVideo(file) {
    let go, onProgress = null;
    const gate = new Promise((r) => { go = r; });
    const type = recorderType();
    const canvas = document.createElement("canvas");
    if (!type || !canvas.captureStream) return null;
    const v = document.createElement("video");
    v.playsInline = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
    let ctx = null, dest = null;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      dest = ctx.createMediaStreamDestination();
      ctx.createMediaElementSource(v).connect(dest); // to the recording only, not the speakers
    } catch { ctx = null; dest = null; v.muted = true; }
    const started = v.play();
    const job = (async () => {
      const cleanup = () => { try { v.pause(); } catch {} URL.revokeObjectURL(v.src); if (ctx) ctx.close().catch(() => {}); };
      try {
        await started;
        v.pause();
        if (!(await gate)) { cleanup(); return null; }
        if (!v.videoWidth) await new Promise((r) => { v.onloadedmetadata = r; setTimeout(r, 4000); });
        const w0 = v.videoWidth, h0 = v.videoHeight, dur = v.duration;
        if (!w0 || !h0 || !isFinite(dur)) { cleanup(); return null; }
        const k = Math.min(1, 720 / Math.min(w0, h0), 1280 / Math.max(w0, h0));
        canvas.width = Math.round(w0 * k / 2) * 2; canvas.height = Math.round(h0 * k / 2) * 2;
        const g = canvas.getContext("2d");
        const stream = canvas.captureStream(30);
        if (dest) for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
        const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 96000 });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const done = new Promise((r) => { rec.onstop = r; });
        v.currentTime = 0;
        await new Promise((r) => { v.onseeked = r; setTimeout(r, 1500); });
        let alive = true;
        const draw = () => {
          if (!alive) return;
          g.drawImage(v, 0, 0, canvas.width, canvas.height);
          if (onProgress && dur) onProgress(Math.min(1, v.currentTime / dur));
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw);
        };
        draw();
        rec.start(1000);
        await v.play();
        await new Promise((r) => { v.onended = r; v.onerror = r; });
        alive = false;
        rec.stop();
        await done;
        cleanup();
        const out = new Blob(chunks, { type: type.split(";")[0] });
        return out.size > 1000 ? out : null;
      } catch { cleanup(); return null; }
    })();
    return { run: (p) => { onProgress = p; go(true); return job; }, cancel: () => go(false) };
  }

  function compose(kind, file) {
    const isVideo = kind === "video";
    if (isVideo && file.size > 300 * 1024 * 1024) { toast("That video is too big. Try a shorter one."); return; }
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop fd-compose-wrap";
    const preview = URL.createObjectURL(file);
    wrap.innerHTML = `
      <div class="sheet fd-compose" role="dialog" aria-modal="true" aria-label="New ${kind} post">
        <div class="sheet-grab" aria-hidden="true"></div>
        <h2>New ${isVideo ? "video" : "photo"}</h2>
        <div class="fd-prev">${isVideo ? `<video src="${preview}" muted playsinline autoplay loop></video>` : `<img src="${preview}" alt="Your photo">`}</div>
        <label class="fd-cap"><span>Caption</span><textarea maxlength="300" rows="2" placeholder="Say something about it"></textarea></label>
        <p class="fd-fine">Everyone on Huddle can see your post. Don't share your full name, school or where you live.</p>
        <div class="fd-bar" hidden><span></span></div>
        <p class="ch-err fd-err" role="alert"></p>
        <div class="sheet-actions">
          <button type="button" class="btn primary" data-act="post">Post</button>
          <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    let busy = false;
    const close = () => { if (busy) return; URL.revokeObjectURL(preview); wrap.remove(); };
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    wrap.querySelector('[data-act="cancel"]').onclick = close;
    const bar = wrap.querySelector(".fd-bar"), fill = bar.querySelector("span"), err = wrap.querySelector(".fd-err"), postBtn = wrap.querySelector('[data-act="post"]');
    postBtn.onclick = async () => {
      if (busy) return;
      busy = true; postBtn.disabled = true; err.textContent = ""; bar.hidden = false; fill.style.width = "3%";
      const job = isVideo && file.size > 4 * 1024 * 1024 ? shrinkVideo(file) : null;
      try {
        const q = new URLSearchParams({ kind, caption: wrap.querySelector("textarea").value.trim() });
        let body, type;
        if (isVideo) {
          // Small enough already (under about 2.5 Mbps)? Post it as it is.
          const info = await videoInfo(file);
          if (info.duration && info.duration > MAX_VIDEO_SECONDS + 1) throw new Error(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds long. Trim it and try again.`);
          const small = info.duration && file.size * 8 / info.duration < 2500000 && file.size < 20 * 1024 * 1024;
          let shrunk = null;
          if (job && small) job.cancel();
          else if (job) {
            err.textContent = "Making your video smaller… keep Huddle open.";
            shrunk = await job.run((f) => { fill.style.width = Math.max(3, Math.round(f * 100)) + "%"; });
            err.textContent = ""; fill.style.width = "3%";
          }
          if (info.w) q.set("w", info.w); if (info.h) q.set("h", info.h); if (info.duration) q.set("duration", info.duration.toFixed(1));
          if (info.thumb) {
            try {
              const r = await fetch("/api/media", { method: "POST", headers: { authorization: "Bearer " + (token() || ""), "content-type": "image/jpeg" }, body: info.thumb });
              const j = await r.json(); if (r.ok && j.id) q.set("thumb", j.id);
            } catch {}
          }
          if (shrunk && shrunk.size < file.size) { body = shrunk; type = shrunk.type; }
          else if (file.size > 100 * 1024 * 1024) throw new Error("That video is too big to post (100 MB at most). Try a shorter one.");
          else { body = file; type = file.type || "video/mp4"; }
        } else {
          const s = await shrinkPhoto(file);
          if (s.w) q.set("w", s.w); if (s.h) q.set("h", s.h);
          body = s.blob; type = s.blob.type || file.type || "image/jpeg";
        }
        const r = await upload("/api/posts?" + q, body, type, (f) => { fill.style.width = Math.max(3, Math.round(f * 100)) + "%"; });
        busy = false; close();
        toast(isVideo ? "Your video is posted" : "Your photo is posted");
        const pg = isVideo ? videoFeed : photoFeed;
        pg.prepend(r.post);
        T.select(isVideo ? "video" : "photos");
      } catch (ex) {
        if (job) job.cancel();
        busy = false; postBtn.disabled = false; bar.hidden = true; err.textContent = ex.message;
      }
    };
  }

  // ---------- One feed (shared paging) ----------
  function feed(kind, render) {
    const st = { kind, filter: "all", posts: [], next: null, loading: false, loaded: false, error: null };
    st.load = async (more) => {
      if (st.loading || (more && !st.next)) return;
      st.loading = true;
      const myTurn = (st.turn = (st.turn || 0) + 1);
      try {
        const q = new URLSearchParams({ kind, feed: st.filter, limit: kind === "video" ? "8" : "24" });
        if (more) q.set("before", st.next);
        const r = await api("GET", "/posts?" + q);
        if (myTurn !== st.turn) return;
        if (kind === "video") canVideo = !!r.canVideo;
        const got = r.posts.map(track);
        st.posts = more ? st.posts.concat(got) : got;
        st.next = r.next; st.error = null;
      } catch (ex) { st.error = ex.message; }
      st.loading = false; st.loaded = true;
      render(more);
    };
    st.reset = (filter) => { if (filter) st.filter = filter; st.posts = []; st.next = null; st.loaded = false; st.turn = (st.turn || 0) + 1; st.loading = false; render(false); st.load(false); };
    st.prepend = (p) => { if (st.filter === "all" || st.filter === "mine" || st.filter === "friends") { st.posts.unshift(track(p)); render(false); } };
    return st;
  }
  function chips(list, current, onPick) {
    return `<div class="fd-chips" role="tablist">${list.map(([id, label]) => `<button type="button" role="tab" data-f="${id}" aria-selected="${id === current}" class="${id === current ? "on" : ""}">${label}</button>`).join("")}</div>`;
  }

  // ---------- Video tab ----------
  const vp = T.page("video", "Video");
  vp.el.classList.add("fd-video-page");
  vp.right.innerHTML = `<button type="button" class="tp-round" aria-label="Post a video">${svg(IC.plus)}</button>`;
  vp.right.querySelector("button").onclick = () => pickFile("video");
  vp.body.classList.add("fv-body");
  let soundOn = false;
  const videoFeed = feed("video", renderVideos);
  vp.body.innerHTML = `${chips([["all", "Everyone"], ["friends", "Friends"], ["saved", "Saved"], ["mine", "Mine"]], "all")}<div class="fv-scroll"></div>`;
  const vScroll = vp.body.querySelector(".fv-scroll");
  for (const b of vp.body.querySelectorAll(".fd-chips [data-f]")) b.onclick = () => {
    for (const x of vp.body.querySelectorAll(".fd-chips [data-f]")) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }
    videoFeed.reset(b.dataset.f);
  };
  const vObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target.querySelector("video");
      if (!v) continue;
      if (e.isIntersecting && e.intersectionRatio > 0.6 && !vp.el.hidden) playIt(v);
      else v.pause();
      if (e.isIntersecting && e.target.dataset.last === "1") videoFeed.load(true);
    }
  }, { root: vScroll, threshold: [0, 0.6, 1] });
  function playIt(v) {
    for (const o of vScroll.querySelectorAll("video")) if (o !== v) o.pause();
    v.muted = !soundOn;
    const pr = v.play();
    if (pr && pr.catch) pr.catch(() => { v.muted = true; soundOn = false; syncSound(); v.play().catch(() => {}); });
    syncSound();
  }
  function syncSound() {
    for (const b of vScroll.querySelectorAll(".fv-sound")) { b.innerHTML = svg(soundOn ? IC.sound : IC.muted); b.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on"); }
  }
  function videoItem(p) {
    const el = document.createElement("section");
    el.className = "fv-item";
    el.innerHTML = `
      <video playsinline loop preload="metadata" ${p.hasThumb ? `poster="${mediaUrl(p, "thumb")}"` : ""} src="${mediaUrl(p)}"></video>
      <button type="button" class="fv-sound" aria-label="Turn sound on"></button>
      <div class="fv-paused" aria-hidden="true">${svg(IC.play, "currentColor")}</div>
      <div class="fv-rail">
        <button type="button" data-act="like" aria-label="Like" aria-pressed="false"><span class="fv-b">${svg(IC.heart)}</span><span class="n">0</span></button>
        <button type="button" data-act="comments" aria-label="Comments"><span class="fv-b">${svg(IC.chat)}</span><span class="n">0</span></button>
        <button type="button" data-act="save" aria-label="Save" aria-pressed="false"><span class="fv-b">${svg(IC.save)}</span><span>Save</span></button>
        <button type="button" data-act="more" aria-label="More"><span class="fv-b">${svg(IC.more)}</span></button>
      </div>
      <div class="fv-info">
        <div class="fv-who"><span class="fd-av"></span><b>${esc(p.user ? p.user.display : "")}</b><small>${ago(p.at)}</small></div>
        ${p.caption ? `<p>${esc(p.caption)}</p>` : ""}
        ${p.hidden ? '<p class="fd-hidden">Hidden for review</p>' : ""}
      </div>`;
    wire(el, p, () => videoFeed.reset());
    const v = el.querySelector("video");
    const paused = el.querySelector(".fv-paused");
    v.onplay = () => (paused.hidden = true);
    v.onpause = () => (paused.hidden = false);
    paused.hidden = true;
    v.onclick = () => { if (v.paused) playIt(v); else v.pause(); };
    el.querySelector(".fv-sound").onclick = () => { soundOn = !soundOn; v.muted = !soundOn; if (v.paused) playIt(v); syncSound(); };
    // Double tap to like.
    let lastTap = 0;
    v.addEventListener("pointerup", () => { const t = Date.now(); if (t - lastTap < 300 && !p.liked) toggle(p, "like"); lastTap = t; });
    return el;
  }
  function renderVideos(more) {
    const st = videoFeed;
    if (!more) { vObserver.disconnect(); for (const v of vScroll.querySelectorAll("video")) { v.pause(); v.removeAttribute("src"); v.load(); } vScroll.innerHTML = ""; vScroll.scrollTop = 0; }
    if (!st.loaded) { vScroll.innerHTML = '<div class="fd-empty">Loading…</div>'; return; }
    if (st.error && !st.posts.length) { vScroll.innerHTML = `<div class="fd-empty">${esc(st.error)}</div>`; return; }
    if (!st.posts.length) {
      vScroll.innerHTML = `<div class="fd-empty">${st.filter === "saved" ? "Videos you save show up here." : st.filter === "mine" ? "You haven't posted a video yet." : "No videos yet."}<br><button type="button" class="btn primary">Post a video</button></div>`;
      vScroll.querySelector("button").onclick = () => pickFile("video");
      return;
    }
    const have = new Set([...vScroll.querySelectorAll(".fv-item")].map((x) => x.dataset.post));
    if (!more && vScroll.querySelector(".fd-empty")) vScroll.innerHTML = "";
    for (const p of st.posts) {
      if (have.has(p.id)) continue;
      const el = videoItem(p);
      vScroll.appendChild(el);
      vObserver.observe(el);
    }
    const items = vScroll.querySelectorAll(".fv-item");
    items.forEach((x, i) => (x.dataset.last = i === items.length - 1 ? "1" : ""));
    syncSound();
  }
  vp.onShow = () => { if (!videoFeed.loaded) videoFeed.load(false); else { const v = visibleVideo(); if (v) playIt(v); } };
  function visibleVideo() {
    const r = vScroll.getBoundingClientRect();
    for (const it of vScroll.querySelectorAll(".fv-item")) { const b = it.getBoundingClientRect(); if (b.top >= r.top - 10 && b.top < r.top + r.height / 2) return it.querySelector("video"); }
    return null;
  }
  // Stop videos when you leave the tab or start a call.
  new MutationObserver(() => { if (vp.el.hidden) for (const v of vScroll.querySelectorAll("video")) v.pause(); }).observe(vp.el, { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("visibilitychange", () => { if (document.hidden) for (const v of vScroll.querySelectorAll("video")) v.pause(); });

  // ---------- Photos tab ----------
  const pp = T.page("photos", "Photos");
  pp.right.innerHTML = `<button type="button" class="tp-pill" aria-label="Post a photo">${svg(IC.plus)}Post</button>`;
  pp.right.querySelector("button").onclick = () => pickFile("photo");
  const photoFeed = feed("photo", renderPhotos);
  pp.body.innerHTML = `${chips([["all", "Everyone"], ["friends", "Friends"], ["saved", "Saved"], ["mine", "Mine"]], "all")}<div class="fp-grid"></div><div class="fp-more" aria-hidden="true"></div>`;
  const grid = pp.body.querySelector(".fp-grid");
  for (const b of pp.body.querySelectorAll(".fd-chips [data-f]")) b.onclick = () => {
    for (const x of pp.body.querySelectorAll(".fd-chips [data-f]")) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }
    photoFeed.reset(b.dataset.f);
  };
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && photoFeed.loaded) photoFeed.load(true); }, { root: pp.body, rootMargin: "400px" }).observe(pp.body.querySelector(".fp-more"));
  function photoTile(p) {
    const el = document.createElement("article");
    el.className = "fp-tile";
    const ratio = p.w && p.h ? `aspect-ratio:${p.w} / ${p.h}` : "aspect-ratio:4 / 5";
    el.innerHTML = `
      <button type="button" class="fp-open" aria-label="Open ${esc(p.user ? p.user.display : "")}'s photo${p.caption ? ": " + esc(p.caption) : ""}" style="${ratio}"><img loading="lazy" alt="" src="${mediaUrl(p)}"></button>
      <button type="button" class="fp-save" data-act="save" aria-label="Save" aria-pressed="false">${svg(IC.save)}</button>
      <div class="fp-meta"><span class="fd-av sm"></span><span class="fp-cap">${esc(p.caption || (p.user ? p.user.display : ""))}</span>
        <button type="button" class="fp-like" data-act="like" aria-label="Like" aria-pressed="false">${svg(IC.heart)}<span class="n">0</span></button></div>
      ${p.hidden ? '<p class="fd-hidden">Hidden for review</p>' : ""}`;
    wire(el, p, () => photoFeed.reset());
    el.querySelector(".fp-open").onclick = () => openPhoto(p);
    return el;
  }
  function renderPhotos(more) {
    const st = photoFeed;
    if (!more) grid.innerHTML = "";
    if (!st.loaded) { grid.innerHTML = '<div class="fd-empty">Loading…</div>'; return; }
    if (st.error && !st.posts.length) { grid.innerHTML = `<div class="fd-empty">${esc(st.error)}</div>`; return; }
    if (!st.posts.length) {
      grid.innerHTML = `<div class="fd-empty">${st.filter === "saved" ? "Photos you save show up here." : st.filter === "mine" ? "You haven't posted a photo yet." : "No photos yet."}<br><button type="button" class="btn primary">Post a photo</button></div>`;
      grid.querySelector("button").onclick = () => pickFile("photo");
      return;
    }
    if (grid.querySelector(".fd-empty")) grid.innerHTML = "";
    const have = new Set([...grid.querySelectorAll(".fp-tile")].map((x) => x.dataset.post));
    for (const p of st.posts) if (!have.has(p.id)) grid.appendChild(photoTile(p));
  }
  pp.onShow = () => { if (!photoFeed.loaded) photoFeed.load(false); };

  // One photo, full screen.
  function openPhoto(p) {
    const el = document.createElement("div");
    el.className = "fp-view";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", `${p.user ? p.user.display : ""}'s photo`);
    el.innerHTML = `
      <header><button type="button" class="ch-icon" data-x aria-label="Back">${svg(IC.back)}</button><span class="fd-av sm"></span><b>${esc(p.user ? p.user.display : "")}</b><small>${ago(p.at)}</small><span class="ch-sp"></span>
        <button type="button" class="ch-icon" data-act="more" aria-label="More">${svg(IC.more)}</button></header>
      <div class="fp-img"><img src="${mediaUrl(p)}" alt="${esc(p.caption || "Photo")}"></div>
      <footer>
        ${p.caption ? `<p>${esc(p.caption)}</p>` : ""}
        <div class="fp-acts">
          <button type="button" data-act="like" aria-label="Like" aria-pressed="false">${svg(IC.heart)}<span class="n">0</span></button>
          <button type="button" data-act="comments" aria-label="Comments">${svg(IC.chat)}<span class="n">0</span></button>
          <span class="ch-sp"></span>
          <button type="button" data-act="save" aria-label="Save" aria-pressed="false">${svg(IC.save)}</button>
        </div>
      </footer>`;
    document.body.appendChild(el);
    const close = () => { el.remove(); window.removeEventListener("popstate", onPop); };
    const onPop = () => close();
    history.pushState({ huddlePhoto: 1 }, "");
    window.addEventListener("popstate", onPop);
    el.querySelector("[data-x]").onclick = () => history.back();
    wire(el, p, () => history.back());
    let lastTap = 0;
    el.querySelector(".fp-img").addEventListener("pointerup", () => { const t = Date.now(); if (t - lastTap < 300 && !p.liked) toggle(p, "like"); lastTap = t; });
  }

  // ---------- Home: newest videos and photos ----------
  async function home() {
    const box = T.homeFeeds;
    if (!box || !token()) return;
    let vids = [], pics = [];
    try {
      const [v, ph] = await Promise.all([api("GET", "/posts?kind=video&limit=2"), api("GET", "/posts?kind=photo&limit=4")]);
      vids = v.posts.map(track); pics = ph.posts.map(track); canVideo = !!v.canVideo;
    } catch { return; }
    box.innerHTML = `
      <section class="home-sec">
        <div class="home-sec-head"><h2>New in Video</h2><button type="button" class="home-link" data-go="video">Watch</button></div>
        <div class="home-vids">${vids.length ? vids.map((p, i) => `<button type="button" class="home-vid" data-i="${i}" ${p.hasThumb ? `style="background-image:url('${mediaUrl(p, "thumb")}')"` : ""}><span>${esc(p.caption || "Video")}</span><small>${esc(p.user ? p.user.display : "")} · ${ago(p.at)}</small></button>`).join("") : '<span class="home-muted">No videos yet.</span>'}</div>
      </section>
      <section class="home-sec">
        <div class="home-sec-head"><h2>New photos</h2><button type="button" class="home-link" data-go="photos">Open</button></div>
        <div class="home-pics">${pics.length ? pics.map((p, i) => `<button type="button" class="home-pic" data-i="${i}" aria-label="Photo by ${esc(p.user ? p.user.display : "")}"><img loading="lazy" alt="" src="${mediaUrl(p)}"></button>`).join("") : '<span class="home-muted">No photos yet.</span>'}</div>
      </section>`;
    for (const b of box.querySelectorAll("[data-go]")) b.onclick = () => T.select(b.dataset.go);
    for (const b of box.querySelectorAll(".home-vid")) b.onclick = () => T.select("video");
    for (const b of box.querySelectorAll(".home-pic")) b.onclick = () => openPhoto(pics[Number(b.dataset.i)]);
  }
  function reloadAll() {
    if (videoFeed.loaded) videoFeed.reset();
    if (photoFeed.loaded) photoFeed.reset();
    home();
  }

  window.HuddleFeeds = { home, reload: reloadAll };
})();

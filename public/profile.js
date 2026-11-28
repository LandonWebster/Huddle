// Profile pages: what you see when you tap someone (banner, big photo and name, bio, My games,
// My songs and social links), and the editor for your own, which looks the same with edit
// buttons on it. Chats (public/chats.js) supplies the sign-in, uploads and call/chat actions.
(() => {
  const H = () => window.huddle || {};
  const toast = (m, ms) => H().toast && H().toast(m, ms);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => {
    const w = String(n || "?").trim().split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase();
  };
  const avBg = (c) => (H().avatarBg ? H().avatarBg(c) : "#2f55e4");
  const media = (id) => `/api/media/${encodeURIComponent(id)}`;
  const COLORS = ["blue", "cyan", "purple", "pink", "orange", "green", "red", "gold"];
  const LIST_MAX = 10;

  // Huddle's own games (the ones you can pick from a list). Others are typed in.
  const HUDDLE_GAMES = [
    { id: "butter", name: "Butter Clicker", icon: "🧈" },
    { id: "trivia", name: "Pip's Trivia", icon: "🧠" },
    { id: "tictactoe", name: "Tic-tac-toe", icon: "❌" },
    { id: "connect4", name: "Connect Four", icon: "🔴" },
    { id: "roblox", name: "Roblox", icon: "🎮" },
  ];
  const gameIcon = (g) => (HUDDLE_GAMES.find((x) => x.id === g.huddle) || {}).icon || "🎮";

  const SOCIALS = [
    { k: "youtube", label: "YouTube", short: "YT", hint: "youtube.com/@", ph: "your channel name" },
    { k: "spotify", label: "Spotify", short: "SP", hint: "", ph: "paste your Spotify profile link" },
    { k: "tiktok", label: "TikTok", short: "TT", hint: "tiktok.com/@", ph: "your username" },
    { k: "instagram", label: "Instagram", short: "IG", hint: "instagram.com/", ph: "your username" },
  ];
  const songSite = (link) => (!link ? "" : /spotify/i.test(link) ? "Spotify" : "YouTube");

  // The top of every profile: banner, big round photo and big name. The editor uses the same
  // layout, so your own page looks exactly like it will to everyone else.
  function heroHtml(p, edit) {
    const banner = p.banner ? `style="background-image:url('${media(p.banner)}')"` : "";
    const avStyle = p.photo
      ? `background-image:url('${media(p.photo)}'), ${avBg(p.color)};background-size:cover;background-position:center`
      : `background:${avBg(p.color)}`;
    return `
      <div class="pp-banner${p.banner ? " has-img" : ""}" ${banner}>
        ${edit ? `<button type="button" class="pp-chip pp-banner-btn" data-e="banner">🖼 ${p.banner ? "Change banner" : "Add a banner"}</button>` : ""}
      </div>
      <div class="pp-av-wrap">
        <span class="pp-av" style="${avStyle}">${p.photo ? "" : esc(initials(p.display))}</span>
        ${edit ? `<button type="button" class="pp-av-btn" data-e="photo" aria-label="Change photo">📷</button>` : ""}
      </div>
      <h2 class="pp-name">${esc(p.display)}</h2>`;
  }

  function socialsHtml(p) {
    const s = p.socials || {};
    const on = SOCIALS.filter((x) => s[x.k]);
    if (!on.length) return "";
    return `<div class="pp-socials">${on.map((x) => `<a class="pp-so pp-${x.k}" href="${esc(s[x.k].url)}" target="_blank" rel="noopener noreferrer" aria-label="${x.label}: ${esc(s[x.k].name)}" title="${x.label}">${x.short}</a>`).join("")}</div>`;
  }

  function listsHtml(p, canPlay) {
    const games = p.games || [], songs = p.songs || [];
    let h = "";
    if (games.length) h += `<section class="pp-sec"><h3>My games <small>${games.length}</small></h3>${games.map((g, i) => `
      <div class="pp-item"><span class="pp-ico">${gameIcon(g)}</span><div class="pp-it"><b>${esc(g.name)}</b><span>${esc(g.note || (g.huddle ? "Played on Huddle" : ""))}</span></div>
      ${g.huddle && canPlay ? `<button type="button" class="pp-go" data-play="${i}">Play</button>` : ""}</div>`).join("")}</section>`;
    if (songs.length) h += `<section class="pp-sec"><h3>My songs <small>${songs.length}</small></h3>${songs.map((x) => `
      <div class="pp-item"><span class="pp-ico song">🎵</span><div class="pp-it"><b>${esc(x.title)}</b><span>${esc(x.artist)}</span></div>
      ${x.link ? `<a class="pp-go" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${songSite(x.link)}</a>` : ""}</div>`).join("")}</section>`;
    return h;
  }

  function overlay(label) {
    const wrap = document.createElement("div");
    wrap.className = "pp-overlay";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", label);
    document.body.appendChild(wrap);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
    document.addEventListener("keydown", onKey);
    return { wrap, close };
  }

  // ---------- Someone's profile ----------
  // opts: api(path), isMe, onCall(), onMessage(), onReport(), onBlock(), onEdit(),
  // afterActions(el): adds extra rows (like Sleep Mode's caller exception) below the buttons.
  async function open(user, opts) {
    const { wrap, close } = overlay(user.display || "Profile");
    const status = user.inCall ? "In a call" : user.online ? "On Huddle now" : "";
    const draw = (p) => {
      wrap.innerHTML = `<div class="pp-scroll">
        <button type="button" class="pp-back" aria-label="Back">‹</button>
        ${heroHtml(p, false)}
        ${status ? `<div class="pp-status${user.online ? " on" : ""}"><i></i>${status}</div>` : ""}
        ${p.bio ? `<p class="pp-bio">${esc(p.bio)}</p>` : ""}
        ${socialsHtml(p)}
        <div class="pp-acts">
          ${opts.isMe ? '<button type="button" class="pp-btn primary" data-a="edit">✏️ Edit my profile</button>'
            : `${opts.onCall ? '<button type="button" class="pp-btn primary" data-a="call">📹 Call</button>' : ""}
               ${opts.onMessage ? '<button type="button" class="pp-btn" data-a="msg">💬 Message</button>' : ""}
               <button type="button" class="pp-btn more" data-a="more" aria-label="More">⋯</button>`}
        </div>
        ${opts.afterActions && !opts.isMe ? '<div class="pp-extra"><span class="pp-anchor"></span></div>' : ""}
        ${listsHtml(p, !!opts.onCall)}
        <div class="pp-pad"></div></div>`;
      wrap.querySelector(".pp-back").onclick = close;
      const on = (a, fn) => { const b = wrap.querySelector(`[data-a="${a}"]`); if (b && fn) b.onclick = () => { close(); fn(); }; };
      on("edit", opts.onEdit); on("call", opts.onCall); on("msg", opts.onMessage);
      const more = wrap.querySelector('[data-a="more"]');
      if (more) more.onclick = () => moreSheet(p, opts, close);
      const anchor = wrap.querySelector(".pp-anchor");
      if (anchor) opts.afterActions(anchor);
      for (const b of wrap.querySelectorAll("[data-play]")) b.onclick = () => { close(); opts.onCall(); toast("Pick the game once the call starts", 3000); };
    };
    draw({ ...user, games: [], songs: [], socials: {} });
    try {
      const r = await opts.api(`/profiles/${encodeURIComponent(opts.isMe ? "me" : user.id)}`);
      if (wrap.isConnected) draw(r.profile);
    } catch (ex) { if (wrap.isConnected) toast(ex.message); }
  }
  function moreSheet(p, opts, closeProfile) {
    const w = document.createElement("div");
    w.className = "ch-sheet-wrap pp-sheet";
    w.innerHTML = `<div class="ch-sheet" role="menu"><p class="ch-sheet-title">${esc(p.display)}</p>
      <button type="button" data-m="report">⚠️ Report</button>
      <button type="button" class="danger" data-m="block">🚫 Block</button>
      <button type="button" class="cancel">Cancel</button></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.onclick = (e) => { if (e.target === w) close(); };
    w.querySelector(".cancel").onclick = close;
    w.querySelector('[data-m="report"]').onclick = () => { close(); closeProfile(); opts.onReport(); };
    w.querySelector('[data-m="block"]').onclick = () => { close(); closeProfile(); opts.onBlock(); };
  }

  // ---------- Image helpers ----------
  async function loadImg(f) {
    const url = URL.createObjectURL(f);
    try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  // Center-crops to w x h (at most) and saves as a JPEG, so uploads stay small.
  async function crop(f, w, h) {
    const img = await loadImg(f);
    const r = w / h, iw = img.naturalWidth, ih = img.naturalHeight;
    const sw = Math.min(iw, ih * r), sh = sw / r;
    const scale = Math.min(1, w / sw);
    const cv = document.createElement("canvas");
    cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
    cv.getContext("2d").drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cv.width, cv.height);
    return new Promise((res) => cv.toBlob(res, "image/jpeg", 0.86));
  }

  // ---------- Editing my profile ----------
  // opts: api(path, {body}), upload(blob, type), me, onSaved(r)
  async function edit(opts) {
    const { wrap, close } = overlay("Edit my profile");
    let d = { ...opts.me, banner: null, games: [], songs: [], socials: {} };
    try { d = { ...d, ...(await opts.api("/profiles/me")).profile }; } catch {}
    if (!wrap.isConnected) return;
    d.games = (d.games || []).map((g) => ({ ...g }));
    d.songs = (d.songs || []).map((s) => ({ ...s }));
    const soc = {};
    for (const x of SOCIALS) {
      const v = d.socials && d.socials[x.k];
      soc[x.k] = !v ? "" : x.k === "spotify" ? v.url : v.name.startsWith("channel/") ? v.url : v.name;
    }
    d.socials = soc;

    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "image/*"; picker.hidden = true;
    let picking = null;
    picker.onchange = async () => {
      const f = picker.files && picker.files[0]; picker.value = "";
      if (!f || !picking) return;
      const what = picking;
      try {
        toast(what === "banner" ? "Uploading banner…" : "Uploading photo…", 1500);
        const blob = what === "banner" ? await crop(f, 1200, 400) : await crop(f, 400, 400);
        d[what] = await opts.upload(blob, "image/jpeg");
        drawHero();
      } catch (ex) { toast(ex.message || "Couldn't use that picture"); }
    };

    wrap.innerHTML = `<div class="pp-scroll pp-editing">
      <header class="pp-ehead"><button type="button" class="pp-back static" aria-label="Close">‹</button><strong>My profile</strong><button type="button" class="pp-save">Save</button></header>
      <div class="pp-hero"></div>
      <div class="pp-photo-row"></div>
      <label class="pp-lab" for="ppBio">About me</label>
      <div class="pp-field"><textarea id="ppBio" maxlength="200" rows="3" placeholder="Like: Roblox builder, loves Connect Four">${esc(d.bio || "")}</textarea><small class="pp-count"></small></div>
      <p class="pp-lab">My games <small>(up to ${LIST_MAX})</small></p>
      <div class="pp-games"></div>
      <p class="pp-lab">My songs <small>(up to ${LIST_MAX})</small></p>
      <div class="pp-songs"></div>
      <p class="pp-lab">Socials <small>(type your username or paste a link)</small></p>
      <div class="pp-soc-in">${SOCIALS.map((x) => `
        <label class="pp-lrow"><span class="pp-so pp-${x.k}">${x.short}</span>${x.hint ? `<em>${x.hint}</em>` : ""}<input id="ppSo-${x.k}" data-so="${x.k}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${x.ph}" aria-label="${x.label}" value="${esc(d.socials[x.k])}"></label>`).join("")}
      </div>
      <p class="pp-lab">Avatar color <small>(when there's no photo)</small></p>
      <div class="pf-colors pp-colors">${COLORS.map((n) => `<button type="button" data-c="${n}" aria-label="${n}" style="background:${avBg(n)}"></button>`).join("")}</div>
      <button type="button" class="btn primary pp-save-big">Save</button>
      <div class="pp-pad"></div></div>`;
    wrap.appendChild(picker);
    const $ = (s) => wrap.querySelector(s);

    function drawHero() {
      $(".pp-hero").innerHTML = heroHtml(d, true);
      $(".pp-photo-row").innerHTML = `${d.photo ? '<button type="button" class="pp-link danger" data-e="rm-photo">Remove photo</button>' : ""}${d.banner ? '<button type="button" class="pp-link danger" data-e="rm-banner">Remove banner</button>' : ""}`;
      for (const b of wrap.querySelectorAll("[data-e]")) b.onclick = () => {
        const e = b.dataset.e;
        if (e === "rm-photo") { d.photo = null; drawHero(); }
        else if (e === "rm-banner") { d.banner = null; drawHero(); }
        else { picking = e; picker.click(); }
      };
      for (const b of wrap.querySelectorAll("[data-c]")) b.classList.toggle("on", b.dataset.c === d.color);
    }
    function drawGames() {
      const el = $(".pp-games");
      el.innerHTML = d.games.map((g, i) => `
        <div class="pp-lrow"><span class="pp-ico sm">${gameIcon(g)}</span><span class="pp-lt">${esc(g.name)}${g.note ? ` <em>· ${esc(g.note)}</em>` : ""}</span><button type="button" class="pp-x" data-rm="${i}" aria-label="Remove ${esc(g.name)}">✕</button></div>`).join("") +
        (d.games.length < LIST_MAX ? `<div class="pp-add-box">
          <div class="pp-quick">${HUDDLE_GAMES.filter((h) => !d.games.some((g) => g.huddle === h.id)).map((h) => `<button type="button" data-hg="${h.id}">${h.icon} ${esc(h.name)}</button>`).join("")}</div>
          <div class="pp-addrow"><input id="ppGameName" maxlength="40" placeholder="Or type any game (like Fortnite)"><input id="ppGameNote" maxlength="40" placeholder="Note (optional)"><button type="button" class="pp-addbtn" data-addg>Add</button></div>
        </div>` : "");
      for (const b of el.querySelectorAll("[data-rm]")) b.onclick = () => { d.games.splice(+b.dataset.rm, 1); drawGames(); };
      for (const b of el.querySelectorAll("[data-hg]")) b.onclick = () => {
        const h = HUDDLE_GAMES.find((x) => x.id === b.dataset.hg);
        d.games.push({ name: h.name, note: "", huddle: h.id }); drawGames();
      };
      const add = el.querySelector("[data-addg]");
      if (add) add.onclick = () => {
        const name = $("#ppGameName").value.trim(), note = $("#ppGameNote").value.trim();
        if (!name) { toast("Type the game's name"); return; }
        const h = HUDDLE_GAMES.find((x) => x.name.toLowerCase() === name.toLowerCase());
        d.games.push({ name, note, huddle: h ? h.id : null }); drawGames();
      };
    }
    function drawSongs() {
      const el = $(".pp-songs");
      el.innerHTML = d.songs.map((s, i) => `
        <div class="pp-lrow"><span class="pp-ico sm song">🎵</span><span class="pp-lt">${esc(s.title)}${s.artist ? ` <em>· ${esc(s.artist)}</em>` : ""}${s.link ? ` <em class="pp-tag">${songSite(s.link)}</em>` : ""}</span><button type="button" class="pp-x" data-rm="${i}" aria-label="Remove ${esc(s.title)}">✕</button></div>`).join("") +
        (d.songs.length < LIST_MAX ? `<div class="pp-add-box"><div class="pp-addrow">
          <input id="ppSongTitle" maxlength="60" placeholder="Song name"><input id="ppSongArtist" maxlength="60" placeholder="Artist">
          <input id="ppSongLink" class="wide" inputmode="url" autocapitalize="off" placeholder="Spotify or YouTube link (optional)"><button type="button" class="pp-addbtn" data-adds>Add</button></div></div>` : "");
      for (const b of el.querySelectorAll("[data-rm]")) b.onclick = () => { d.songs.splice(+b.dataset.rm, 1); drawSongs(); };
      const add = el.querySelector("[data-adds]");
      if (add) add.onclick = () => {
        const title = $("#ppSongTitle").value.trim(), artist = $("#ppSongArtist").value.trim(), link = $("#ppSongLink").value.trim();
        if (!title) { toast("Type the song's name"); return; }
        if (link && !/^https:\/\/([a-z0-9-]+\.)*(spotify\.com|spotify\.link|youtube\.com|youtu\.be)\//i.test(link)) { toast("Song links can be Spotify or YouTube links"); return; }
        d.songs.push({ title, artist, link: link || null }); drawSongs();
      };
    }
    const bio = $("#ppBio");
    const count = () => { $(".pp-count").textContent = `${bio.value.length} / 200`; };
    bio.oninput = count; count();
    for (const b of wrap.querySelectorAll("[data-c]")) b.onclick = () => { d.color = b.dataset.c; drawHero(); };
    drawHero(); drawGames(); drawSongs();

    $(".pp-back").onclick = close;
    let saving = false;
    const save = async () => {
      if (saving) return;
      // A game or song typed in but not added yet still counts.
      const gName = $("#ppGameName"), sTitle = $("#ppSongTitle");
      if (gName && gName.value.trim()) wrap.querySelector("[data-addg]").click();
      if (sTitle && sTitle.value.trim()) {
        const n = d.songs.length;
        wrap.querySelector("[data-adds]").click();
        if (d.songs.length === n) return; // the link wasn't Spotify/YouTube; the toast says so
      }
      const socials = {};
      for (const i of wrap.querySelectorAll("[data-so]")) socials[i.dataset.so] = i.value.trim();
      saving = true;
      try {
        const r = await opts.api("/profile", { body: { photo: d.photo || null, banner: d.banner || null, color: d.color, bio: bio.value, games: d.games, songs: d.songs, socials } });
        toast("Profile saved");
        close();
        opts.onSaved(r);
      } catch (ex) { toast(ex.message); }
      finally { saving = false; }
    };
    $(".pp-save").onclick = save;
    $(".pp-save-big").onclick = save;
  }

  window.HuddleProfile = { open, edit };
})();

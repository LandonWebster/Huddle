// Pip's Trivia (group game, Pip hosts). The server runs the quiz for the whole call; this file
// draws it and has Pip read each question and announce the answers.
(() => {
  const GAME = "trivia";
  const LETTERS = ["A", "B", "C", "D"];

  function mount(el, huddle) {
    el.innerHTML = `<div class="tv"><div class="tv-head"><span class="tv-face"></span><div><strong>Pip's Trivia</strong><small class="tv-sub"></small></div><span class="tv-timer" hidden></span></div><div class="tv-body"></div></div>`;
    if (window.Pip) el.querySelector(".tv-face").appendChild(window.Pip.face(36));
    const body = el.querySelector(".tv-body");
    const sub = el.querySelector(".tv-sub");
    const timer = el.querySelector(".tv-timer");
    let state = null, lastKey = "", myChoice = null;
    const first = (n) => String(n || "").trim(); // full names: people pick the name they want to be called
    const say = (t) => { if (window.Pip && window.Pip.on) window.Pip.say(t, { replace: true }); };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    function board(players, final) {
      if (!players.length) return "";
      return `<ol class="tv-scores${final ? " final" : ""}">${players.map((p, i) => `
        <li class="${p.id === huddle.myId ? "me" : ""}"><span class="tv-rank">${i + 1}</span><span class="tv-name">${esc(p.name)}</span>${
          p.answered && state.phase === "question" ? '<span class="tv-ok">answered</span>' : ""}${
          p.points ? `<span class="tv-plus">+${p.points}</span>` : ""}<b>${p.score}</b></li>`).join("")}</ol>`;
    }

    function draw() {
      const s = state;
      if (!huddle.room) {
        sub.textContent = "Group game";
        timer.hidden = true;
        body.innerHTML = `<p class="tv-intro">Start or join a call to play trivia together. I'll ask the questions.</p>`;
        return;
      }
      if (!s) return;
      timer.hidden = s.phase !== "question";
      timer.textContent = s.left;
      timer.classList.toggle("low", s.left <= 5);
      if (s.phase === "lobby" || s.phase === "done") {
        sub.textContent = s.phase === "done" ? "Final scores" : "Group game · I host";
        const winner = s.players[0];
        body.innerHTML = (s.phase === "done" && winner
          ? `<p class="tv-intro"><strong>${esc(first(winner.name))}</strong> wins with ${winner.score} points. Everyone played great.</p>`
          : `<p class="tv-intro">${s.total} questions. Everyone answers at the same time, and quick right answers get a few extra points.</p>`) +
          board(s.players, s.phase === "done") +
          `<button class="ttt-again tv-start" type="button">${s.phase === "done" ? "Play again" : "Start trivia"}</button>`;
        body.querySelector(".tv-start").onclick = () => huddle.sendGame(GAME, { action: "start" });
        return;
      }
      sub.textContent = `Question ${s.number} of ${s.total}`;
      const reveal = s.phase === "reveal";
      body.innerHTML = `
        <p class="tv-q">${esc(s.question)}</p>
        <div class="tv-choices">${s.choices.map((c, i) => `
          <button type="button" class="tv-choice c${i}${myChoice === i ? " picked" : ""}${reveal && i === s.correct ? " right" : ""}${reveal && myChoice === i && i !== s.correct ? " wrong" : ""}"
            data-i="${i}" ${reveal || myChoice !== null ? "disabled" : ""}><span>${LETTERS[i]}</span>${esc(c)}</button>`).join("")}
        </div>
        <p class="tv-note">${reveal ? "" : myChoice !== null ? "Locked in. Waiting for everyone else." : ""}</p>
        ${board(s.players)}`;
      for (const b of body.querySelectorAll(".tv-choice")) {
        b.onclick = () => {
          if (myChoice !== null || state.phase !== "question") return;
          myChoice = Number(b.dataset.i);
          huddle.sendGame(GAME, { action: "answer", choice: myChoice });
          draw();
        };
      }
    }

    // Pip's hosting lines, said once per moment of the game.
    function host(s) {
      const key = s.phase + ":" + s.number;
      if (key === lastKey) return;
      const prev = lastKey;
      lastKey = key;
      if (!prev) return; // just opened: don't read out something already in progress
      if (s.phase === "question") {
        myChoice = null;
        say((s.number === 1 ? "Here we go. " : "") + s.question);
      } else if (s.phase === "reveal") {
        const right = s.players.filter((p) => p.choice === s.correct);
        const ans = s.choices[s.correct];
        say(right.length === 0 ? `The answer was ${ans}. That was a tricky one.`
          : right.length === s.players.length && s.players.length > 1 ? `It's ${ans}. Everyone got it!`
          : `It's ${ans}. Nice one, ${right.slice(0, 3).map((p) => first(p.name)).join(" and ")}.`);
      } else if (s.phase === "done") {
        const w = s.players[0];
        if (w) say(`That's the game. ${first(w.name)} wins with ${w.score} points. Thanks for playing, everyone.`);
      }
    }

    const off = huddle.onGame(GAME, (s) => {
      if (s.phase === "question" && state && (state.phase !== "question" || state.number !== s.number)) myChoice = null;
      state = s;
      host(s);
      draw();
    });
    const join = () => { lastKey = ""; huddle.sendGame(GAME, { action: "join" }); huddle.sendGame(GAME, { action: "sync" }); };
    window.addEventListener("huddle:joined", join);
    join();
    draw();
    return () => {
      huddle.sendGame(GAME, { action: "leave" });
      off();
      window.removeEventListener("huddle:joined", join);
    };
  }

  window.HuddleGames.register({
    id: GAME,
    kind: "group",
    title: "Pip's Trivia",
    subtitle: "Pip asks, everyone answers. Fast right answers score more.",
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="#f3f3fb" stroke-width="3"/><path d="M19 20a5 5 0 1 1 7 4.6c-1.3.6-2 1.5-2 2.9V29" fill="none" stroke="#f3f3fb" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="34" r="2" fill="#f3f3fb"/></svg>',
    mount,
  });
})();

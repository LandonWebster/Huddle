// Connect Four against Pip (head-to-head). Each person plays Pip on their own screen. Pip always
// blocks a winning drop, only sometimes takes his own, tries not to set you up, and gives a hint
// if you're stuck. Best of 3, whoever lost starts the next round.
(() => {
  const COLS = 7, ROWS = 6;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const at = (b, c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? null : b[c][r]);

  // Board is columns of discs, bottom first: b[col][row], row 0 = bottom.
  const emptyBoard = () => Array.from({ length: COLS }, () => Array(ROWS).fill(null));
  const height = (b, c) => b[c].findIndex((v) => !v);
  const canDrop = (b, c) => height(b, c) !== -1;
  const freeCols = (b) => [...Array(COLS).keys()].filter((c) => canDrop(b, c));

  function lineAt(b, c, r) {
    const who = at(b, c, r);
    if (!who) return null;
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const cells = [[c, r]];
      for (let k = 1; at(b, c + dc * k, r + dr * k) === who; k++) cells.push([c + dc * k, r + dr * k]);
      for (let k = 1; at(b, c - dc * k, r - dr * k) === who; k++) cells.push([c - dc * k, r - dr * k]);
      if (cells.length >= 4) return cells;
    }
    return null;
  }
  // Would dropping `who` in column c win?
  function wins(b, c, who) {
    const r = height(b, c);
    if (r < 0) return false;
    b[c][r] = who;
    const w = !!lineAt(b, c, r);
    b[c][r] = null;
    return w;
  }
  const winningCol = (b, who) => freeCols(b).find((c) => wins(b, c, who));
  // Dropping here lets the other side win right on top of it.
  function setsUp(b, c, who, other) {
    const r = height(b, c);
    if (r < 0 || r + 1 >= ROWS) return false;
    b[c][r] = who;
    const bad = wins(b, c, other);
    b[c][r] = null;
    return bad;
  }

  function pipMove(b) {
    const win = winningCol(b, "P");
    if (win !== undefined && Math.random() < 0.6) return win;
    const block = winningCol(b, "Y");
    if (block !== undefined) return block;
    if (win !== undefined) return win;
    let options = freeCols(b).filter((c) => !setsUp(b, c, "P", "Y"));
    if (!options.length) options = freeCols(b);
    // Leans toward the middle, with a little randomness so games feel different.
    const weighted = options.flatMap((c) => Array(4 - Math.abs(3 - c)).fill(c));
    return pick(weighted);
  }
  function hintFor(b) {
    const win = winningCol(b, "Y");
    if (win !== undefined) return { c: win, text: "Psst. You can make four in a row in this column." };
    const block = winningCol(b, "P");
    if (block !== undefined) return { c: block, text: "I'm one away from four. You might want to stop me here." };
    const safe = freeCols(b).filter((c) => !setsUp(b, c, "Y", "P"));
    const c = (safe.length ? safe : freeCols(b)).sort((x, y) => Math.abs(3 - x) - Math.abs(3 - y))[0];
    return { c, text: "The middle columns give you the most ways to win." };
  }

  function mount(el, h) {
    const me = ((h && h.name) || "You") || "You";
    el.innerHTML = `
      <div class="ttt c4">
        <div class="ttt-vs">
          <div class="ttt-side you"><span class="c4-disc y"></span><strong>${escapeHtml(me)}</strong><b class="ttt-score" data-s="you">0</b></div>
          <div class="ttt-mid"><small>Best of 3</small><span>vs</span></div>
          <div class="ttt-side pip"><b class="ttt-score" data-s="pip">0</b><strong>Pip</strong><span class="ttt-face"></span></div>
        </div>
        <div class="c4-board" role="grid" aria-label="Connect Four board">
          ${Array.from({ length: COLS }, (_, c) => `<button class="c4-col" type="button" data-c="${c}" aria-label="Column ${c + 1}">${
            Array.from({ length: ROWS }, (_, k) => `<span class="c4-slot" data-r="${ROWS - 1 - k}"></span>`).join("")}</button>`).join("")}
        </div>
        <p class="ttt-line" aria-live="polite"></p>
        <button class="ttt-again" type="button" hidden>Play again</button>
      </div>`;
    if (window.Pip) el.querySelector(".ttt-face").appendChild(window.Pip.face(30));
    const cols = [...el.querySelectorAll(".c4-col")];
    const lineEl = el.querySelector(".ttt-line");
    const again = el.querySelector(".ttt-again");
    const scoreEl = { you: el.querySelector('[data-s="you"]'), pip: el.querySelector('[data-s="pip"]') };
    const slot = (c, r) => cols[c].querySelector(`[data-r="${r}"]`);

    let board, turn, over, score = { you: 0, pip: 0 }, round = 0, youStart = true, hintTimer = null, pipTimer = null, gone = false;

    function talk(text, aloud = true) {
      lineEl.textContent = text;
      if (aloud && window.Pip && window.Pip.on) window.Pip.say(text, { replace: true });
    }
    function draw() {
      cols.forEach((col, c) => {
        col.disabled = over || turn !== "Y" || !canDrop(board, c);
        col.classList.remove("hint");
        for (let r = 0; r < ROWS; r++) {
          const s = slot(c, r), v = board[c][r];
          s.classList.toggle("y", v === "Y");
          s.classList.toggle("p", v === "P");
        }
      });
      scoreEl.you.textContent = score.you;
      scoreEl.pip.textContent = score.pip;
    }
    function newRound() {
      board = emptyBoard();
      over = false;
      round++;
      again.hidden = true;
      el.querySelectorAll(".c4-slot").forEach((s) => s.classList.remove("win", "drop"));
      turn = youStart ? "Y" : "P";
      draw();
      if (turn === "Y") { talk(round === 1 ? "Tap a column to drop your disc. Take your time." : "Your turn to start.", round === 1); armHint(); }
      else { talk("I'll start this one.", false); pipTurn(); }
    }
    function armHint() {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        if (over || turn !== "Y" || gone) return;
        const hint = hintFor(board);
        cols[hint.c].classList.add("hint");
        talk(hint.text);
      }, 8000);
    }
    function play(c, who) {
      const r = height(board, c);
      if (r < 0) return;
      board[c][r] = who;
      draw();
      const s = slot(c, r);
      s.classList.remove("drop"); void s.offsetWidth; s.classList.add("drop");
      s.style.setProperty("--fall", ROWS - r);
      const line = lineAt(board, c, r);
      if (line) return finish(who, line);
      if (!freeCols(board).length) return finish("draw");
      turn = who === "Y" ? "P" : "Y";
      draw();
      if (turn === "P") pipTurn(); else armHint();
    }
    function pipTurn() {
      clearTimeout(hintTimer);
      draw();
      pipTimer = setTimeout(() => { if (!gone && !over) play(pipMove(board), "P"); }, 700 + Math.random() * 500);
    }
    function finish(who, line) {
      over = true;
      clearTimeout(hintTimer);
      if (who === "Y") score.you++;
      else if (who === "P") score.pip++;
      draw();
      if (line) line.forEach(([c, r]) => slot(c, r).classList.add("win"));
      youStart = who === "P" ? true : who === "Y" ? false : !youStart; // whoever lost starts next
      if (score.you === 2 || score.pip === 2) {
        talk(score.you === 2 ? `You won the match, ${me}. Nicely played.` : "That was a fun match. Thanks for playing with me.");
        again.textContent = "Play again";
        again.hidden = false;
        again.onclick = () => { score = { you: 0, pip: 0 }; round = 0; youStart = true; newRound(); };
        return;
      }
      talk(who === "Y" ? pick(["Four in a row. Nice one.", "Ooh, I didn't see that coming.", "Well played."])
        : who === "P" ? pick(["I got lucky there. You start the next one.", "That one went my way. You start the next one."])
        : "The board's full. A tie.");
      again.textContent = "Next round";
      again.hidden = false;
      again.onclick = newRound;
    }

    cols.forEach((col, c) => { col.onclick = () => { if (!over && turn === "Y" && canDrop(board, c)) play(c, "Y"); }; });
    newRound();
    return () => { gone = true; clearTimeout(hintTimer); clearTimeout(pipTimer); };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.HuddleGames.register({
    id: "connect4",
    kind: "versus",
    title: "Connect Four",
    subtitle: "Drop discs, get four in a row before Pip. Best of 3.",
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="10" width="34" height="28" rx="5" fill="none" stroke="#f3f3fb" stroke-width="2.5"/><circle cx="16" cy="31" r="3.4" fill="#f3f3fb"/><circle cx="24" cy="31" r="3.4" fill="#22d3ee"/><circle cx="32" cy="31" r="3.4" fill="#f3f3fb"/><circle cx="24" cy="21" r="3.4" fill="#f3f3fb"/></svg>',
    mount,
  });
})();

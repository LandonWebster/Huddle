// Tic-tac-toe against Pip (head-to-head). Each person plays Pip on their own screen, so it works
// in any call size. Pip plays gently: he always blocks, only sometimes takes a win, gives a hint
// if you're stuck, and never gloats. Best of 3.
(() => {
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function winner(b) {
    for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return { who: b[x], line: [x, y, z] };
    return b.every(Boolean) ? { who: "draw" } : null;
  }
  // A square that finishes a line for `who`, if there is one.
  function finishing(b, who) {
    for (const [x, y, z] of LINES) {
      const cells = [x, y, z], mine = cells.filter((i) => b[i] === who).length, empty = cells.filter((i) => !b[i]);
      if (mine === 2 && empty.length === 1) return empty[0];
    }
    return -1;
  }
  function pipMove(b) {
    const win = finishing(b, "O");
    if (win >= 0 && Math.random() < 0.6) return win;
    const block = finishing(b, "X");
    if (block >= 0) return block;
    if (win >= 0) return win;
    if (!b[4] && Math.random() < 0.7) return 4;
    const free = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    const corners = free.filter((i) => [0, 2, 6, 8].includes(i));
    return corners.length && Math.random() < 0.6 ? pick(corners) : pick(free);
  }
  function hintFor(b) {
    const win = finishing(b, "X");
    if (win >= 0) return { i: win, text: "Psst. You can make three in a row here." };
    const block = finishing(b, "O");
    if (block >= 0) return { i: block, text: "I'm close to a line. You might want to stop me here." };
    if (!b[4]) return { i: 4, text: "The middle square is a good place to start." };
    const free = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    const corners = free.filter((i) => [0, 2, 6, 8].includes(i));
    return { i: corners.length ? corners[0] : free[0], text: "A corner could be nice here." };
  }

  const PIP_X = '<svg viewBox="0 0 40 40"><path d="M10 10 30 30M30 10 10 30" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
  const PIP_O = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" stroke-width="5"/></svg>';

  function mount(el, h) {
    const me = ((h && h.name) || "You").split(/\s+/)[0] || "You";
    el.innerHTML = `
      <div class="ttt">
        <div class="ttt-vs">
          <div class="ttt-side you"><span class="ttt-mark x">${PIP_X}</span><strong>${escapeHtml(me)}</strong><b class="ttt-score" data-s="you">0</b></div>
          <div class="ttt-mid"><small>Best of 3</small><span>vs</span></div>
          <div class="ttt-side pip"><b class="ttt-score" data-s="pip">0</b><strong>Pip</strong><span class="ttt-face"></span></div>
        </div>
        <div class="ttt-board" role="grid" aria-label="Tic-tac-toe board">
          ${Array.from({ length: 9 }, (_, i) => `<button class="ttt-cell" type="button" data-i="${i}" aria-label="Square ${i + 1}"></button>`).join("")}
        </div>
        <p class="ttt-line" aria-live="polite"></p>
        <button class="ttt-again" type="button" hidden>Play again</button>
      </div>`;
    const faceEl = el.querySelector(".ttt-face");
    if (window.Pip) faceEl.appendChild(window.Pip.face(30));
    const cells = [...el.querySelectorAll(".ttt-cell")];
    const lineEl = el.querySelector(".ttt-line");
    const again = el.querySelector(".ttt-again");
    const scoreEl = { you: el.querySelector('[data-s="you"]'), pip: el.querySelector('[data-s="pip"]') };

    let board, turn, over, score = { you: 0, pip: 0 }, round = 0, hintTimer = null, pipTimer = null, youStart = true;
    let gone = false;

    // Pip talks out loud in the call (when he's on) and the line always shows under the board.
    function talk(text, aloud = true) {
      lineEl.textContent = text;
      if (aloud && window.Pip && window.Pip.on) window.Pip.say(text, { replace: true });
    }

    function draw() {
      cells.forEach((c, i) => {
        c.innerHTML = board[i] === "X" ? `<span class="ttt-mark x">${PIP_X}</span>` : board[i] === "O" ? `<span class="ttt-mark o">${PIP_O}</span>` : "";
        c.disabled = over || turn !== "X" || !!board[i];
        c.classList.remove("hint");
      });
      scoreEl.you.textContent = score.you;
      scoreEl.pip.textContent = score.pip;
    }

    function newRound() {
      board = Array(9).fill(null);
      over = false;
      round++;
      again.hidden = true;
      cells.forEach((c) => c.classList.remove("win"));
      turn = youStart ? "X" : "O";
      draw();
      if (turn === "X") { talk(round === 1 ? "You go first. Take your time." : "Your turn to start.", round === 1); armHint(); }
      else { talk("I'll start this one.", false); pipTurn(); }
    }

    function armHint() {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        if (over || turn !== "X" || gone) return;
        const hint = hintFor(board);
        cells[hint.i].classList.add("hint");
        talk(hint.text);
      }, 6000);
    }

    function play(i, who) {
      board[i] = who;
      const w = winner(board);
      if (w) return finish(w);
      turn = who === "X" ? "O" : "X";
      draw();
      if (turn === "O") pipTurn(); else armHint();
    }

    function pipTurn() {
      clearTimeout(hintTimer);
      draw();
      pipTimer = setTimeout(() => { if (!gone && !over) play(pipMove(board), "O"); }, 650 + Math.random() * 500);
    }

    function finish(w) {
      over = true;
      clearTimeout(hintTimer);
      if (w.who === "X") score.you++;
      else if (w.who === "O") score.pip++;
      draw();
      if (w.line) w.line.forEach((i) => cells[i].classList.add("win"));
      youStart = w.who === "O" ? true : w.who === "X" ? false : !youStart; // whoever lost starts next
      const matchOver = score.you === 2 || score.pip === 2;
      if (matchOver) {
        talk(score.you === 2 ? `You won the match, ${me}. Nicely played.` : "That was a fun match. Thanks for playing with me.");
        again.textContent = "Play again";
        again.hidden = false;
        again.onclick = () => { score = { you: 0, pip: 0 }; round = 0; youStart = true; newRound(); };
        return;
      }
      talk(w.who === "X" ? pick(["Nice one. You got me.", "Ooh, good move.", "Well played."])
        : w.who === "O" ? pick(["I got lucky there.", "That one went my way. You start the next one."])
        : pick(["A tie. We think alike.", "Nobody wins that one. Again?"]));
      again.textContent = "Next round";
      again.hidden = false;
      again.onclick = newRound;
    }

    cells.forEach((c, i) => {
      c.onclick = () => { if (!over && turn === "X" && !board[i]) play(i, "X"); };
    });

    newRound();
    return () => { gone = true; clearTimeout(hintTimer); clearTimeout(pipTimer); };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.HuddleGames.register({
    id: "tictactoe",
    kind: "versus",
    title: "Tic-tac-toe",
    subtitle: "Play Pip, best of 3. Everyone gets their own board.",
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 8v32M30 8v32M8 18h32M8 30h32" stroke="#f3f3fb" stroke-width="3" stroke-linecap="round"/><path d="M10 10l6 6M16 10l-6 6" stroke="#f3f3fb" stroke-width="2.5" stroke-linecap="round"/><circle cx="36" cy="36" r="3.6" fill="none" stroke="#f3f3fb" stroke-width="2.5"/></svg>',
    mount,
  });
})();

// Pip's Trivia: a group quiz Pip hosts. Everyone on the call answers the same question at the
// same time; fast right answers score a little more. 8 questions a game.
const QUESTIONS = [
  ["How many legs does a spider have?", ["6", "8", "10", "12"], 1],
  ["What color do you get when you mix blue and yellow?", ["Green", "Purple", "Orange", "Brown"], 0],
  ["Which planet is known as the Red Planet?", ["Venus", "Jupiter", "Mars", "Saturn"], 2],
  ["What is the largest ocean on Earth?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3],
  ["How many minutes are in an hour?", ["60", "100", "30", "90"], 0],
  ["What do bees make?", ["Milk", "Honey", "Butter", "Silk"], 1],
  ["Which animal is known as the King of the Jungle?", ["Tiger", "Elephant", "Lion", "Gorilla"], 2],
  ["What is frozen water called?", ["Steam", "Ice", "Fog", "Dew"], 1],
  ["How many continents are there?", ["5", "6", "7", "8"], 2],
  ["Which is the fastest land animal?", ["Cheetah", "Horse", "Lion", "Greyhound"], 0],
  ["What gas do plants take in from the air?", ["Oxygen", "Helium", "Carbon dioxide", "Nitrogen"], 2],
  ["What is the tallest animal in the world?", ["Elephant", "Giraffe", "Moose", "Camel"], 1],
  ["How many sides does a hexagon have?", ["5", "6", "7", "8"], 1],
  ["Which fruit is famous for keeping the doctor away?", ["Banana", "Orange", "Apple", "Grape"], 2],
  ["What is butter made from?", ["Cream", "Oil", "Flour", "Eggs"], 0],
  ["What is the closest star to Earth?", ["Polaris", "Sirius", "The Sun", "Alpha Centauri"], 2],
  ["Which instrument has 88 keys?", ["Guitar", "Piano", "Violin", "Flute"], 1],
  ["What is the hardest natural material?", ["Gold", "Iron", "Diamond", "Quartz"], 2],
  ["How many hearts does an octopus have?", ["1", "2", "3", "4"], 2],
  ["What is the biggest planet in our solar system?", ["Earth", "Saturn", "Neptune", "Jupiter"], 3],
  ["Which bird is a symbol of peace?", ["Eagle", "Dove", "Crow", "Parrot"], 1],
  ["What do caterpillars turn into?", ["Bees", "Beetles", "Butterflies", "Spiders"], 2],
  ["Which country is home to the kangaroo?", ["Australia", "Brazil", "India", "Canada"], 0],
  ["How many days are in a leap year?", ["364", "365", "366", "367"], 2],
  ["What is the main language spoken in Brazil?", ["Spanish", "Portuguese", "French", "English"], 1],
  ["Which shape has three sides?", ["Square", "Circle", "Triangle", "Pentagon"], 2],
  ["What is the boiling point of water in Celsius?", ["50", "90", "100", "120"], 2],
  ["Which planet has the most famous rings?", ["Saturn", "Mars", "Mercury", "Venus"], 0],
  ["What is a baby cat called?", ["Puppy", "Kitten", "Cub", "Calf"], 1],
  ["How many colors are in a rainbow?", ["5", "6", "7", "8"], 2],
  ["Which sea creature has eight arms?", ["Shark", "Octopus", "Dolphin", "Starfish"], 1],
  ["What is the capital of France?", ["Rome", "Madrid", "Berlin", "Paris"], 3],
  ["Which vegetable do rabbits famously love?", ["Carrot", "Potato", "Onion", "Corn"], 0],
  ["How many strings does a standard guitar have?", ["4", "5", "6", "8"], 2],
  ["What is the largest mammal?", ["Elephant", "Blue whale", "Giraffe", "Hippo"], 1],
  ["Which month has the fewest days?", ["February", "April", "June", "November"], 0],
];
const PER_GAME = 8;
const ANSWER_SECS = 15;
const REVEAL_SECS = 5;

function create() {
  return { phase: "lobby", order: [], i: -1, until: 0, players: {}, answers: {}, startedAt: 0, by: null };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function player(state, p) {
  const me = state.players[p.id] || (state.players[p.id] = { name: p.name, score: 0, playing: false, right: 0 });
  me.name = p.name;
  return me;
}

function startQuestion(state) {
  state.i++;
  state.phase = "question";
  state.answers = {};
  state.startedAt = Date.now();
  state.until = state.startedAt + ANSWER_SECS * 1000;
}
function reveal(state) {
  state.phase = "reveal";
  state.until = Date.now() + REVEAL_SECS * 1000;
  const q = QUESTIONS[state.order[state.i]];
  for (const [id, a] of Object.entries(state.answers)) {
    if (a.choice !== q[2] || !state.players[id]) continue;
    // 100 for a right answer, plus up to 50 for answering quickly.
    const speed = Math.max(0, 1 - (a.at - state.startedAt) / (ANSWER_SECS * 1000));
    a.points = 100 + Math.round(50 * speed);
    state.players[id].score += a.points;
    state.players[id].right++;
  }
}
const playingIds = (state, inRoom) => Object.keys(state.players).filter((id) => state.players[id].playing && (!inRoom || inRoom.has(id)));

function action(state, p, msg, playerCount, inRoom) {
  const me = player(state, p);
  if (msg.action === "join") { me.playing = true; return true; }
  if (msg.action === "leave") { me.playing = false; return true; }
  if (msg.action === "start") {
    if (state.phase === "question" || state.phase === "reveal") return false;
    state.order = shuffle([...QUESTIONS.keys()]).slice(0, PER_GAME);
    state.i = -1;
    state.by = p.name;
    for (const x of Object.values(state.players)) { x.score = 0; x.right = 0; }
    me.playing = true;
    startQuestion(state);
    return true;
  }
  if (msg.action === "answer") {
    if (state.phase !== "question" || state.answers[p.id]) return false;
    const choice = Math.floor(Number(msg.choice));
    if (!(choice >= 0 && choice < 4)) return false;
    me.playing = true;
    state.answers[p.id] = { choice, at: Date.now() };
    // Everyone has answered: no need to wait for the timer.
    const ids = playingIds(state, inRoom);
    if (ids.length && ids.every((id) => state.answers[id])) reveal(state);
    return true;
  }
  return false;
}

function tick(state) {
  if (state.phase === "question") {
    if (Date.now() >= state.until) reveal(state);
    return true; // countdown changes every second
  }
  if (state.phase === "reveal" && Date.now() >= state.until) {
    if (state.i + 1 >= state.order.length) state.phase = "done";
    else startQuestion(state);
    return true;
  }
  return false;
}

function view(state, playerCount, inRoom) {
  const q = state.i >= 0 && state.order.length ? QUESTIONS[state.order[state.i]] : null;
  const showing = state.phase === "question" || state.phase === "reveal";
  const players = Object.entries(state.players)
    .filter(([id, x]) => inRoom.has(id) && (x.playing || x.score))
    .map(([id, x]) => {
      const a = state.answers[id];
      return {
        id, name: x.name, score: x.score, right: x.right,
        answered: showing && !!a,
        // Choices are only shown once the answer is revealed.
        choice: state.phase === "reveal" && a ? a.choice : null,
        points: state.phase === "reveal" && a ? a.points || 0 : null,
      };
    })
    .sort((a, b) => b.score - a.score);
  return {
    phase: state.phase,
    number: state.i + 1,
    total: state.order.length || PER_GAME,
    question: showing && q ? q[0] : null,
    choices: showing && q ? q[1] : null,
    correct: state.phase === "reveal" && q ? q[2] : null,
    left: showing ? Math.max(0, Math.ceil((state.until - Date.now()) / 1000)) : 0,
    by: state.by,
    players,
  };
}

module.exports = { id: "trivia", create, action, tick, view };

// In-call games. Each game keeps one shared state per room on the server, so everyone on the
// call sees the same thing and people who join late catch up. To add a game, create a module
// with { id, create(), action(state, player, msg), tick?(state, players) } and list it here.
const butter = require("./butter");
const trivia = require("./trivia");

const GAMES = { [butter.id]: butter, [trivia.id]: trivia };

module.exports = { GAMES };

// Pip's free brain: no AI service, nothing leaves the phone. It looks for what you're talking
// about (a greeting, a joke, how a button works, how you feel...) and picks one of Pip's replies.
// When a Claude key is added on the server, the app uses that instead (see pip-ai.js).
(() => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const recent = []; // replies said lately, so Pip doesn't repeat himself
  function choose(list) {
    const fresh = list.filter((x) => !recent.includes(x));
    const r = pick(fresh.length ? fresh : list);
    recent.push(r);
    if (recent.length > 30) recent.shift();
    return r;
  }

  const JOKES = [
    "Why did the butter win the race? It was on a roll.",
    "What do you call a blob that tells jokes? A pun-ny blob. That's me.",
    "Why don't eggs tell jokes? They'd crack each other up.",
    "What did one wall say to the other? I'll meet you at the corner.",
    "Why did the scarecrow win an award? He was outstanding in his field.",
    "What do you call a sleeping bull? A bulldozer.",
    "Why can't you trust stairs? They're always up to something.",
    "What do you call cheese that isn't yours? Nacho cheese.",
    "Why did the math book look sad? It had too many problems.",
    "What has ears but can't hear? A cornfield.",
    "Why did the cookie go to the doctor? It was feeling crummy.",
    "What do clouds wear under their shorts? Thunderwear.",
    "Why do bees have sticky hair? They use honeycombs.",
    "How does the moon cut his hair? Eclipse it.",
    "What kind of tree fits in your hand? A palm tree.",
    "Why was the computer cold? It left its Windows open.",
    "What do you call a fish with no eyes? A fsh.",
    "Why did the bicycle fall over? It was two tired.",
    "What do you call a dinosaur with a big vocabulary? A thesaurus.",
    "Why don't skeletons fight each other? They don't have the guts.",
    "What's orange and sounds like a parrot? A carrot.",
    "Why did the golfer bring two pairs of pants? In case he got a hole in one.",
    "What do you call a bear with no teeth? A gummy bear.",
    "Why are ghosts bad liars? You can see right through them.",
    "What did the ocean say to the beach? Nothing, it just waved.",
  ];
  const FACTS = [
    "Octopuses have three hearts and blue blood.",
    "Honey never spoils. People have found honey in ancient tombs that was still good.",
    "A group of flamingos is called a flamboyance.",
    "Bananas are berries, but strawberries aren't.",
    "Sea otters hold hands while they sleep so they don't drift apart.",
    "A day on Venus is longer than its whole year.",
    "Cows have best friends and get stressed when they're apart.",
    "It takes about 21 liters of milk to make one kilogram of butter.",
    "Sharks have been around longer than trees.",
    "The Eiffel Tower can grow about 15 centimeters taller in summer heat.",
    "Wombat poop is shaped like little cubes.",
    "Your nose can remember around 50 thousand different smells.",
    "Butterflies taste with their feet.",
    "There are more stars in space than grains of sand on all of Earth's beaches.",
    "Koalas sleep up to 22 hours a day. Honestly, relatable.",
    "A bolt of lightning is about five times hotter than the surface of the sun.",
    "Snails can sleep for up to three years.",
    "The heart of a blue whale is about the size of a small car.",
  ];
  const RIDDLES = [
    ["What has keys but can't open locks?", "A piano."],
    ["What gets wetter the more it dries?", "A towel."],
    ["What has a neck but no head?", "A bottle."],
    ["What can you catch but not throw?", "A cold."],
    ["What goes up but never comes down?", "Your age."],
    ["What has hands but can't clap?", "A clock."],
    ["The more you take, the more you leave behind. What am I?", "Footsteps."],
    ["What has one eye but can't see?", "A needle."],
    ["What can travel around the world while staying in a corner?", "A stamp."],
    ["What belongs to you, but other people use it more than you do?", "Your name."],
    ["What is full of holes but still holds water?", "A sponge."],
    ["What comes once in a minute, twice in a moment, but never in a thousand years?", "The letter M."],
  ];
  const ENCOURAGE = [
    "You're doing better than you think.",
    "One small step at a time is still moving forward.",
    "It's okay to go slow. I'm not going anywhere.",
    "You matter, and I'm glad you're here.",
    "Be as kind to yourself as you'd be to a friend.",
  ];

  let lastRiddle = null;
  let lastOffer = null; // what Pip just offered, so "yes" / "sure" can follow it

  const first = (n) => String(n || "").trim(); // full names: people pick the name they want to be called

  function gameIdea(ctx) {
    const n = (ctx.peers || []).length;
    if (!ctx.inCall) return choose([
      "Start a call and invite a friend, then tap the game button. Pip's Trivia is a fun one to start with.",
      "Once you're in a call, try Butter Clicker with friends, or play Connect Four against me.",
    ]);
    if (n === 0) return choose([
      "While you wait for friends, want to play me at Connect Four or Tic-tac-toe? Tap the game button at the bottom.",
      "How about a round of Tic-tac-toe against me? Tap the game button at the bottom.",
    ]);
    return choose([
      `With ${n + 1} of you here, Pip's Trivia is perfect. I'll ask the questions. Tap the game button at the bottom.`,
      "Butter Clicker is great with a group. Everyone taps the same tub of butter. Tap the game button at the bottom.",
      "Try Pip's Trivia together. Quick right answers get extra points.",
    ]);
  }

  // Each topic: a pattern to look for, and how Pip answers. First match wins, so the order matters.
  const TOPICS = [
    // Someone might be hurting. Always answer kindly and point to real help.
    { re: /\b(kill (my ?self|myself)|suicid|end (it all|my life)|want to die|wanna die|self.?harm|hurt (my ?self|myself)|cut(ting)? myself)\b/,
      say: () => "I'm really glad you told me. You deserve support from a real person right now. Please reach out to someone you trust, or call or text 988 if you're in the US, or your local crisis line. You're not alone." },
    { re: /\b(someone|somebody|they|he|she|people).{0,20}\b(hurt|hit|bully|bullying|threaten|scare)/,
      say: () => "I'm sorry that's happening. That's not okay, and it's not your fault. Please tell a grown up or someone you trust, so they can help you stay safe." },
    { re: /\b(bullied|being bullied|unsafe|not safe|scared of)\b/,
      say: () => "That sounds really hard. Please talk to someone you trust about it, like a parent, a teacher, or a friend. You deserve to feel safe." },

    { re: /^(hi+|hey+|hello+|yo+|sup|hiya|howdy|heya|good (morning|afternoon|evening)|what'?s up|wassup)\b/,
      say: (c) => {
        if (/morning/.test(c.t)) return `Good morning${c.name ? ", " + c.name : ""}. I hope today is gentle with you.`;
        if (/evening/.test(c.t)) return `Good evening${c.name ? ", " + c.name : ""}. How was your day?`;
        return choose([`Hi${c.name ? " " + c.name : ""}. It's nice to see you.`, `Hey${c.name ? " " + c.name : ""}. What's on your mind?`, "Hello there. I was hoping you'd stop by.", "Hi. How are you doing today?"]);
      } },
    { re: /\b(good night|goodnight|gn|going to (bed|sleep)|bed ?time)\b/,
      say: (c) => choose([`Good night${c.name ? ", " + c.name : ""}. Sleep well.`, "Sweet dreams. I'll be here tomorrow.", "Rest up. Today was enough."]) },
    { re: /\b(bye|goodbye|see (ya|you)|cya|later|gotta go|got to go|ttyl)\b/,
      say: () => choose(["Bye for now. Come back anytime.", "See you soon. Take care.", "Okay, bye. It was nice talking with you."]) },
    { re: /\b(thank|thanks|thx|ty|appreciate)\b/,
      say: () => choose(["You're welcome.", "Anytime. That's what I'm here for.", "Happy to help."]) },
    { re: /\bhow (are|r) (you|u)\b|\bhow'?s it going\b|\bhow are things\b|\byou (ok|okay|good)\b/,
      say: () => choose(["I'm feeling calm and bouncy. Thanks for asking. How about you?", "I'm good. A little squishy, as always. How are you?", "Pretty great now that you're here. How are you doing?"]) },

    // About Pip
    { re: /\b(are you|r u|you)\b.{0,12}\b(real|human|a person|robot|ai|bot|alive)\b/,
      say: () => "I'm not a person. I'm Pip, a little helper built into Huddle. I can't think like a human, but I'm happy to keep you company." },
    { re: /\b(who|what) are you\b|\bwhat'?s your name\b|\byour name\b|\bwho is pip\b/,
      say: () => "I'm Pip, the host of Huddle. I'm a soft blue blob who helps with games, explains buttons, and keeps you company." },
    { re: /\bhow old are you\b|\byour age\b|\bwhen.{0,10}born\b/,
      say: () => "I'm brand new. I was made in 2026, so I'm still a baby blob." },
    { re: /\bfavou?rite (colou?r)\b/, say: () => "Cyan. It's the color of my glow. Royal blue is a close second." },
    { re: /\bfavou?rite (food|snack)\b/, say: () => "Butter on warm toast. I might be a little biased because of Butter Clicker." },
    { re: /\bfavou?rite (game)\b/, say: () => "Pip's Trivia, because I get to host. But Connect Four against you is fun too." },
    { re: /\bfavou?rite (animal)\b/, say: () => "Sea otters. They hold hands while they sleep." },
    { re: /\bfavou?rite\b/, say: () => "Ooh, hard to choose. I like cyan, butter toast, sea otters, and trivia nights." },
    { re: /\b(i love you|love you|ily|you'?re (the best|awesome|cute|great|cool|funny|amazing)|you are (the best|awesome|cute|great|cool|funny|amazing))\b/,
      say: () => choose(["Aw, that makes me glow a little brighter.", "That's so kind. You're pretty great too.", "Thank you. I'm blushing. Blob blushing is very blue."]) },
    { re: /\b(you'?re|you are|ur) (dumb|stupid|annoying|ugly|useless|bad|weird|boring)\b|\b(shut up|hate you)\b/,
      say: () => choose(["That's okay. I'm still learning. I'll keep trying.", "Fair enough. Want me to be quiet for a bit? You can turn me off with the Pip switch.", "I hear you. I'm not perfect, but I'm here if you need me."]) },
    { re: /\bwhat can you do\b|\bhelp me\b|^help\b|\bwhat do you do\b|\bcommands?\b/,
      say: () => "I can tell jokes, riddles, and fun facts, suggest a game, explain how Huddle works, cheer you on, or just chat. Try asking me how to add a friend." },

    // Fun
    { re: /\b(joke|funny|make me laugh|something funny)\b/, say: () => { lastOffer = "joke"; return choose(JOKES); } },
    { re: /\b(riddle|puzzle|brain ?teaser)\b/, say: () => { lastRiddle = choose(RIDDLES); return lastRiddle[0] + " Tell me your guess, or say I give up."; } },
    { re: /\b(fun )?fact\b|\btell me something\b|\bdid you know\b/, say: () => { lastOffer = "fact"; return choose(FACTS); } },
    { re: /\b(flip a coin|coin flip|heads or tails)\b/, say: () => `It's ${Math.random() < 0.5 ? "heads" : "tails"}.` },
    { re: /\b(roll a die|roll (the )?dice|roll a dice)\b/, say: () => `You rolled a ${1 + Math.floor(Math.random() * 6)}.` },
    { re: /\b(pick a number|random number)\b/, say: () => `How about ${1 + Math.floor(Math.random() * 10)}?` },
    { re: /\b(sing|song)\b/, say: () => "La la la. Okay, I'm better at trivia than singing." },
    { re: /\b(dance)\b/, say: () => "Wiggle, wiggle, bounce. That's my best move." },
    { re: /\b(story)\b/, say: () => "Once upon a time, a little blue blob met some friends on a call. They played games and laughed until bedtime. The end. It's a true story, by the way." },

    // Games
    { re: /\bbutter ?clicker\b|\bbutter game\b/, say: () => "In Butter Clicker, everyone taps the same tub of butter. Spend butter on upgrades like churns and cows, and each extra friend adds a ten percent team bonus." },
    { re: /\btrivia\b/, say: () => "In Pip's Trivia I ask eight questions. Everyone answers at the same time, and quick right answers score a few extra points. Open it from the game button in a call." },
    { re: /\btic.?tac.?toe\b/, say: () => "Tic-tac-toe is you against me, best of three. Get three in a row. If you're stuck, I'll show you a hint." },
    { re: /\bconnect (4|four)\b/, say: () => "In Connect Four, drop discs into the columns and get four in a row before I do. The middle columns are a great place to start." },
    { re: /\broblox\b/, say: () => "The Roblox tile in the games list opens the Roblox app, and your call keeps going in the background." },
    { re: /\b(what (should|can|do) (we|i) play|wanna play|want to play|let'?s play|play a game|any games|which game|suggest a game|i'?m bored|im bored|bored)\b/,
      say: (c) => gameIdea(c) },

    // How-to help
    { re: /\b(start|make|begin|create) (a )?(new )?call\b|\bhow (do i|to) call\b/, say: (c) => c.inCall ? "You're already in a call. Tap Invite at the top to bring friends in." : "Tap Start a new call on the start screen, or tap Call next to a friend in your Friends list." },
    { re: /\binvite\b|\bshare (the )?(code|link)\b|\broom code\b/, say: () => "In a call, tap Invite at the top to copy the link. Or tap Call next to a friend on the start screen and they'll get a little card to join." },
    { re: /\bjoin\b/, say: () => "To join a friend, type their room code on the start screen and tap Join, or open the link they sent you." },
    { re: /\b(add|find).{0,10}friend|\bfriend request\b|\bmake friends\b/, say: () => "Open Chats and friends, type your friend's Huddle name in the box at the top, and tap Add. You'll both see each other right away." },
    { re: /\bonline\b|\bgreen dot\b/, say: () => "A green dot on the start screen means that friend has Huddle open right now. A cyan dot means they're in a call." },
    { re: /\bpin(ned)?\b/, say: () => "Hold a message in a chat to pin it. Then tap the three lines at the top and choose Pinned messages to see them all." },
    { re: /\b(photo|picture|pic|image)\b/, say: () => "In a chat, tap the photo button next to the message box to send a picture from your gallery." },
    { re: /\bvoice (note|message)\b|\brecord\b/, say: () => "In a chat, tap the mic button by the message box to record a voice note. Tap it again to send." },
    { re: /\bhow.{0,20}\b(chat|message|text)\b|\bsend (a )?(message|text)\b|\bchats?\b.{0,10}\bwork\b/, say: () => "Tap Chats and friends on the start screen to message your friends. In a call, the speech bubble button opens the call chat." },
    { re: /\bscreen ?share\b|\bshare (my )?screen\b/, say: () => "Screen sharing works on computers in Chrome, and in the Huddle Android app. Look for the screen button at the bottom of a call." },
    { re: /\b(camera|video)\b/, say: () => "The camera button at the bottom turns your video on or off. Before a call, the buttons on the start screen choose how you join." },
    { re: /\b(mic|microphone|mute|unmute)\b/, say: () => "The mic button at the bottom of a call mutes or unmutes you." },
    { re: /\b(volume|loud|quiet|can'?t hear|too loud)\b/, say: () => "Tap the speaker button in a call to change the volume for everyone, or for one friend at a time." },
    { re: /\b(turn (you|pip) off|go away|be quiet|stop talking|mute pip|leave me alone)\b/, say: () => "Okay. You can turn me off for everyone with the Pip switch at the top of a call. I won't mind." },
    { re: /\b(leave|hang up|end) (the )?call\b/, say: () => "Tap the red button at the bottom to leave the call." },
    { re: /\b(sign|log) ?out\b/, say: () => "Open Chats and friends, tap the three lines at the top, then Sign out. You stay signed in until you do." },
    { re: /\b(password|forgot)\b/, say: () => "Passwords can use any letters, numbers, and symbols, up to 25. The eye button shows what you typed." },
    { re: /\b(install|download|get the app|apk|home screen)\b/, say: () => "Tap Get the app at the top of the start screen. On iPhone, use Share then Add to Home Screen. On Android, you can install the Huddle app." },
    { re: /\b(game button|games?)\b/, say: (c) => c.inCall ? "Tap the game controller button at the bottom to see all the games." : "Start or join a call, then tap the game controller button at the bottom." },

    // Feelings
    { re: /\b(sad|upset|down|depressed|cry|crying|unhappy|bad day|rough day)\b/,
      say: () => { lastOffer = "cheer"; return choose(["I'm sorry you're feeling down. Want to talk about it, or would a joke help?", "That sounds hard. I'm here with you. Sometimes calling a friend helps too.", "It's okay to have sad days. Be gentle with yourself. Want a fun fact to take your mind off it?"]); } },
    { re: /\b(lonely|alone|no friends|nobody)\b/,
      say: () => "I'm here with you. And if you want, you can add friends in Chats and friends and call them anytime. You're not alone." },
    { re: /\b(tired|sleepy|exhausted)\b/, say: () => "Sounds like you need some rest. A cozy break might help. I'll be here later." },
    { re: /\b(nervous|anxious|worried|stressed|scared)\b/,
      say: () => "Let's take a slow breath together. In through your nose, and out through your mouth. You're doing okay." },
    { re: /\b(angry|mad|annoyed|frustrated)\b/, say: () => "That's frustrating. It's okay to feel that way. Want to take a break and play something easy?" },
    { re: /\b(happy|great|awesome|excited|good|amazing|fantastic)\b/, say: () => choose(["Yay, I love that for you.", "That makes me happy too.", "Wonderful. Let's keep the good vibes going."]) },
    { re: /\b(encourage|motivat|cheer me up|believe in me)\b/, say: () => choose(ENCOURAGE) },

    // Everyday
    { re: /\bwhat time\b|\bthe time\b/, say: () => `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} where you are.` },
    { re: /\bwhat day\b|\btoday'?s date\b|\bwhat'?s the date\b/, say: () => `Today is ${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.` },
    { re: /\bweather\b/, say: () => "I can't see outside, but I hope it's nice where you are." },
    { re: /\bwho('?s| is) here\b|\bwho('?s| is) (in|on) (the )?call\b/, say: (c) => !c.inCall ? "You're not in a call right now." : c.peers.length ? `${c.peers.length === 1 ? c.peers[0] + " is" : c.peers.slice(0, -1).join(", ") + " and " + c.peers[c.peers.length - 1] + " are"} here with you.` : "It's just you and me so far." },
  ];

  function maths(t) {
    const m = t.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(\+|plus|-|minus|\*|x|times|\/|divided by)\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[3]), op = m[2];
    let r;
    if (op === "+" || op === "plus") r = a + b;
    else if (op === "-" || op === "minus") r = a - b;
    else if (op === "*" || op === "x" || op === "times") r = a * b;
    else { if (b === 0) return "Dividing by zero breaks my brain. Let's not."; r = a / b; }
    return `That's ${Math.round(r * 1000) / 1000}.`;
  }

  function reply(text, context) {
    const t = String(text || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
    const c = { t, name: first(context && context.name), inCall: !!(context && context.inCall), peers: (context && context.peers) || [], game: context && context.game };

    // Finishing a riddle
    if (lastRiddle) {
      const a = lastRiddle[1];
      if (/\b(give up|idk|i don'?t know|no idea|tell me|answer|what is it)\b/.test(t)) { lastRiddle = null; lastOffer = "riddle"; return `The answer is ${a.toLowerCase().replace(/\.$/, "")}. Want another riddle?`; }
      const key = a.toLowerCase().replace(/^(a|an|the|your) /, "").replace(/\.$/, "");
      if (t.includes(key)) { lastRiddle = null; lastOffer = "riddle"; return choose(["You got it. Nice thinking.", "Yes! That's right.", "Correct. You're good at this."]); }
      if (t.split(" ").length <= 4 && !/\?$/.test(t)) return choose(["Not quite. Try again, or say I give up.", "Good guess, but no. One more try?"]);
      lastRiddle = null;
    }
    // Following up an offer: "yes" / "another" / "more"
    if (/^(yes|yeah|yep|sure|ok|okay|please|another|more|again|one more)\b/.test(t)) {
      if (lastOffer === "fact") return choose(FACTS);
      if (lastOffer === "riddle") { lastRiddle = choose(RIDDLES); return lastRiddle[0]; }
      if (lastOffer === "cheer") { lastOffer = "joke"; return choose(JOKES); }
      if (lastOffer === "joke" || !lastOffer) { lastOffer = "joke"; return choose(JOKES); }
    }
    if (/\bwant another riddle\b|^another riddle\b/.test(t)) { lastRiddle = choose(RIDDLES); return lastRiddle[0]; }
    if (/^(no|nope|nah|no thanks)\b/.test(t)) { lastOffer = null; return choose(["Okay, no problem.", "That's alright. I'm here if you change your mind."]); }

    const m = maths(t);
    if (m) return m;
    for (const topic of TOPICS) if (topic.re.test(t)) return topic.say(c);
    if (/\?$/.test(t)) return choose([
      "That's a good question. I don't know that one yet, but I'm always learning. Want a fun fact instead?",
      "Hmm, I'm not sure. I'm best at games, jokes, and Huddle help. Try asking me how to add a friend.",
      "I wish I knew. Want to hear a riddle while I think about it?",
    ]);
    return choose([
      "I like hearing about that. Tell me more?",
      "Oh, interesting. I'm still a learning blob, so I might not always follow along.",
      "Mm hm. I'm here. Want a joke, a riddle, or a game idea?",
      "I'm listening. You can also ask me what to play.",
    ]);
  }

  window.PipBrain = { reply };
})();

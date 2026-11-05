# Huddle (call app shell)

A web app where friends join a room and talk over live voice + video, with a panel reserved for games later. Works in desktop and phone browsers (Chrome, Safari, Firefox). No phone numbers or real phone calls; everything runs in the browser.

## What's in it
- **Lobby:** your name, camera/mic preview with on/off toggles, "Start a new call" (makes a room code), or join with a code. Invite links look like `https://your-site/r/ABC123` and drop people straight into that room's join screen.
- **Call screen:** auto-sizing video grid, name labels, muted icon, avatar when someone's camera is off, glow on whoever is talking, "Connecting…" status per person.
- **Your own video:** hidden by default. The person button at the bottom right of the videos shows or hides it.
- **Full screen:** the button at the bottom right of the videos makes one person fill the screen with no buttons on top. Tap anywhere to bring up the controls at the bottom right: exit full screen, switch camera (on phones), switch person (cycles through everyone, including yourself), and game. They hide again after 4 seconds.
- **Controls:** mute, camera on/off (fully releases the camera), switch front/back camera (phones), volume, chat, game panel, hang up.
- **Volume:** one slider for everyone plus a slider per person. These only change what you hear.
- **Silent mode:** turns off all sound from the app. The app has no beeps or alert sounds, so the only audio is people's voices. Your mic is a separate control. Volume and silent mode are remembered on that device.
- **Chat:** a text chat panel in the call, with an unread badge and a preview pop-up for new messages. People who join late see the last 50 messages. Chat is deleted when everyone leaves. On phones, the call screen shrinks to fit above the keyboard and the call buttons hide while you type.
- **Game panel:** empty placeholder at `#gameArea` (side panel on desktop, bottom sheet on phones). `window.huddle` exposes the mount point, room and peers for the game layer.

- **Locking the phone or switching apps:** the call keeps going with your mic, camera and sound on, as long as the phone lets the page run. Android usually keeps it running. iPhone pauses web pages soon after locking, and Huddle reconnects you when you come back. If someone's video stops arriving, others see their avatar instead of a frozen picture.
- **No notifications, on purpose:** Huddle never asks for notification permission, plays no ringtones or sounds, and shows nothing on the lock screen.
- **Phone volume buttons:** call audio already follows the phone's own volume, so all the way down means no sound.

## Install it as an app (PWA)
Huddle works in the browser on iPhone, Android, Mac, Windows and Chromebook, and can be installed like an app:
- The first time someone opens the link (and isn't using the installed app), a "Get the Huddle app" popup shows the steps for their device. "Not now" hides it for good on that device, and the "Get the app" button on the start screen opens it again.
- **Android and computers (Chrome, Edge, Samsung Internet):** one tap on "Install Huddle". Other browsers get step-by-step menu instructions.
- **iPhone and iPad (Safari):** the start screen shows how: tap Share, then Add to Home Screen.
The installed app opens full screen with its own icon and still opens without internet (calls need a connection). Installing needs the https link; it won't offer to install from a plain http address.

## How calling works
- `server.js` serves the app and relays connection setup messages ("signaling") over a WebSocket at `/ws`. It never touches audio or video.
- Each person connects directly to every other person with WebRTC (a "mesh"). That's great for up to about 6-8 people, which is the default room cap (`MAX_PER_ROOM`).

## Video quality
Quality adjusts to the size of the call (see `PROFILES` in `public/app.js`):
- **2 people:** 720p at 60fps (up to 4 Mbps)
- **3-4 people:** 720p at 30fps (1.5 Mbps per person)
- **5-8 people:** 360p at 24fps (0.6 Mbps per person)

Cameras that can't do 60fps (most laptop webcams, many Android phones) stay at 720p and run at 30fps. Video starts a bit soft and sharpens over the first 10-15 seconds while the browser measures the connection. Slow connections get scaled down automatically.

## Run it locally
```bash
npm install
npm start          # http://localhost:3000
```
Open it in two browser tabs to try a call with yourself. Camera/mic only work on `localhost` or over **https**, so to call friends you need to deploy it (or tunnel it).

## Call friends quickly (temporary link)
With it running locally: `npx cloudflared tunnel --url http://localhost:3000` prints an https link anyone can open.

## Deploy (permanent link)
Any Node host with WebSocket support works. Render.com example:
1. Push this folder to a GitHub repo.
2. Render, New, Web Service, pick the repo. Build command `npm install`, start command `npm start`.
3. Share the `https://...onrender.com` link.

## Optional: TURN server
Most calls connect with the built-in free STUN servers. Some networks (some cell carriers, school/work wifi) block direct connections; for those, add a TURN server (e.g. Metered, Twilio, Cloudflare) with these environment variables:
```
TURN_URL=turn:your.turn.host:3478,turns:your.turn.host:443
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

## Android app

`native/` wraps the live site in a Capacitor Android app that adds phone screen sharing
(Android MediaProjection) and keeps calls running in the background (a silent foreground
service; Huddle never asks for notification permission). GitHub Actions
(`.github/workflows/android.yml`) builds it on every change under `native/` and publishes
`huddle.apk` to Releases: https://github.com/LandonWebster/Huddle/releases/latest/download/huddle.apk

Release signing: the first build after the `HUDDLE_KEY_PASS` repository secret is added creates the
permanent key and commits it encrypted (`native/android/app/huddle-release.keystore.enc`). Without the secret CI makes a test-signed APK.

## Games

The Game button opens a Games area next to the call (the call keeps going while you play).
- **Butter Clicker** (`public/games/butter.js`, server rules in `games/butter.js`): co-op clicker.
  Everyone taps one shared tub of butter; upgrades are bought from the shared pool; each extra
  player adds a 10% team bonus. The server keeps the score so late joiners catch up.
- **Roblox**: opens the Roblox app (Play Store / App Store if it isn't installed).

Add a game with `HuddleGames.register({ id, title, subtitle, icon, mount(el, huddle) })` on the
page and, for shared state, a module in `games/` listed in `games/index.js`.

## Connection relay (TURN)

Some networks block direct connections between devices (phone carriers, some home routers,
school or work wifi). Calls then stay on "Connecting…". A TURN relay fixes this. Cloudflare's
is free for normal use: create a TURN key in the Cloudflare dashboard (Realtime > TURN), then
set `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` in the Render service's Environment. Tapping
"Connecting…" on a tile shows which network paths each side found.

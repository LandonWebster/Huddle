# Huddle iPhone app: what to do once you have an Apple account

The iPhone app is built and checked automatically (GitHub runs the "iPhone app" check on a Mac).
It just can't go on a phone yet, because Apple only installs apps that are signed with a paid
Apple Developer account. Here's the list for when that day comes. Claude can do most of it with you.

## What the iPhone app already does

- Opens the live Huddle site, like the Android app.
- **Calls ring like real phone calls** (Apple's CallKit), full screen, even when Huddle is closed.
  The server still needs to send the "wake up, you have a call" message (step 6).
- **Alarms ring like the Clock app** on iOS 26 and newer (Apple's AlarmKit): loud, full screen,
  through Silent mode. Older iPhones get a notification with a sound instead.
- **Sleep Mode can lock other apps** (Apple's Screen Time tools). You pick the apps; while Sleep
  Mode is on they show a "can't open" screen. Phone and Huddle always stay open.
- **Sleep Focus link**: in Settings > Focus > Sleep > Add Filter > Huddle, turning on Sleep Focus can
  turn on Huddle's Sleep Mode. (Apple doesn't let any app turn Focus on by itself.)
- Pip talks and listens, notifications, opening Roblox.
- Not on iPhone: sharing your whole screen in a call, and changing the phone's volume (Apple doesn't allow it).

## Checklist

1. **Get the Apple Developer account** ($99 a year, at developer.apple.com/programs).
   The account holder has to be 18 or older, so a parent or guardian signs up and can add you.
2. **Get a Mac, or skip it.** A Mac with Xcode is easiest for the first test. Without one,
   GitHub's Mac can build and upload the app for you (Claude can set that up with your account keys).
3. **Make the app's ID.** In the Apple Developer website: Certificates, IDs & Profiles > Identifiers > +,
   Bundle ID `com.landonwebster.huddle`. Turn on: Push Notifications, Family Controls, Time Sensitive Notifications.
4. **Ask Apple for Screen Time permission.** Testing on your own phone works right away. For TestFlight
   and the App Store, fill in Apple's Family Controls request form
   (developer.apple.com/contact/request/family-controls-distribution) and say it's for Sleep Mode.
   Apple can take a few weeks. Until they say yes, release without it (remove the
   `family-controls` line from `App/App/App.entitlements`); everything else still works.
5. **Signing.** In Xcode: open `native/ios/App/App.xcodeproj`, click App > Signing & Capabilities,
   tick "Automatically manage signing" and pick your team. (Or give Claude the App Store Connect API key
   to do it on GitHub.)
6. **Make calls and chats reach a closed iPhone.** In the developer website: Keys > + > Apple Push
   Notifications service, download the .p8 key. Put it in Render as environment variables
   (`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`). Then ask Claude to add "send iPhone pushes" to the server.
   The app already gives the site its push addresses (the `pushToken` method).
7. **Test on your own iPhone** (from Xcode with a cable, or step 8).
8. **TestFlight.** In App Store Connect (appstoreconnect.apple.com): My Apps > + > New App, name Huddle,
   bundle ID from step 3. Upload a build (Xcode: Product > Archive > Distribute). Add testers by
   email; they install the TestFlight app and get Huddle.
9. **App Store.** Fill in the App Store page: screenshots, description, age rating, privacy answers
   (camera, microphone, contacts you add, payments), and a support web page. Send it for review.
   Apple usually answers in 1 to 3 days. Things they check for Huddle: Sign in with Apple is needed
   only if Huddle adds Google/Facebook sign-in; paid phone credit must follow Apple's in-app purchase
   rules; a way to block and report people (Huddle has this).
10. **Before the App Store build**, change `aps-environment` in `App/App.entitlements` from
    `development` to `production`.

## For Claude (technical notes)

- Capacitor 8 iOS project, Swift Package Manager (no CocoaPods). Native code is in `App/App/*.swift`,
  registered in `HuddleViewController.capacitorDidLoad`. Plugin names match Android
  (`HuddleNative`, `HuddleSleepFocus`), so the site needs no changes.
- VoIP push payload: `{ "id": uuid, "caller": "Name", "url": "/?join=CODE", "video": true }`;
  `{ "id": same, "cancel": true }` stops the ringing. Push type `voip`, topic `com.landonwebster.huddle.voip`.
  iOS ends the app's VoIP access if a VoIP push doesn't show a call, so only send them for real calls.
- New page events: `pushToken` {voip|apns}, `callAnswered` {id,url}, `callEnded` {id}, `focusChanged` {focusSleep}.
- Calls inside WKWebView: test on a device that CallKit's audio session doesn't cut the WebRTC audio.
- `npx cap sync ios` (in `native/`) after changing `capacitor.config.json`.

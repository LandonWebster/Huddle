import Foundation
import UIKit
import AVFoundation
import Speech
import UserNotifications
import Capacitor

/// Bridge between the Huddle web app and iPhone. Same name and methods as the Android app's
/// HuddleNativePlugin, so the site works in both without changes:
///
///  startCall / endCall         a Huddle call is a real iPhone call (CallKit), so it keeps running locked
///  speak / stopSpeaking        Pip's voice (the phone's own text-to-speech)
///  listen / stopListening      talk to Pip: speech to text (partial words arrive as "speechPartial")
///  setAlarms                   the Alarms tab's alarms and timer as real iPhone alarms (HuddleAlarms)
///  notifyStatus / requestNotifications / openAlarmSettings   permission to notify and to ring alarms
///  showNotification            a chat or call-invite notification while Huddle is in the background
///  openApp                     opens Roblox (or its App Store page)
///  pushToken                   this phone's push addresses, for the server (calls and chats when closed)
///  setCallVolume / restoreVolume, startScreenShare   not possible on iPhone; they answer politely
///
/// Events sent to the page: "speechPartial", "pushToken", "callAnswered", "callEnded".
@objc(HuddleNativePlugin)
public class HuddleNativePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "HuddleNativePlugin"
    public let jsName = "HuddleNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAlarms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notifyStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAlarmSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openApp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCallVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScreenShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScreenShare", returnType: CAPPluginReturnPromise),
    ]

    private static weak var instance: HuddleNativePlugin?
    /// A page to open once the web view is ready (a call answered while Huddle was closed).
    private static var pendingPath: String?

    override public func load() {
        HuddleNativePlugin.instance = self
        synth.delegate = self
        if let p = HuddleNativePlugin.pendingPath {
            HuddleNativePlugin.pendingPath = nil
            HuddleNativePlugin.open(path: p)
        }
    }

    static func emit(_ event: String, _ data: [String: Any]) {
        DispatchQueue.main.async { instance?.notifyListeners(event, data: data) }
    }

    /// Opens a Huddle page ("/chats/…", "/?join=…") in the app.
    static func open(path: String) {
        DispatchQueue.main.async {
            guard let p = instance, let bridge = p.bridge, let webView = bridge.webView else {
                pendingPath = path
                return
            }
            let base = bridge.config.serverURL
            guard let url = URL(string: path, relativeTo: base), url.host == base.host else { return }
            webView.load(URLRequest(url: url))
        }
    }

    // ---------- Calls ----------
    @objc func startCall(_ call: CAPPluginCall) {
        CallManager.shared.startInAppCall(name: call.getString("name") ?? "Huddle call",
                                          video: call.getBool("video") ?? true)
        call.resolve(["running": true])
    }

    @objc func endCall(_ call: CAPPluginCall) {
        CallManager.shared.endAll()
        call.resolve()
    }

    @objc func pushToken(_ call: CAPPluginCall) {
        let d = UserDefaults.standard
        call.resolve([
            "platform": "ios",
            "voip": d.string(forKey: HuddleKeys.voipToken) ?? "",
            "apns": d.string(forKey: HuddleKeys.apnsToken) ?? "",
        ])
    }

    // ---------- Pip's voice ----------
    private let synth = AVSpeechSynthesizer()
    private var speaking: [ObjectIdentifier: CAPPluginCall] = [:]

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        if text.isEmpty { call.resolve(); return }
        DispatchQueue.main.async {
            if self.synth.isSpeaking { self.synth.stopSpeaking(at: .immediate) }
            let u = AVSpeechUtterance(string: text)
            u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * (call.getFloat("rate") ?? 1))
            u.pitchMultiplier = max(0.5, min(2, call.getFloat("pitch") ?? 1))
            u.volume = max(0, min(1, call.getFloat("volume") ?? 1))
            self.speaking[ObjectIdentifier(u)] = call
            self.synth.speak(u)
        }
    }

    private func finish(_ u: AVSpeechUtterance) {
        speaking.removeValue(forKey: ObjectIdentifier(u))?.resolve()
    }
    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { finish(u) }
    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { finish(u) }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synth.stopSpeaking(at: .immediate)
            let pending = self.speaking.values
            self.speaking.removeAll()
            pending.forEach { $0.resolve() }
            call.resolve()
        }
    }

    // ---------- Talking to Pip ----------
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let audio = AVAudioEngine()
    private var listenCall: CAPPluginCall?
    private var heard = ""
    private var silence: Timer?

    @objc func listen(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { call.reject("no-mic"); return }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                DispatchQueue.main.async {
                    guard ok else { call.reject("no-mic"); return }
                    self.startListening(call)
                }
            }
        }
    }

    private func startListening(_ call: CAPPluginCall) {
        if listenCall != nil { endListen(error: "replaced") }
        guard let rec = SFSpeechRecognizer(), rec.isAvailable else { call.reject("not-available"); return }
        listenCall = call
        heard = ""
        recognizer = rec
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        let input = audio.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
        do {
            audio.prepare()
            try audio.start()
        } catch {
            endListen(error: "start-failed")
            return
        }
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.listenCall != nil else { return }
                if let r = result {
                    self.heard = r.bestTranscription.formattedString
                    self.notifyListeners("speechPartial", data: ["text": self.heard])
                    if r.isFinal { self.endListen(error: nil); return }
                    // A pause in talking ends it, like on Android.
                    self.silence?.invalidate()
                    self.silence = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in self.endListen(error: nil) }
                } else if error != nil {
                    self.endListen(error: nil) // no words heard counts as an empty answer
                }
            }
        }
        // Nothing said at all: give up after a while.
        silence = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in self?.endListen(error: nil) }
    }

    private func endListen(error: String?) {
        silence?.invalidate(); silence = nil
        if audio.isRunning { audio.stop() }
        audio.inputNode.removeTap(onBus: 0)
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
        recognizer = nil
        guard let c = listenCall else { return }
        listenCall = nil
        if let e = error { c.reject(e) } else { c.resolve(["text": heard]) }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endListen(error: nil)
            call.resolve()
        }
    }

    // ---------- Alarms ----------
    @objc func setAlarms(_ call: CAPPluginCall) {
        let list = call.getArray("alarms", JSObject.self) ?? []
        let timer = call.getDouble("timer") ?? 0
        let settings = HuddleAlarms.Settings(name: call.getString("name") ?? "",
                                             sound: call.getBool("sound") ?? true)
        Task {
            let exact = await HuddleAlarms.shared.set(list.compactMap(HuddleAlarms.Alarm.init), timerEndMs: timer, settings: settings)
            call.resolve(["exact": exact])
        }
    }

    @objc func openAlarmSettings(_ call: CAPPluginCall) {
        Task {
            let ok = await HuddleAlarms.shared.requestAuthorization()
            if !ok { await HuddleNativePlugin.openSettings() }
            call.resolve()
        }
    }

    // ---------- Notifications ----------
    @objc func notifyStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let allowed = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
            call.resolve(["notifications": allowed, "exactAlarms": HuddleAlarms.shared.authorized])
        }
    }

    @objc func requestNotifications(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { s in
            if s.authorizationStatus == .notDetermined {
                center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in call.resolve() }
            } else {
                // Asked before: the switch is in the iPhone's Settings.
                Task { await HuddleNativePlugin.openSettings(); call.resolve() }
            }
        }
    }

    @MainActor static func openSettings() async {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            await UIApplication.shared.open(url)
        }
    }

    @objc func showNotification(_ call: CAPPluginCall) {
        let ringing = call.getString("channel") == "calls"
        let silent = call.getBool("silent") ?? false
        let c = UNMutableNotificationContent()
        c.title = call.getString("title") ?? "Huddle"
        c.body = call.getString("body") ?? ""
        c.userInfo = ["url": call.getString("url") ?? "/"]
        c.threadIdentifier = ringing ? "calls" : "messages"
        if !silent { c.sound = ringing ? UNNotificationSound.defaultRingtone : .default }
        if #available(iOS 15.0, *) { c.interruptionLevel = ringing ? .timeSensitive : .active }
        let req = UNNotificationRequest(identifier: call.getString("tag") ?? UUID().uuidString, content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req) { _ in call.resolve() }
    }

    // ---------- Other apps ----------
    /// Android package names the site uses, and the matching iPhone app link and App Store page.
    private static let apps: [String: (scheme: String, store: String)] = [
        "com.roblox.client": ("roblox://", "https://apps.apple.com/app/roblox/id431946152"),
    ]

    @objc func openApp(_ call: CAPPluginCall) {
        guard let app = HuddleNativePlugin.apps[call.getString("package") ?? ""],
              let appURL = URL(string: app.scheme), let storeURL = URL(string: app.store) else {
            call.reject("unknown app")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(appURL) { opened in
                if opened { call.resolve(["opened": "app"]); return }
                UIApplication.shared.open(storeURL) { _ in call.resolve(["opened": "store"]) }
            }
        }
    }

    // ---------- Not possible on iPhone ----------
    // Apps can't change the iPhone's volume (the person uses the side buttons).
    @objc func setCallVolume(_ call: CAPPluginCall) { call.resolve(["supported": false]) }
    @objc func restoreVolume(_ call: CAPPluginCall) { call.resolve(["supported": false]) }
    // Sharing the whole iPhone screen needs a separate "broadcast" add-on (a later step).
    @objc func startScreenShare(_ call: CAPPluginCall) { call.reject("Screen sharing isn't available on iPhone yet", "UNAVAILABLE") }
    @objc func stopScreenShare(_ call: CAPPluginCall) { call.resolve() }
}

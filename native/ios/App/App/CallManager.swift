import Foundation
import AVFoundation
import CallKit
import PushKit

/// Huddle calls as real iPhone calls.
///
/// Incoming: the Huddle server sends a VoIP push (PushKit) to this phone. iOS wakes Huddle, even when
/// it's closed, and we show the call on the iPhone's own full-screen call screen (CallKit), ringing
/// like a phone call. Answer opens the call in Huddle.
///
/// Push payload the server sends (JSON):
///   { "id": "<uuid>", "caller": "Dana", "url": "/?join=ABCD", "video": true }
///   { "id": "<same uuid>", "cancel": true }      the caller hung up before you answered
///
/// In the app: while you're in a Huddle call it's reported as an ongoing call, so iOS keeps the
/// microphone running when the phone is locked and shows the green call pill.
final class CallManager: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
    static let shared = CallManager()

    private let provider: CXProvider
    private let controller = CXCallController()
    private var registry: PKPushRegistry?
    private var urls: [UUID: String] = [:]
    private var active: Set<UUID> = []

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func startPushKit() {
        let r = PKPushRegistry(queue: .main)
        r.delegate = self
        r.desiredPushTypes = [.voIP]
        registry = r
    }

    // ---------- PushKit ----------
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: HuddleKeys.voipToken)
        HuddleNativePlugin.emit("pushToken", ["voip": hex])
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        UserDefaults.standard.removeObject(forKey: HuddleKeys.voipToken)
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType, completion: @escaping () -> Void) {
        let d = payload.dictionaryPayload
        let id = (d["id"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
        let caller = (d["caller"] as? String) ?? "Huddle call"
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: caller)
        update.localizedCallerName = caller
        update.hasVideo = (d["video"] as? Bool) ?? true
        // Apple requires every VoIP push to show a call, even a "never mind" one,
        // so a cancel is shown and ended right away.
        let cancel = (d["cancel"] as? Bool) ?? false
        if !cancel { urls[id] = (d["url"] as? String) ?? "/" }
        provider.reportNewIncomingCall(with: id, update: update) { [weak self] _ in
            if cancel { self?.provider.reportCall(with: id, endedAt: Date(), reason: .remoteEnded) }
            completion()
        }
    }

    // ---------- Calls started in the app ----------
    func startInAppCall(name: String, video: Bool) {
        guard active.isEmpty else { return }
        let id = UUID()
        let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: name))
        action.isVideo = video
        controller.request(CXTransaction(action: action)) { _ in }
    }

    func endAll() {
        for id in active {
            controller.request(CXTransaction(action: CXEndCallAction(call: id))) { _ in }
        }
    }

    // ---------- CallKit ----------
    func providerDidReset(_ provider: CXProvider) {
        active.removeAll()
        urls.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        active.insert(action.callUUID)
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        provider.reportOutgoingCall(with: action.callUUID, connectedAt: Date())
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        active.insert(action.callUUID)
        let url = urls.removeValue(forKey: action.callUUID) ?? "/"
        HuddleNativePlugin.open(path: url)
        HuddleNativePlugin.emit("callAnswered", ["id": action.callUUID.uuidString, "url": url])
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        active.remove(action.callUUID)
        urls.removeValue(forKey: action.callUUID)
        HuddleNativePlugin.emit("callEnded", ["id": action.callUUID.uuidString])
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}
    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}

import Foundation
import SwiftUI
import UIKit
import Capacitor
#if canImport(FamilyControls)
import FamilyControls
import ManagedSettings
#endif

/// Sleep Mode's "Quiet other apps" (public/sleep.js), same name and methods as the Android app.
///
/// On iPhone this uses Apple's Screen Time tools: while Sleep Mode is on, the apps the person picked
/// are covered by a "Huddle Sleep Mode" screen and can't be opened, and turning Sleep Mode off
/// uncovers them. Phone, Messages to emergency contacts and Huddle itself always stay open.
/// Needs Apple's Family Controls permission for the app (see native/ios/APPLE-CHECKLIST.md).
///
///  status        { supported, access, active, focusSleep }
///  requestAccess asks for Screen Time permission, then shows Apple's app picker
///  start / stop  cover / uncover the picked apps
///  chooseApps    shows the app picker again
///  openFocusSettings  the Settings app, to set up Sleep Focus (apps can't turn Focus on themselves)
///
/// Huddle also offers a Focus filter: in Settings > Focus > Sleep > Add Filter > Huddle, Sleep Focus
/// can switch on Huddle Sleep Mode. The site hears it as the "focusChanged" event.
@objc(HuddleSleepFocusPlugin)
public class HuddleSleepFocusPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HuddleSleepFocusPlugin"
    public let jsName = "HuddleSleepFocus"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chooseApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openFocusSettings", returnType: CAPPluginReturnPromise),
    ]

    private var focusObserver: NSObjectProtocol?

    override public func load() {
        focusObserver = NotificationCenter.default.addObserver(forName: .huddleFocusChanged, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("focusChanged", data: ["focusSleep": UserDefaults.standard.bool(forKey: HuddleKeys.focusSleep)])
        }
    }

    deinit {
        if let o = focusObserver { NotificationCenter.default.removeObserver(o) }
    }

    private var supported: Bool {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) { return true }
        #endif
        return false
    }

    private var hasAccess: Bool {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) { return AuthorizationCenter.shared.authorizationStatus == .approved }
        #endif
        return false
    }

    private func state() -> [String: Any] {
        let d = UserDefaults.standard
        return [
            "supported": supported,
            "access": hasAccess,
            "active": d.bool(forKey: HuddleKeys.sleepActive),
            "focusSleep": d.bool(forKey: HuddleKeys.focusSleep),
        ]
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(state())
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) {
            Task { @MainActor in
                if !self.hasAccess {
                    try? await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                }
                if self.hasAccess && UserDefaults.standard.data(forKey: HuddleKeys.sleepSelection) == nil {
                    await self.pickApps()
                }
                call.resolve(self.state())
            }
            return
        }
        #endif
        call.resolve(state())
    }

    @objc func chooseApps(_ call: CAPPluginCall) {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *), hasAccess {
            Task { @MainActor in
                await self.pickApps()
                if UserDefaults.standard.bool(forKey: HuddleKeys.sleepActive) { self.shield(true) }
                call.resolve(self.state())
            }
            return
        }
        #endif
        call.resolve(state())
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.hasAccess {
                self.shield(true)
                UserDefaults.standard.set(true, forKey: HuddleKeys.sleepActive)
            }
            call.resolve(self.state())
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.shield(false)
            UserDefaults.standard.set(false, forKey: HuddleKeys.sleepActive)
            call.resolve(self.state())
        }
    }

    @objc func openFocusSettings(_ call: CAPPluginCall) {
        Task {
            await HuddleNativePlugin.openSettings()
            call.resolve()
        }
    }

    // ---------- Screen Time ----------
    private func shield(_ on: Bool) {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) {
            let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("huddleSleep"))
            guard on else { store.clearAllSettings(); return }
            if let sel = savedSelection(), !(sel.applicationTokens.isEmpty && sel.categoryTokens.isEmpty) {
                store.shield.applications = sel.applicationTokens
                store.shield.applicationCategories = .specific(sel.categoryTokens)
                store.shield.webDomains = sel.webDomainTokens
            } else {
                // Nothing picked: cover every app (the system keeps Phone and Huddle open).
                store.shield.applicationCategories = .all()
            }
        }
        #endif
    }

    #if canImport(FamilyControls)
    @available(iOS 16.0, *)
    private func savedSelection() -> FamilyActivitySelection? {
        guard let data = UserDefaults.standard.data(forKey: HuddleKeys.sleepSelection) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    /// Apple's own app picker (Apple keeps the list private; Huddle only gets locked tokens).
    @available(iOS 16.0, *)
    @MainActor
    private func pickApps() async {
        guard let host = bridge?.viewController else { return }
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            var sheet: UIViewController?
            let picker = SleepAppPicker(initial: savedSelection() ?? FamilyActivitySelection()) { selection in
                if let selection = selection, let data = try? JSONEncoder().encode(selection) {
                    UserDefaults.standard.set(data, forKey: HuddleKeys.sleepSelection)
                }
                sheet?.dismiss(animated: true)
                done.resume()
            }
            let vc = UIHostingController(rootView: picker)
            vc.isModalInPresentation = true
            sheet = vc
            host.present(vc, animated: true)
        }
    }
    #endif
}

#if canImport(FamilyControls)
@available(iOS 16.0, *)
private struct SleepAppPicker: View {
    @State var selection: FamilyActivitySelection
    let finish: (FamilyActivitySelection?) -> Void

    init(initial: FamilyActivitySelection, finish: @escaping (FamilyActivitySelection?) -> Void) {
        _selection = State(initialValue: initial)
        self.finish = finish
    }

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Apps to quiet while you sleep")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { finish(nil) } }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { finish(selection) } }
                }
        }
    }
}
#endif

extension Notification.Name {
    static let huddleFocusChanged = Notification.Name("huddleFocusChanged")
}

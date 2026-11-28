import UIKit
import UserNotifications
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Incoming Huddle calls ring like real phone calls (CallKit), even when Huddle is closed:
        // the server wakes the phone with a VoIP push (PushKit) and CallManager shows the call.
        CallManager.shared.startPushKit()
        // Regular pushes (chats, missed calls) once the server sends them through Apple.
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: HuddleKeys.apnsToken)
        HuddleNativePlugin.emit("pushToken", ["apns": hex])
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Normal without an Apple developer account (no push permission in the build).
    }

    // A Huddle notification while Huddle is open: still show it.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    // Tapping a notification opens the page it's about (a chat, a call invite).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let url = response.notification.request.content.userInfo["url"] as? String {
            HuddleNativePlugin.open(path: url)
        }
        completionHandler()
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

enum HuddleKeys {
    static let apnsToken = "huddle.apnsToken"
    static let voipToken = "huddle.voipToken"
    static let alarmIds = "huddle.alarmIds"
    static let sleepSelection = "huddle.sleepSelection"
    static let sleepActive = "huddle.sleepActive"
    static let focusSleep = "huddle.focusSleep"
}

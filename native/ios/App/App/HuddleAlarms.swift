import Foundation
import SwiftUI
import UserNotifications
import Capacitor
#if canImport(AlarmKit)
import AlarmKit
#endif

/// Real iPhone alarms for the Huddle Alarms tab.
///
/// iOS 26 and newer: Apple's AlarmKit. These ring like the Clock app's alarms: full screen, loud,
/// on the Lock Screen, through Silent mode and Focus, even when Huddle is closed or the phone restarted.
/// Older iPhones: a time-sensitive notification with a sound at the alarm time (the best Apple allows there).
///
/// The site sends: alarms [{ id, h, m, days: [0..6 Sun..Sat], label, on }], timer (ms when it ends, or 0).
final class HuddleAlarms {
    static let shared = HuddleAlarms()

    struct Settings {
        let name: String
        let sound: Bool
    }

    struct Entry {
        let id: String
        let h: Int
        let m: Int
        let days: [Int]
        let label: String
        let on: Bool

        init?(_ o: JSObject) {
            guard let rawId = o["id"] else { return nil }
            id = "\(rawId)"
            h = HuddleAlarms.int(o["h"]) ?? 7
            m = HuddleAlarms.int(o["m"]) ?? 0
            days = ((o["days"] as? JSArray) ?? []).compactMap { HuddleAlarms.int($0) }.filter { (0...6).contains($0) }
            label = (o["label"] as? String) ?? ""
            on = (o["on"] as? Bool) ?? false
        }
    }

    static func int(_ v: Any?) -> Int? {
        if let n = v as? NSNumber { return n.intValue }
        if let s = v as? String { return Int(s) }
        return nil
    }

    private static let notePrefix = "huddle-alarm-"

    /// Allowed to ring real alarms (AlarmKit). On older iPhones there is nothing extra to allow.
    var authorized: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return AlarmManager.shared.authorizationState == .authorized }
        #endif
        return true
    }

    func requestAuthorization() async -> Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let mgr = AlarmManager.shared
            if mgr.authorizationState == .notDetermined { _ = try? await mgr.requestAuthorization() }
            return mgr.authorizationState == .authorized
        }
        #endif
        return (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }

    /// Replaces every Huddle alarm on the phone with this list. Returns true when they are real alarms.
    func set(_ alarms: [Entry], timerEndMs: Double, settings: Settings) async -> Bool {
        await clearNotifications()
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), await requestAuthorization() {
            await setAlarmKit(alarms, timerEndMs: timerEndMs, settings: settings)
            return true
        }
        #endif
        await setNotifications(alarms, timerEndMs: timerEndMs, settings: settings)
        return false
    }

    private func title(_ a: Entry, _ s: Settings) -> String {
        if !a.label.isEmpty { return a.label }
        if a.h < 12 && !s.name.isEmpty { return "Good morning, \(s.name)" }
        return "Huddle alarm"
    }

    // ---------- AlarmKit (iOS 26+) ----------
    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private static let weekdays: [Locale.Weekday] = [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday]

    @available(iOS 26.0, *)
    private func setAlarmKit(_ alarms: [Entry], timerEndMs: Double, settings: Settings) async {
        let mgr = AlarmManager.shared
        let d = UserDefaults.standard
        for s in d.stringArray(forKey: HuddleKeys.alarmIds) ?? [] {
            if let id = UUID(uuidString: s) { try? mgr.cancel(id: id) }
        }
        var ids: [String] = []
        for a in alarms where a.on {
            let days = a.days.map { HuddleAlarms.weekdays[$0] }
            let time = AlarmKit.Alarm.Schedule.Relative.Time(hour: a.h, minute: a.m)
            let rel = AlarmKit.Alarm.Schedule.Relative(time: time, repeats: days.isEmpty ? .never : .weekly(days))
            let id = UUID()
            if (try? await mgr.schedule(id: id, configuration: config(title(a, settings), .relative(rel)))) != nil {
                ids.append(id.uuidString)
            }
        }
        let end = Date(timeIntervalSince1970: timerEndMs / 1000)
        if timerEndMs > 0 && end > Date() {
            let id = UUID()
            if (try? await mgr.schedule(id: id, configuration: config("Timer's done", .fixed(end)))) != nil {
                ids.append(id.uuidString)
            }
        }
        d.set(ids, forKey: HuddleKeys.alarmIds)
    }

    @available(iOS 26.0, *)
    private func config(_ title: String, _ schedule: AlarmKit.Alarm.Schedule) -> AlarmManager.AlarmConfiguration<HuddleAlarmData> {
        let stop = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
        let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title), stopButton: stop)
        let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert),
                                         metadata: HuddleAlarmData(label: title),
                                         tintColor: Color(red: 0.13, green: 0.83, blue: 0.93))
        return .alarm(schedule: schedule, attributes: attributes)
    }
    #endif

    // ---------- Notifications (older iPhones) ----------
    private func clearNotifications() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(HuddleAlarms.notePrefix) })
    }

    private func setNotifications(_ alarms: [Entry], timerEndMs: Double, settings: Settings) async {
        let center = UNUserNotificationCenter.current()
        func content(_ title: String) -> UNMutableNotificationContent {
            let c = UNMutableNotificationContent()
            c.title = title
            c.body = "Tap to open Huddle"
            c.userInfo = ["url": "/"]
            if settings.sound { c.sound = .defaultRingtone }
            if #available(iOS 15.0, *) { c.interruptionLevel = .timeSensitive }
            return c
        }
        for a in alarms where a.on {
            let days: [Int?] = a.days.isEmpty ? [nil] : a.days
            for day in days {
                var when = DateComponents()
                when.hour = a.h
                when.minute = a.m
                if let day = day { when.weekday = day + 1 } // 1 = Sunday
                let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: day != nil)
                let id = "\(HuddleAlarms.notePrefix)\(a.id)-\(day ?? -1)"
                try? await center.add(UNNotificationRequest(identifier: id, content: content(title(a, settings)), trigger: trigger))
            }
        }
        let wait = timerEndMs / 1000 - Date().timeIntervalSince1970
        if timerEndMs > 0 && wait > 0 {
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "\(HuddleAlarms.notePrefix)timer", content: content("Timer's done"), trigger: trigger))
        }
    }
}

#if canImport(AlarmKit)
/// Extra info kept with each alarm (AlarmKit needs a type for it).
@available(iOS 26.0, *)
struct HuddleAlarmData: AlarmMetadata {
    var label: String
}
#endif

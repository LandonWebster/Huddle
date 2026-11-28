import AppIntents
import Foundation

/// A Focus filter: in the iPhone's Settings > Focus > Sleep > Add Filter > Huddle, the person can
/// have Sleep Focus turn on Huddle's Sleep Mode (and turn it off again in the morning).
/// Apple doesn't let apps turn Focus on themselves, so this is the link the other way around.
@available(iOS 16.0, *)
struct HuddleSleepFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "Huddle Sleep Mode"
    static var description: IntentDescription? = IntentDescription("Turn on Huddle's Sleep Mode with this Focus.")

    @Parameter(title: "Sleep Mode", default: true)
    var sleepMode: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: sleepMode ? "Sleep Mode on" : "Sleep Mode off")
    }

    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(sleepMode, forKey: HuddleKeys.focusSleep)
        await MainActor.run {
            NotificationCenter.default.post(name: .huddleFocusChanged, object: nil)
        }
        return .result()
    }
}

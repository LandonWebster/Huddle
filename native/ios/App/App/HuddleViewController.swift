import UIKit
import Capacitor

/// The Huddle screen: Capacitor's web view showing the live Huddle site, plus Huddle's own
/// iPhone code (the plugins below), which the site reaches through window.Capacitor.
class HuddleViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HuddleNativePlugin())
        bridge?.registerPluginInstance(HuddleSleepFocusPlugin())
    }
}

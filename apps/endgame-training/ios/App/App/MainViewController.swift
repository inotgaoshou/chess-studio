import Capacitor
import UIKit

final class MainViewController: CAPBridgeViewController {
    override var shouldAutorotate: Bool {
        true
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        TrainingOrientationLock.mask
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TrainingStorePlugin())
        bridge?.registerPluginInstance(ScreenOrientationPlugin())
        bridge?.registerPluginInstance(CloudBookPlugin())
        bridge?.registerPluginInstance(PikafishPlugin())
    }
}

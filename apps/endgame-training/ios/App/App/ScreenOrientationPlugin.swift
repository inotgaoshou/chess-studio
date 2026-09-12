import Capacitor
import UIKit

enum TrainingOrientationLock {
    static var mask: UIInterfaceOrientationMask = .allButUpsideDown
}

@objc(ScreenOrientationPlugin)
final class ScreenOrientationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ScreenOrientationPlugin"
    let jsName = "ScreenOrientation"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        let orientation = call.getString("orientation", "auto")
        let mask: UIInterfaceOrientationMask
        switch orientation {
        case "landscape":
            mask = .landscape
        case "portrait":
            mask = .portrait
        case "auto":
            mask = .allButUpsideDown
        default:
            call.reject("不支持的屏幕方向")
            return
        }

        DispatchQueue.main.async {
            TrainingOrientationLock.mask = mask
            guard let controller = self.bridge?.viewController else {
                call.reject("无法更新屏幕方向")
                return
            }

            if #available(iOS 16.0, *), let scene = controller.view.window?.windowScene {
                controller.setNeedsUpdateOfSupportedInterfaceOrientations()
                scene.requestGeometryUpdate(UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: mask)) { error in
                    call.reject("无法切换屏幕方向", nil, error)
                }
                call.resolve(["requiresPhysicalRotation": false])
            } else {
                // iPadOS 15 has no public API for forcing a new interface orientation. Refresh the
                // controller's mask, then let UIKit apply it when the device is actually turned.
                controller.setNeedsStatusBarAppearanceUpdate()
                controller.view.setNeedsLayout()
                controller.view.layoutIfNeeded()
                UIViewController.attemptRotationToDeviceOrientation()
                let interfaceOrientation = controller.view.window?.windowScene?.interfaceOrientation
                let requiresPhysicalRotation: Bool
                switch orientation {
                case "landscape":
                    requiresPhysicalRotation = !(interfaceOrientation?.isLandscape ?? false)
                case "portrait":
                    requiresPhysicalRotation = !(interfaceOrientation?.isPortrait ?? false)
                default:
                    requiresPhysicalRotation = false
                }
                call.resolve(["requiresPhysicalRotation": requiresPhysicalRotation])
            }
        }
    }
}

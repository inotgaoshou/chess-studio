import AVFoundation
import Capacitor
import UIKit

@objc(CommentarySpeechPlugin)
final class CommentarySpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    let identifier = "CommentarySpeechPlugin"
    let jsName = "CommentarySpeech"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let synthesizer = AVSpeechSynthesizer()
    private var active: (AVSpeechUtterance, CAPPluginCall)?
    private var backgroundObserver: NSObjectProtocol?

    override func load() {
        synthesizer.delegate = self
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.stopOnMain() }
    }

    private func stopOnMain() {
        let previous = active
        active = nil
        synthesizer.stopSpeaking(at: .immediate)
        previous?.1.resolve(["stopped": true])
    }

    @objc func speak(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopOnMain()
            let text = call.getString("text", "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text.count <= 4000 else { call.reject("朗读文字为空或过长。"); return }
            // speechVoices lists available system voices. No download or remote
            // synthesis endpoint is requested by the app.
            guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language == "zh-CN" }) else {
                call.reject("请在系统辅助功能的朗读设置中安装普通话语音；文字讲解仍可查看。")
                return
            }
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = voice
            let rate = max(0.6, min(1.5, call.getDouble("rate", 1)))
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(rate)
            self.active = (utterance, call)
            self.synthesizer.speak(utterance)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.stopOnMain(); call.resolve() }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard let current = active, current.0 === utterance else { return }
        active = nil
        current.1.resolve()
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        guard let current = active, current.0 === utterance else { return }
        active = nil
        current.1.resolve(["stopped": true])
    }
    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    }
}

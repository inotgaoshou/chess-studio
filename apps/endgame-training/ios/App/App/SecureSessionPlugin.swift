import Capacitor
import Foundation
import Security

@objc(SecureSessionPlugin)
final class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SecureSessionPlugin"
    let jsName = "SecureSession"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private let service = "cn.xiangqi.endgame.training.secure-session"
    private let account = "current"

    @objc func load(_ call: CAPPluginCall) {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve([:]); return }
        guard status == errSecSuccess, let data = result as? Data, let session = String(data: data, encoding: .utf8) else { call.reject("无法读取安全登录会话"); return }
        call.resolve(["session": session])
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let session = call.getString("session"), !session.isEmpty else { call.reject("登录会话无效"); return }
        let data = Data(session.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var create = query
            create.merge(attributes) { _, new in new }
            let inserted = SecItemAdd(create as CFDictionary, nil)
            guard inserted == errSecSuccess else { call.reject("无法保存安全登录会话"); return }
        } else if status != errSecSuccess { call.reject("无法保存安全登录会话"); return }
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("无法清除安全登录会话"); return }
        call.resolve()
    }
}

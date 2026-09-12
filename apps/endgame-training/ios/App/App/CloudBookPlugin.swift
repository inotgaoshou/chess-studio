import Capacitor
import Foundation

private enum CloudBookError: LocalizedError {
    case http(Int, String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .http(let status, let detail): return detail.isEmpty ? "HTTP \(status)" : detail
        case .invalidResponse: return "服务返回内容无效"
        }
    }
}

@objc(CloudBookPlugin)
final class CloudBookPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "CloudBookPlugin"
    let jsName = "CloudBook"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise)]

    private let chessDbEndpoint = URL(string: "https://www.chessdb.cn/chessdb.php")!
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 7
        configuration.timeoutIntervalForResource = 9
        return URLSession(configuration: configuration)
    }()

    @objc func query(_ call: CAPPluginCall) {
        guard let fen = call.getString("fen")?.trimmingCharacters(in: .whitespacesAndNewlines), !fen.isEmpty else {
            call.reject("缺少当前局面")
            return
        }
        var components = URLComponents(url: chessDbEndpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "action", value: "queryall"),
            URLQueryItem(name: "board", value: fen)
        ]
        guard let url = components.url else {
            call.reject("云库请求失败")
            return
        }
        var request = URLRequest(url: url)
        request.setValue("text/plain", forHTTPHeaderField: "Accept")
        perform(request) { result in
            switch result {
            case .success(let data):
                call.resolve(["payload": String(decoding: data, as: UTF8.self)])
            case .failure(let error):
                call.reject("云库请求失败", nil, error)
            }
        }
    }

    private func perform(_ request: URLRequest, completion: @escaping (Result<Data, Error>) -> Void) {
        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(CloudBookError.invalidResponse))
                return
            }
            let payload = data ?? Data()
            guard (200..<300).contains(http.statusCode) else {
                let detail = (try? Self.jsonObject(payload)["error"] as? String) ?? ""
                completion(.failure(CloudBookError.http(http.statusCode, detail)))
                return
            }
            completion(.success(payload))
        }.resume()
    }

    private static func jsonObject(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CloudBookError.invalidResponse
        }
        return value
    }
}

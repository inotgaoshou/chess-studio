import Capacitor
import Foundation

@objc(PikafishPlugin)
final class PikafishPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PikafishPlugin"
    let jsName = "Pikafish"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "bestMove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "analyze", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let stateQueue = DispatchQueue(label: "cn.xiangqi.endgame.training.pikafish.plugin")
    private var engine: PFPikafishEngine?
    private var activeCall: CAPPluginCall?
    private var requestGeneration: UInt64 = 0

    @objc func bestMove(_ call: CAPPluginCall) {
        submit(call, bestMoveOnly: true)
    }

    @objc func analyze(_ call: CAPPluginCall) {
        submit(call, bestMoveOnly: false)
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let previous = stateQueue.sync { () -> CAPPluginCall? in
            requestGeneration &+= 1
            defer { activeCall = nil }
            return activeCall
        }
        engine?.cancel()
        previous?.reject("本地引擎请求已取消")
        call.resolve()
    }

    deinit {
        let previous = stateQueue.sync { () -> CAPPluginCall? in
            requestGeneration &+= 1
            defer { activeCall = nil }
            return activeCall
        }
        engine?.releaseResources()
        previous?.reject("本地引擎请求已取消")
    }

    private func submit(_ call: CAPPluginCall, bestMoveOnly: Bool) {
        guard let fen = call.getString("fen")?.trimmingCharacters(in: .whitespacesAndNewlines), !fen.isEmpty else {
            call.reject("缺少当前局面")
            return
        }

        guard let engine = loadEngine(for: call) else { return }
        let moveTimeMs = max(100, min(5_000, call.getInt("moveTimeMs") ?? 800))
        let multiPv = bestMoveOnly ? 1 : max(1, min(4, call.getInt("multiPv") ?? 4))
        let (request, previous) = stateQueue.sync { () -> (UInt64, CAPPluginCall?) in
            requestGeneration &+= 1
            let prior = activeCall
            activeCall = call
            return (requestGeneration, prior)
        }
        engine.cancel()
        previous?.reject("本地引擎请求已取消")

        engine.analyzeFen(
            fen,
            moveTimeMs: moveTimeMs,
            threads: 2,
            hashMB: 128,
            multiPV: multiPv,
            update: { _ in },
            completion: { [weak self, weak call] result, error in
                guard let self, let call, self.finish(request: request, call: call) else { return }
                if let error {
                    call.reject("本地 Pikafish 启动或计算失败：\(error.localizedDescription)", nil, error)
                    return
                }
                guard let result else {
                    call.reject("本地 Pikafish 未返回分析结果")
                    return
                }
                if bestMoveOnly {
                    guard !result.bestMove.isEmpty else {
                        call.reject("本地 Pikafish 未返回合法着法")
                        return
                    }
                    call.resolve(["iccs": result.bestMove])
                } else {
                    call.resolve(self.analysisPayload(result))
                }
            }
        )
    }

    private func loadEngine(for call: CAPPluginCall) -> PFPikafishEngine? {
        if let engine { return engine }
        guard let networkPath = Bundle.main.path(forResource: "pikafish", ofType: "nnue") else {
            call.reject("安装包缺少 Pikafish NNUE 文件")
            return nil
        }
        let engine = PFPikafishEngine(networkPath: networkPath)
        self.engine = engine
        return engine
    }

    private func finish(request: UInt64, call: CAPPluginCall) -> Bool {
        stateQueue.sync {
            guard requestGeneration == request, activeCall === call else { return false }
            activeCall = nil
            return true
        }
    }

    private func analysisPayload(_ result: PFAnalysisResult) -> [String: Any] {
        let lines = result.lines.map { line -> [String: Any] in
            var payload: [String: Any] = [
                "multipv": line.multipv,
                "depth": line.depth,
                "nodes": line.nodes,
                "nps": line.nps,
                "pv": line.pv
            ]
            if line.scoreKind == .mate { payload["mate"] = line.scoreValue }
            else { payload["scoreCp"] = line.scoreValue }
            return payload
        }
        return ["bestMove": result.bestMove, "lines": lines]
    }
}

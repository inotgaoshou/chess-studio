import Capacitor
import Foundation
import SQLite3

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

@objc(TrainingStorePlugin)
final class TrainingStorePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "TrainingStorePlugin"
    let jsName = "TrainingStore"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "replaceLibrary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "libraries", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "problems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attempts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveAttempt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteLibrary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideProblem", returnType: CAPPluginReturnPromise)
    ]

    private let store = TrainingDatabase()

    @objc func replaceLibrary(_ call: CAPPluginCall) {
        respond(call, failure: "无法保存残局题库") {
            try self.store.replaceLibrary(
                library: try Self.object(from: call, key: "library"),
                problems: try Self.array(from: call, key: "problems")
            )
            return [:]
        }
    }

    @objc func libraries(_ call: CAPPluginCall) {
        respond(call, failure: "无法读取残局题库") { ["items": try self.store.libraries()] }
    }

    @objc func problems(_ call: CAPPluginCall) {
        respond(call, failure: "无法读取残局题目") {
            ["items": try self.store.problems(libraryId: try Self.requiredString(call, key: "libraryId"))]
        }
    }

    @objc func attempts(_ call: CAPPluginCall) {
        respond(call, failure: "无法读取答题记录") {
            ["items": try self.store.attempts(problemId: try Self.requiredString(call, key: "problemId"))]
        }
    }

    @objc func saveAttempt(_ call: CAPPluginCall) {
        respond(call, failure: "无法保存答题记录") {
            try self.store.saveAttempt(try Self.object(from: call, key: "attempt"))
            return [:]
        }
    }

    @objc func deleteLibrary(_ call: CAPPluginCall) {
        respond(call, failure: "无法删除残局题库") {
            try self.store.deleteLibrary(try Self.requiredString(call, key: "libraryId"))
            return [:]
        }
    }

    @objc func hideProblem(_ call: CAPPluginCall) {
        respond(call, failure: "无法删除残局题目") {
            try self.store.hideProblem(try Self.requiredString(call, key: "problemId"))
            return [:]
        }
    }

    private func respond(_ call: CAPPluginCall, failure: String, _ action: @escaping () throws -> PluginCallResultData) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let result = try action()
                DispatchQueue.main.async { call.resolve(result) }
            } catch {
                DispatchQueue.main.async { call.reject(failure, nil, error) }
            }
        }
    }

    private static func requiredString(_ call: CAPPluginCall, key: String) throws -> String {
        guard let value = call.getString(key), !value.isEmpty else { throw TrainingStoreError.invalidInput(key) }
        return value
    }

    private static func object(from call: CAPPluginCall, key: String) throws -> [String: Any] {
        let string = try requiredString(call, key: key)
        guard let value = try JSONSerialization.jsonObject(with: Data(string.utf8)) as? [String: Any] else {
            throw TrainingStoreError.invalidInput(key)
        }
        return value
    }

    private static func array(from call: CAPPluginCall, key: String) throws -> [[String: Any]] {
        let string = try requiredString(call, key: key)
        guard let value = try JSONSerialization.jsonObject(with: Data(string.utf8)) as? [[String: Any]] else {
            throw TrainingStoreError.invalidInput(key)
        }
        return value
    }
}

private enum TrainingStoreError: LocalizedError {
    case invalidInput(String)
    case sqlite(String)

    var errorDescription: String? {
        switch self {
        case .invalidInput(let key): return "参数无效: \(key)"
        case .sqlite(let message): return message
        }
    }
}

private final class TrainingDatabase {
    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "cn.xiangqi.endgame.training.store")

    init() {
        queue.sync {
            do { try open() } catch { assertionFailure("Unable to initialize endgame training storage: \(error)") }
        }
    }

    deinit { if let db { sqlite3_close(db) } }

    func replaceLibrary(library: [String: Any], problems: [[String: Any]]) throws {
        try queue.sync {
            try transaction {
                let libraryId = try value(library, "id")
                try execute("INSERT INTO libraries (id,title,fingerprint,parser_version,imported_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,fingerprint=excluded.fingerprint,parser_version=excluded.parser_version,imported_at=excluded.imported_at", [libraryId, try value(library, "title"), try value(library, "fingerprint"), try number(library, "parserVersion"), try value(library, "importedAt")])
                try execute("UPDATE problems SET active=0 WHERE library_id=?", [libraryId])
                for problem in problems { try saveProblem(problem) }
            }
        }
    }

    func libraries() throws -> String {
        try queue.sync {
            let rows = try query("SELECT l.id,l.title,l.fingerprint,l.parser_version,l.imported_at,COUNT(DISTINCT p.id),COUNT(DISTINCT CASE WHEN a.outcome='completed' THEN p.id END) FROM libraries l LEFT JOIN problems p ON p.library_id=l.id AND p.active=1 LEFT JOIN attempts a ON a.problem_id=p.id GROUP BY l.id ORDER BY l.imported_at DESC") { statement in
                ["id": text(statement, 0), "title": text(statement, 1), "fingerprint": text(statement, 2), "parserVersion": integer(statement, 3), "importedAt": text(statement, 4), "problemCount": integer(statement, 5), "completedCount": integer(statement, 6)]
            }
            return try json(rows)
        }
    }

    func problems(libraryId: String) throws -> String {
        try queue.sync {
            let rows = try query("SELECT p.id,p.library_id,p.source_index,p.title,p.category,p.starting_fen,p.note,p.solution_json,p.logic_json,COUNT(a.id),COALESCE(SUM(a.elapsed_ms),0) FROM problems p LEFT JOIN attempts a ON a.problem_id=p.id WHERE p.library_id=? AND p.active=1 GROUP BY p.id ORDER BY p.source_index", [libraryId]) { statement in
                var row: [String: Any] = ["id": text(statement, 0), "libraryId": text(statement, 1), "sourceIndex": integer(statement, 2), "title": text(statement, 3), "category": text(statement, 4), "startingFen": text(statement, 5), "note": text(statement, 6), "solution": try jsonValue(text(statement, 7)), "completedAttempts": integer(statement, 9), "totalElapsedMs": integer(statement, 10)]
                let logic = text(statement, 8)
                if !logic.isEmpty { row["logic"] = try jsonValue(logic) }
                return row
            }
            return try json(rows)
        }
    }

    func attempts(problemId: String) throws -> String {
        try queue.sync {
            let rows = try query("SELECT id,problem_id,mode,elapsed_ms,hints_used,mistakes,outcome,created_at FROM attempts WHERE problem_id=? ORDER BY created_at DESC LIMIT 30", [problemId]) { statement in
                ["id": text(statement, 0), "problemId": text(statement, 1), "mode": text(statement, 2), "elapsedMs": integer(statement, 3), "hintsUsed": integer(statement, 4), "mistakes": integer(statement, 5), "outcome": text(statement, 6), "createdAt": text(statement, 7)]
            }
            return try json(rows)
        }
    }

    func saveAttempt(_ attempt: [String: Any]) throws {
        try queue.sync {
            try execute("INSERT INTO attempts (id,problem_id,mode,elapsed_ms,hints_used,mistakes,outcome,created_at) VALUES (?,?,?,?,?,?,?,?)", [try value(attempt, "id"), try value(attempt, "problemId"), try value(attempt, "mode"), try number(attempt, "elapsedMs"), try number(attempt, "hintsUsed"), try number(attempt, "mistakes"), try value(attempt, "outcome"), try value(attempt, "createdAt")])
        }
    }

    func deleteLibrary(_ libraryId: String) throws {
        try queue.sync {
            try transaction {
                try execute("DELETE FROM attempts WHERE problem_id IN (SELECT id FROM problems WHERE library_id=?)", [libraryId])
                try execute("DELETE FROM problems WHERE library_id=?", [libraryId])
                try execute("DELETE FROM libraries WHERE id=?", [libraryId])
            }
        }
    }

    func hideProblem(_ problemId: String) throws {
        try queue.sync { try execute("UPDATE problems SET active=0 WHERE id=?", [problemId]) }
    }

    private func open() throws {
        let manager = FileManager.default
        let directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent("endgame-training.sqlite").path
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw databaseError() }
        try execute("PRAGMA foreign_keys=ON")
        try execute("CREATE TABLE IF NOT EXISTS libraries (id TEXT PRIMARY KEY, title TEXT NOT NULL, fingerprint TEXT NOT NULL, parser_version INTEGER NOT NULL, imported_at TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS problems (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, source_index INTEGER NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, starting_fen TEXT NOT NULL, note TEXT NOT NULL, solution_json TEXT NOT NULL, logic_json TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1)")
        do { try execute("ALTER TABLE problems ADD COLUMN logic_json TEXT NOT NULL DEFAULT ''") } catch { }
        try execute("CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL, mode TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, hints_used INTEGER NOT NULL, mistakes INTEGER NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL)")
        try execute("CREATE INDEX IF NOT EXISTS attempts_problem_idx ON attempts(problem_id, created_at DESC)")
    }

    private func saveProblem(_ problem: [String: Any]) throws {
        guard let solution = problem["solution"] else { throw TrainingStoreError.invalidInput("solution") }
        let solutionData = try JSONSerialization.data(withJSONObject: solution)
        let solutionJson = String(decoding: solutionData, as: UTF8.self)
        let logicJson: String
        if let logic = problem["logic"] {
            let logicData = try JSONSerialization.data(withJSONObject: logic)
            logicJson = String(decoding: logicData, as: UTF8.self)
        } else {
            logicJson = ""
        }
        try execute("INSERT INTO problems (id,library_id,source_index,title,category,starting_fen,note,solution_json,logic_json,active) VALUES (?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET library_id=excluded.library_id,source_index=excluded.source_index,title=excluded.title,category=excluded.category,starting_fen=excluded.starting_fen,note=excluded.note,solution_json=excluded.solution_json,logic_json=excluded.logic_json,active=1", [try value(problem, "id"), try value(problem, "libraryId"), try number(problem, "sourceIndex"), try value(problem, "title"), try value(problem, "category"), try value(problem, "startingFen"), (problem["note"] as? String) ?? "", solutionJson, logicJson])
    }

    private func transaction(_ operation: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do { try operation(); try execute("COMMIT") }
        catch { try? execute("ROLLBACK"); throw error }
    }

    private func execute(_ sql: String, _ values: [Any] = []) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw databaseError() }
        defer { sqlite3_finalize(statement) }
        try bind(values, to: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw databaseError() }
    }

    private func query(_ sql: String, _ values: [Any] = [], row: (OpaquePointer?) throws -> [String: Any]) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw databaseError() }
        defer { sqlite3_finalize(statement) }
        try bind(values, to: statement)
        var rows = [[String: Any]]()
        while sqlite3_step(statement) == SQLITE_ROW { rows.append(try row(statement)) }
        if sqlite3_errcode(db) != SQLITE_OK && sqlite3_errcode(db) != SQLITE_DONE { throw databaseError() }
        return rows
    }

    private func bind(_ values: [Any], to statement: OpaquePointer?) throws {
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let code: Int32
            if let string = value as? String { code = sqlite3_bind_text(statement, index, string, -1, sqliteTransient) }
            else if let number = value as? NSNumber { code = sqlite3_bind_int64(statement, index, number.int64Value) }
            else { throw TrainingStoreError.invalidInput("SQLite bind") }
            guard code == SQLITE_OK else { throw databaseError() }
        }
    }

    private func databaseError() -> TrainingStoreError {
        let message = db.flatMap { sqlite3_errmsg($0) }.map { String(cString: $0) } ?? "SQLite 操作失败"
        return .sqlite(message)
    }

    private func value(_ object: [String: Any], _ key: String) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty else { throw TrainingStoreError.invalidInput(key) }
        return value
    }

    private func number(_ object: [String: Any], _ key: String) throws -> NSNumber {
        guard let value = object[key] as? NSNumber else { throw TrainingStoreError.invalidInput(key) }
        return value
    }

    private func text(_ statement: OpaquePointer?, _ column: Int32) -> String {
        guard let value = sqlite3_column_text(statement, column) else { return "" }
        return String(cString: value)
    }

    private func integer(_ statement: OpaquePointer?, _ column: Int32) -> Int64 { sqlite3_column_int64(statement, column) }

    private func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
    }

    private func jsonValue(_ string: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(string.utf8))
    }
}

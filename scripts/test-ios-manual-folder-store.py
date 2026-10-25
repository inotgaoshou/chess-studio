#!/usr/bin/env python3
"""Run the production Swift SQLite store against an isolated temporary database."""
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
plugin = (root / "apps/endgame-training/ios/App/App/TrainingStorePlugin.swift").read_text()
source = "import Foundation\nimport SQLite3\nprivate let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)\n"
source += plugin[plugin.index("private enum TrainingStoreError:"):]
directory = "let directory = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)"
assert source.count(directory) == 1
source = source.replace(directory, 'let directory = URL(fileURLWithPath: CommandLine.arguments[1])')
source += r'''
func object(_ text: String) throws -> [String: Any] { try JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any] }
func check(_ game: [String: Any], folder: String?) {
    precondition(game["folderPath"] as? String == folder, "wrong folder")
    precondition(game["updatedAt"] as? String != "2000-01-01T00:00:00Z", "move timestamp must reach the sync payload")
    precondition(game["moves"] as? [String] == ["a3a4"], "moves lost")
    precondition((game["comments"] as? [String: String])?["main:1"] == "保留注释", "comments lost")
    precondition((game["branches"] as? [[String: Any]])?.count == 1, "branches lost")
}
private let db = TrainingDatabase()
try db.saveManualGame(["id":"fixture", "title":"移动验证", "folderPath":"比赛", "startingFen":"fen", "moves":["a3a4"], "comments":["main:1":"保留注释"], "branches":[["id":"branch"]], "updatedAt":"2000-01-01T00:00:00Z"])
try db.moveManualGame(id:"fixture", folder:"比赛/决赛/精选")
check(try object(db.openManualGame("fixture")), folder:"比赛/决赛/精选")
let old = try JSONSerialization.jsonObject(with: Data(db.manualGames(folder:"比赛", queryText:"").utf8)) as! [[String: Any]]
precondition(old.isEmpty, "source directory retained the moved game")
try db.renameManualFolder(previous:"比赛/决赛", next:"训练")
check(try object(db.openManualGame("fixture")), folder:"训练/精选")
try db.moveManualGame(id:"fixture", folder:"")
check(try object(db.openManualGame("fixture")), folder:nil)
let all = try JSONSerialization.jsonObject(with: Data(db.manualGames(folder:"", queryText:"").utf8)) as! [[String: Any]]
precondition(all.count == 1)
check(all[0], folder:nil)
print("PASS production Swift SQLite store: nested move, source removal, folder rename, unclassified, sync timestamp, content preservation")
'''
with tempfile.TemporaryDirectory(prefix="qixi-folder-store-") as tmp:
    path = pathlib.Path(tmp) / "main.swift"
    path.write_text(source)
    executable = pathlib.Path(tmp) / "test-store"
    subprocess.run(["xcrun", "swiftc", str(path), "-o", str(executable)], check=True)
    subprocess.run([str(executable), tmp], check=True)

package cn.xiangqi.endgame.training;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "TrainingStore")
public class TrainingStorePlugin extends Plugin {
    private TrainingDatabase database;

    @Override
    public void load() {
        database = new TrainingDatabase();
    }

    @PluginMethod
    public void replaceLibrary(PluginCall call) {
        try {
            JSONObject library = new JSONObject(call.getString("library"));
            JSONArray problems = new JSONArray(call.getString("problems"));
            database.replaceLibrary(library, problems);
            call.resolve();
        } catch (Exception error) { call.reject("无法保存残局题库", error); }
    }

    @PluginMethod
    public void libraries(PluginCall call) { resolveJson(call, database.libraries()); }

    @PluginMethod
    public void problems(PluginCall call) { resolveJson(call, database.problems(call.getString("libraryId"))); }

    @PluginMethod
    public void attempts(PluginCall call) { resolveJson(call, database.attempts(call.getString("problemId"))); }

    @PluginMethod
    public void saveAttempt(PluginCall call) {
        try { database.saveAttempt(new JSONObject(call.getString("attempt"))); call.resolve(); }
        catch (Exception error) { call.reject("无法保存答题记录", error); }
    }

    @PluginMethod
    public void deleteLibrary(PluginCall call) { database.deleteLibrary(call.getString("libraryId")); call.resolve(); }

    @PluginMethod
    public void hideProblem(PluginCall call) { database.hideProblem(call.getString("problemId")); call.resolve(); }

    @PluginMethod
    public void manualFolders(PluginCall call) { resolveJson(call, database.manualFolders()); }

    @PluginMethod
    public void createManualFolder(PluginCall call) {
        try { database.createManualFolder(normalizePath(call.getString("path"))); call.resolve(); }
        catch (Exception error) { call.reject("无法创建录谱目录", error); }
    }

    @PluginMethod
    public void renameManualFolder(PluginCall call) {
        try { database.renameManualFolder(normalizePath(call.getString("previous")), normalizePath(call.getString("next"))); call.resolve(); }
        catch (Exception error) { call.reject("无法重命名录谱目录", error); }
    }

    @PluginMethod
    public void deleteManualFolder(PluginCall call) {
        try { database.deleteManualFolder(normalizePath(call.getString("path"))); call.resolve(); }
        catch (Exception error) { call.reject("无法删除录谱目录", error); }
    }

    @PluginMethod
    public void manualGames(PluginCall call) { resolveJson(call, database.manualGames(normalizePath(call.getString("folder")), call.getString("query", ""))); }

    @PluginMethod
    public void saveManualGame(PluginCall call) {
        try { database.saveManualGame(new JSONObject(call.getString("game"))); call.resolve(); }
        catch (Exception error) { call.reject("无法保存本地棋谱", error); }
    }

    @PluginMethod
    public void openManualGame(PluginCall call) {
        JSObject result = new JSObject();
        result.put("item", database.openManualGame(call.getString("id")));
        call.resolve(result);
    }

    @PluginMethod
    public void deleteManualGame(PluginCall call) {
        try { database.deleteManualGame(call.getString("id")); call.resolve(); }
        catch (Exception error) { call.reject("无法删除本地棋谱", error); }
    }

    @PluginMethod
    public void moveManualGame(PluginCall call) {
        try { database.moveManualGame(call.getString("id"), normalizePath(call.getString("folder"))); call.resolve(); }
        catch (Exception error) { call.reject("无法移动本地棋谱", error); }
    }

    @PluginMethod
    public void saveManualAnalysis(PluginCall call) {
        try { database.saveManualAnalysis(new JSONObject(call.getString("summary"))); call.resolve(); }
        catch (Exception error) { call.reject("无法保存录谱分析", error); }
    }

    private void resolveJson(PluginCall call, JSONArray rows) {
        JSObject result = new JSObject();
        result.put("items", rows.toString());
        call.resolve(result);
    }

    private String normalizePath(String raw) {
        if (raw == null) return "";
        String[] parts = raw.split("/");
        StringBuilder builder = new StringBuilder();
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) continue;
            if (builder.length() > 0) builder.append("/");
            builder.append(trimmed);
        }
        return builder.toString();
    }

    private final class TrainingDatabase extends SQLiteOpenHelper {
        TrainingDatabase() { super(getContext(), "endgame-training.sqlite", null, 3); }

        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE libraries (id TEXT PRIMARY KEY, title TEXT NOT NULL, fingerprint TEXT NOT NULL, parser_version INTEGER NOT NULL, imported_at TEXT NOT NULL)");
            db.execSQL("CREATE TABLE problems (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, source_index INTEGER NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, starting_fen TEXT NOT NULL, note TEXT NOT NULL, solution_json TEXT NOT NULL, logic_json TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1)");
            db.execSQL("CREATE TABLE attempts (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL, mode TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, hints_used INTEGER NOT NULL, mistakes INTEGER NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL)");
            db.execSQL("CREATE INDEX attempts_problem_idx ON attempts(problem_id, created_at DESC)");
            createManualTables(db);
        }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            if (oldVersion < 2) db.execSQL("ALTER TABLE problems ADD COLUMN logic_json TEXT NOT NULL DEFAULT ''");
            if (oldVersion < 3) createManualTables(db);
        }

        private void createManualTables(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE IF NOT EXISTS manual_folders (path TEXT PRIMARY KEY, created_at TEXT NOT NULL)");
            db.execSQL("CREATE TABLE IF NOT EXISTS manual_games (id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL, folder_path TEXT NOT NULL DEFAULT '', starting_fen TEXT NOT NULL, current_node_id TEXT NOT NULL DEFAULT '', tree_json TEXT NOT NULL, game_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
            db.execSQL("CREATE INDEX IF NOT EXISTS manual_games_folder_idx ON manual_games(folder_path, updated_at DESC)");
            db.execSQL("CREATE TABLE IF NOT EXISTS manual_analysis (game_id TEXT NOT NULL, node_id TEXT NOT NULL, fen TEXT NOT NULL, score_cp INTEGER, mate INTEGER, depth INTEGER NOT NULL DEFAULT 0, best_move TEXT NOT NULL DEFAULT '', pv_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(game_id,node_id))");
        }

        void replaceLibrary(JSONObject library, JSONArray problems) throws Exception {
            SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
            try {
                ContentValues values = new ContentValues(); values.put("id", library.getString("id")); values.put("title", library.getString("title")); values.put("fingerprint", library.getString("fingerprint")); values.put("parser_version", library.getInt("parserVersion")); values.put("imported_at", library.getString("importedAt"));
                db.insertWithOnConflict("libraries", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                db.execSQL("UPDATE problems SET active = 0 WHERE library_id = ?", new Object[] { library.getString("id") });
                for (int index = 0; index < problems.length(); index++) saveProblem(db, problems.getJSONObject(index));
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }

        private void saveProblem(SQLiteDatabase db, JSONObject problem) throws Exception {
            ContentValues values = new ContentValues(); values.put("id", problem.getString("id")); values.put("library_id", problem.getString("libraryId")); values.put("source_index", problem.getInt("sourceIndex")); values.put("title", problem.getString("title")); values.put("category", problem.getString("category")); values.put("starting_fen", problem.getString("startingFen")); values.put("note", problem.optString("note")); values.put("solution_json", problem.getJSONArray("solution").toString()); values.put("logic_json", problem.has("logic") && !problem.isNull("logic") ? problem.getJSONObject("logic").toString() : ""); values.put("active", 1);
            db.insertWithOnConflict("problems", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        }

        JSONArray libraries() {
            JSONArray result = new JSONArray(); Cursor cursor = getReadableDatabase().rawQuery("SELECT l.id,l.title,l.fingerprint,l.parser_version,l.imported_at,COUNT(DISTINCT p.id),COUNT(DISTINCT CASE WHEN a.outcome='completed' THEN p.id END) FROM libraries l LEFT JOIN problems p ON p.library_id=l.id AND p.active=1 LEFT JOIN attempts a ON a.problem_id=p.id GROUP BY l.id ORDER BY l.imported_at DESC", null);
            while (cursor.moveToNext()) { JSONObject row = new JSONObject(); try { row.put("id", cursor.getString(0)); row.put("title", cursor.getString(1)); row.put("fingerprint", cursor.getString(2)); row.put("parserVersion", cursor.getInt(3)); row.put("importedAt", cursor.getString(4)); row.put("problemCount", cursor.getInt(5)); row.put("completedCount", cursor.getInt(6)); result.put(row); } catch (Exception ignored) {} } cursor.close(); return result;
        }

        JSONArray problems(String libraryId) {
            JSONArray result = new JSONArray(); Cursor cursor = getReadableDatabase().rawQuery("SELECT p.id,p.library_id,p.source_index,p.title,p.category,p.starting_fen,p.note,p.solution_json,p.logic_json,COUNT(a.id),COALESCE(SUM(a.elapsed_ms),0) FROM problems p LEFT JOIN attempts a ON a.problem_id=p.id WHERE p.library_id=? AND p.active=1 GROUP BY p.id ORDER BY p.source_index", new String[] { libraryId });
            while (cursor.moveToNext()) { JSONObject row = new JSONObject(); try { row.put("id", cursor.getString(0)); row.put("libraryId", cursor.getString(1)); row.put("sourceIndex", cursor.getInt(2)); row.put("title", cursor.getString(3)); row.put("category", cursor.getString(4)); row.put("startingFen", cursor.getString(5)); row.put("note", cursor.getString(6)); row.put("solution", new JSONArray(cursor.getString(7))); String logic = cursor.getString(8); if (logic != null && !logic.isEmpty()) row.put("logic", new JSONObject(logic)); row.put("completedAttempts", cursor.getInt(9)); row.put("totalElapsedMs", cursor.getLong(10)); result.put(row); } catch (Exception ignored) {} } cursor.close(); return result;
        }

        JSONArray attempts(String problemId) {
            JSONArray result = new JSONArray(); Cursor cursor = getReadableDatabase().query("attempts", null, "problem_id=?", new String[] { problemId }, null, null, "created_at DESC", "30");
            while (cursor.moveToNext()) { JSONObject row = new JSONObject(); try { row.put("id", cursor.getString(cursor.getColumnIndexOrThrow("id"))); row.put("problemId", cursor.getString(cursor.getColumnIndexOrThrow("problem_id"))); row.put("mode", cursor.getString(cursor.getColumnIndexOrThrow("mode"))); row.put("elapsedMs", cursor.getLong(cursor.getColumnIndexOrThrow("elapsed_ms"))); row.put("hintsUsed", cursor.getInt(cursor.getColumnIndexOrThrow("hints_used"))); row.put("mistakes", cursor.getInt(cursor.getColumnIndexOrThrow("mistakes"))); row.put("outcome", cursor.getString(cursor.getColumnIndexOrThrow("outcome"))); row.put("createdAt", cursor.getString(cursor.getColumnIndexOrThrow("created_at"))); result.put(row); } catch (Exception ignored) {} } cursor.close(); return result;
        }

        void saveAttempt(JSONObject attempt) throws Exception { ContentValues values = new ContentValues(); values.put("id", attempt.getString("id")); values.put("problem_id", attempt.getString("problemId")); values.put("mode", attempt.getString("mode")); values.put("elapsed_ms", attempt.getLong("elapsedMs")); values.put("hints_used", attempt.getInt("hintsUsed")); values.put("mistakes", attempt.getInt("mistakes")); values.put("outcome", attempt.getString("outcome")); values.put("created_at", attempt.getString("createdAt")); getWritableDatabase().insertOrThrow("attempts", null, values); }
        void deleteLibrary(String id) { SQLiteDatabase db = getWritableDatabase(); db.beginTransaction(); try { db.delete("attempts", "problem_id IN (SELECT id FROM problems WHERE library_id=?)", new String[] { id }); db.delete("problems", "library_id=?", new String[] { id }); db.delete("libraries", "id=?", new String[] { id }); db.setTransactionSuccessful(); } finally { db.endTransaction(); } }
        void hideProblem(String id) { ContentValues values = new ContentValues(); values.put("active", 0); getWritableDatabase().update("problems", values, "id=?", new String[] { id }); }

        JSONArray manualFolders() {
            JSONArray result = new JSONArray();
            Cursor cursor = getReadableDatabase().query("manual_folders", null, null, null, null, null, "path COLLATE NOCASE");
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                try { row.put("path", cursor.getString(cursor.getColumnIndexOrThrow("path"))); row.put("createdAt", cursor.getString(cursor.getColumnIndexOrThrow("created_at"))); result.put(row); } catch (Exception ignored) {}
            }
            cursor.close();
            return result;
        }

        void createManualFolder(String path) throws Exception {
            if (path == null || path.isEmpty()) throw new IllegalArgumentException("path");
            createFolderPath(getWritableDatabase(), path);
        }

        void renameManualFolder(String previous, String next) throws Exception {
            if (previous.isEmpty() || next.isEmpty()) throw new IllegalArgumentException("path");
            SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
            try {
                createFolderPath(db, next);
                Cursor cursor = db.rawQuery("SELECT path,created_at FROM manual_folders WHERE path=? OR path LIKE ? ORDER BY LENGTH(path)", new String[] { previous, previous + "/%" });
                while (cursor.moveToNext()) {
                    ContentValues values = new ContentValues();
                    String oldPath = cursor.getString(0);
                    values.put("path", next + oldPath.substring(previous.length()));
                    values.put("created_at", cursor.getString(1));
                    db.insertWithOnConflict("manual_folders", null, values, SQLiteDatabase.CONFLICT_IGNORE);
                }
                cursor.close();
                db.execSQL("UPDATE manual_games SET folder_path=? || SUBSTR(folder_path, ?), updated_at=? WHERE folder_path=? OR folder_path LIKE ?", new Object[] { next, previous.length() + 1, nowIso(), previous, previous + "/%" });
                db.delete("manual_folders", "path=? OR path LIKE ?", new String[] { previous, previous + "/%" });
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }

        void deleteManualFolder(String path) throws Exception {
            if (path.isEmpty()) throw new IllegalArgumentException("path");
            String parent = path.contains("/") ? path.substring(0, path.lastIndexOf("/")) : "";
            SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
            try {
                if (!parent.isEmpty()) createFolderPath(db, parent);
                ContentValues values = new ContentValues();
                values.put("folder_path", parent);
                values.put("updated_at", nowIso());
                db.update("manual_games", values, "folder_path=? OR folder_path LIKE ?", new String[] { path, path + "/%" });
                db.delete("manual_folders", "path=? OR path LIKE ?", new String[] { path, path + "/%" });
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }

        JSONArray manualGames(String folder, String queryText) {
            JSONArray result = new JSONArray();
            StringBuilder where = new StringBuilder();
            java.util.ArrayList<String> args = new java.util.ArrayList<>();
            if (folder != null && !folder.isEmpty()) { where.append("folder_path=?"); args.add(folder); }
            if (queryText != null && !queryText.trim().isEmpty()) {
                if (where.length() > 0) where.append(" AND ");
                where.append("(title LIKE ? OR note LIKE ? OR folder_path LIKE ?)");
                String like = "%" + queryText + "%";
                args.add(like); args.add(like); args.add(like);
            }
            Cursor cursor = getReadableDatabase().query("manual_games", new String[] { "game_json" }, where.length() > 0 ? where.toString() : null, args.toArray(new String[0]), null, null, "updated_at DESC");
            while (cursor.moveToNext()) { try { result.put(new JSONObject(cursor.getString(0))); } catch (Exception ignored) {} }
            cursor.close();
            return result;
        }

        void saveManualGame(JSONObject game) throws Exception {
            String folder = game.optString("folderPath", "");
            SQLiteDatabase db = getWritableDatabase();
            if (!folder.isEmpty()) createFolderPath(db, folder);
            ContentValues values = new ContentValues();
            values.put("id", game.getString("id"));
            values.put("title", game.getString("title"));
            values.put("note", game.optString("note", ""));
            values.put("folder_path", folder);
            values.put("starting_fen", game.getString("startingFen"));
            values.put("current_node_id", game.optString("currentNodeId", ""));
            values.put("tree_json", game.toString());
            values.put("game_json", game.toString());
            values.put("created_at", game.optString("createdAt", nowIso()));
            values.put("updated_at", game.optString("updatedAt", nowIso()));
            db.insertWithOnConflict("manual_games", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        }

        String openManualGame(String id) {
            Cursor cursor = getReadableDatabase().query("manual_games", new String[] { "game_json" }, "id=?", new String[] { id }, null, null, null, "1");
            String result = "";
            if (cursor.moveToNext()) result = cursor.getString(0);
            cursor.close();
            return result;
        }

        void deleteManualGame(String id) {
            SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
            try { db.delete("manual_analysis", "game_id=?", new String[] { id }); db.delete("manual_games", "id=?", new String[] { id }); db.setTransactionSuccessful(); }
            finally { db.endTransaction(); }
        }

        void moveManualGame(String id, String folder) throws Exception {
            if (folder != null && !folder.isEmpty()) createFolderPath(getWritableDatabase(), folder);
            ContentValues values = new ContentValues();
            values.put("folder_path", folder == null ? "" : folder);
            values.put("updated_at", nowIso());
            getWritableDatabase().update("manual_games", values, "id=?", new String[] { id });
        }

        void saveManualAnalysis(JSONObject summary) throws Exception {
            ContentValues values = new ContentValues();
            values.put("game_id", summary.getString("gameId"));
            values.put("node_id", summary.getString("nodeId"));
            values.put("fen", summary.getString("fen"));
            if (summary.has("scoreCp") && !summary.isNull("scoreCp")) values.put("score_cp", summary.getInt("scoreCp"));
            if (summary.has("mate") && !summary.isNull("mate")) values.put("mate", summary.getInt("mate"));
            values.put("depth", summary.optInt("depth", 0));
            values.put("best_move", summary.optString("bestMove", ""));
            values.put("pv_json", summary.optJSONArray("pv") != null ? summary.optJSONArray("pv").toString() : "[]");
            values.put("updated_at", summary.optString("updatedAt", nowIso()));
            getWritableDatabase().insertWithOnConflict("manual_analysis", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        }

        private void createFolderPath(SQLiteDatabase db, String path) {
            String[] parts = path.split("/");
            StringBuilder prefix = new StringBuilder();
            for (String part : parts) {
                if (part.trim().isEmpty()) continue;
                if (prefix.length() > 0) prefix.append("/");
                prefix.append(part.trim());
                ContentValues values = new ContentValues();
                values.put("path", prefix.toString());
                values.put("created_at", nowIso());
                db.insertWithOnConflict("manual_folders", null, values, SQLiteDatabase.CONFLICT_IGNORE);
            }
        }

        private String nowIso() { return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", java.util.Locale.US).format(new java.util.Date()); }
    }
}

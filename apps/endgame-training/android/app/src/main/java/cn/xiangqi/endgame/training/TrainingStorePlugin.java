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

    private void resolveJson(PluginCall call, JSONArray rows) {
        JSObject result = new JSObject();
        result.put("items", rows.toString());
        call.resolve(result);
    }

    private final class TrainingDatabase extends SQLiteOpenHelper {
        TrainingDatabase() { super(getContext(), "endgame-training.sqlite", null, 1); }

        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE libraries (id TEXT PRIMARY KEY, title TEXT NOT NULL, fingerprint TEXT NOT NULL, parser_version INTEGER NOT NULL, imported_at TEXT NOT NULL)");
            db.execSQL("CREATE TABLE problems (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, source_index INTEGER NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, starting_fen TEXT NOT NULL, note TEXT NOT NULL, solution_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)");
            db.execSQL("CREATE TABLE attempts (id TEXT PRIMARY KEY, problem_id TEXT NOT NULL, mode TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, hints_used INTEGER NOT NULL, mistakes INTEGER NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL)");
            db.execSQL("CREATE INDEX attempts_problem_idx ON attempts(problem_id, created_at DESC)");
        }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

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
            ContentValues values = new ContentValues(); values.put("id", problem.getString("id")); values.put("library_id", problem.getString("libraryId")); values.put("source_index", problem.getInt("sourceIndex")); values.put("title", problem.getString("title")); values.put("category", problem.getString("category")); values.put("starting_fen", problem.getString("startingFen")); values.put("note", problem.optString("note")); values.put("solution_json", problem.getJSONArray("solution").toString()); values.put("active", 1);
            db.insertWithOnConflict("problems", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        }

        JSONArray libraries() {
            JSONArray result = new JSONArray(); Cursor cursor = getReadableDatabase().rawQuery("SELECT l.id,l.title,l.fingerprint,l.parser_version,l.imported_at,COUNT(DISTINCT p.id),COUNT(DISTINCT CASE WHEN a.outcome='completed' THEN p.id END) FROM libraries l LEFT JOIN problems p ON p.library_id=l.id AND p.active=1 LEFT JOIN attempts a ON a.problem_id=p.id GROUP BY l.id ORDER BY l.imported_at DESC", null);
            while (cursor.moveToNext()) { JSONObject row = new JSONObject(); try { row.put("id", cursor.getString(0)); row.put("title", cursor.getString(1)); row.put("fingerprint", cursor.getString(2)); row.put("parserVersion", cursor.getInt(3)); row.put("importedAt", cursor.getString(4)); row.put("problemCount", cursor.getInt(5)); row.put("completedCount", cursor.getInt(6)); result.put(row); } catch (Exception ignored) {} } cursor.close(); return result;
        }

        JSONArray problems(String libraryId) {
            JSONArray result = new JSONArray(); Cursor cursor = getReadableDatabase().rawQuery("SELECT p.id,p.library_id,p.source_index,p.title,p.category,p.starting_fen,p.note,p.solution_json,COUNT(a.id),COALESCE(SUM(a.elapsed_ms),0) FROM problems p LEFT JOIN attempts a ON a.problem_id=p.id WHERE p.library_id=? AND p.active=1 GROUP BY p.id ORDER BY p.source_index", new String[] { libraryId });
            while (cursor.moveToNext()) { JSONObject row = new JSONObject(); try { row.put("id", cursor.getString(0)); row.put("libraryId", cursor.getString(1)); row.put("sourceIndex", cursor.getInt(2)); row.put("title", cursor.getString(3)); row.put("category", cursor.getString(4)); row.put("startingFen", cursor.getString(5)); row.put("note", cursor.getString(6)); row.put("solution", new JSONArray(cursor.getString(7))); row.put("completedAttempts", cursor.getInt(8)); row.put("totalElapsedMs", cursor.getLong(9)); result.put(row); } catch (Exception ignored) {} } cursor.close(); return result;
        }

        JSONArray attempts(String problemId) {
            JSONArray result = new JSONArray(); Cursor cursor = getReadableDatabase().query("attempts", null, "problem_id=?", new String[] { problemId }, null, null, "created_at DESC", "30");
            while (cursor.moveToNext()) { JSONObject row = new JSONObject(); try { row.put("id", cursor.getString(cursor.getColumnIndexOrThrow("id"))); row.put("problemId", cursor.getString(cursor.getColumnIndexOrThrow("problem_id"))); row.put("mode", cursor.getString(cursor.getColumnIndexOrThrow("mode"))); row.put("elapsedMs", cursor.getLong(cursor.getColumnIndexOrThrow("elapsed_ms"))); row.put("hintsUsed", cursor.getInt(cursor.getColumnIndexOrThrow("hints_used"))); row.put("mistakes", cursor.getInt(cursor.getColumnIndexOrThrow("mistakes"))); row.put("outcome", cursor.getString(cursor.getColumnIndexOrThrow("outcome"))); row.put("createdAt", cursor.getString(cursor.getColumnIndexOrThrow("created_at"))); result.put(row); } catch (Exception ignored) {} } cursor.close(); return result;
        }

        void saveAttempt(JSONObject attempt) throws Exception { ContentValues values = new ContentValues(); values.put("id", attempt.getString("id")); values.put("problem_id", attempt.getString("problemId")); values.put("mode", attempt.getString("mode")); values.put("elapsed_ms", attempt.getLong("elapsedMs")); values.put("hints_used", attempt.getInt("hintsUsed")); values.put("mistakes", attempt.getInt("mistakes")); values.put("outcome", attempt.getString("outcome")); values.put("created_at", attempt.getString("createdAt")); getWritableDatabase().insertOrThrow("attempts", null, values); }
        void deleteLibrary(String id) { SQLiteDatabase db = getWritableDatabase(); db.beginTransaction(); try { db.delete("attempts", "problem_id IN (SELECT id FROM problems WHERE library_id=?)", new String[] { id }); db.delete("problems", "library_id=?", new String[] { id }); db.delete("libraries", "id=?", new String[] { id }); db.setTransactionSuccessful(); } finally { db.endTransaction(); } }
        void hideProblem(String id) { ContentValues values = new ContentValues(); values.put("active", 0); getWritableDatabase().update("problems", values, "id=?", new String[] { id }); }
    }
}

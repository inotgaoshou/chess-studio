package cn.xiangqi.endgame.training;

import android.content.res.AssetManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

import org.json.JSONArray;

@CapacitorPlugin(name = "Pikafish")
public class PikafishPlugin extends Plugin {
    private static final String ENGINE_FILE = "libpikafish.so";
    private static final String NNUE_ASSET = "pikafish/pikafish.nnue";
    private static final String NNUE_FILE = "pikafish.nnue";
    private static final String ENGINE_SHA256 = "6c06b8752e10c1ed605fa836d2c9bbf885e9c402b216023040ddf4586f4320b1";
    private static final String NNUE_SHA256 = "7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicLong requestGeneration = new AtomicLong();
    private volatile Process activeProcess;
    private volatile boolean resourcesPrepared;

    @PluginMethod
    public void bestMove(PluginCall call) {
        submitAnalysis(call, true);
    }

    @PluginMethod
    public void analyze(PluginCall call) {
        submitAnalysis(call, false);
    }

    private void submitAnalysis(PluginCall call, boolean bestMoveOnly) {
        String fen = call.getString("fen");
        if (fen == null || fen.trim().isEmpty()) {
            call.reject("缺少当前局面");
            return;
        }
        int moveTimeMs = PikafishProtocol.clampMoveTimeMs(call.getInt("moveTimeMs"));
        int multiPv = bestMoveOnly ? 1 : PikafishProtocol.clampMultiPv(call.getInt("multiPv"));
        long request = requestGeneration.incrementAndGet();
        stopActiveProcess();
        executor.execute(() -> {
            if (request != requestGeneration.get()) {
                call.reject("本地引擎请求已取消");
                return;
            }
            try {
                AnalysisResult analysis = runAnalysis(fen.trim(), moveTimeMs, multiPv, request);
                if (request != requestGeneration.get()) {
                    call.reject("本地引擎请求已取消");
                    return;
                }
                JSObject result = new JSObject();
                if (bestMoveOnly) result.put("iccs", analysis.bestMove);
                else putAnalysis(result, analysis);
                call.resolve(result);
            } catch (CancellationException error) {
                call.reject("本地引擎请求已取消");
            } catch (Exception error) {
                String detail = error instanceof IllegalStateException ? error.getMessage() : null;
                call.reject(detail == null || detail.isBlank()
                    ? "本地 Pikafish 启动或计算失败"
                    : "本地 Pikafish 启动或计算失败：" + detail);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        requestGeneration.incrementAndGet();
        stopActiveProcess();
        call.resolve();
    }

    private AnalysisResult runAnalysis(String fen, int moveTimeMs, int multiPv, long request) throws Exception {
        EngineResources resources = prepareResources(request);
        ensureRequestActive(request);
        Process process = new ProcessBuilder(resources.engine.getAbsolutePath())
            .directory(resources.nnue.getParentFile())
            .redirectErrorStream(true)
            .start();
        activeProcess = process;
        try {
            ensureRequestActive(request);
            try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
                 BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                send(writer, "uci");
                waitFor(reader, process, request, 90_000, line -> "uciok".equals(line.trim()), "UCI 握手超时");
                send(writer, "setoption name Threads value 2");
                send(writer, "setoption name Hash value 128");
                send(writer, "setoption name MultiPV value " + multiPv);
                send(writer, "setoption name EvalFile value " + resources.nnue.getAbsolutePath());
                send(writer, "isready");
                waitFor(reader, process, request, 90_000, line -> "readyok".equals(line.trim()), "NNUE 加载超时");
                send(writer, "position fen " + fen);
                send(writer, "go movetime " + moveTimeMs);
                AnalysisResult analysis = waitForAnalysis(reader, process, request, moveTimeMs + 60_000L);
                send(writer, "quit");
                return analysis;
            }
        } finally {
            if (activeProcess == process) activeProcess = null;
            if (process.isAlive()) process.destroyForcibly();
        }
    }

    private synchronized EngineResources prepareResources(long request) throws Exception {
        ensureRequestActive(request);
        File engine = new File(getContext().getApplicationInfo().nativeLibraryDir, ENGINE_FILE);
        File directory = new File(getContext().getNoBackupFilesDir(), "pikafish");
        File nnue = new File(directory, NNUE_FILE);
        if (!resourcesPrepared) {
            if (!engine.isFile() || !ENGINE_SHA256.equals(sha256(engine))) {
                throw new IllegalStateException("APK 内置 Pikafish 校验失败");
            }
            ensureRequestActive(request);
            if (!NNUE_SHA256.equals(sha256IfFile(nnue))) copyNnueAtomically(directory, nnue, request);
            ensureRequestActive(request);
            resourcesPrepared = true;
        }
        return new EngineResources(engine, nnue);
    }

    private void copyNnueAtomically(File directory, File target, long request) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("无法创建本地引擎目录");
        }
        File temporary = new File(directory, NNUE_FILE + ".tmp");
        try {
            try (InputStream input = getContext().getAssets().open(NNUE_ASSET, AssetManager.ACCESS_STREAMING);
                 FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    ensureRequestActive(request);
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }
            ensureRequestActive(request);
            if (!NNUE_SHA256.equals(sha256(temporary))) {
                throw new IllegalStateException("APK 内置 NNUE 校验失败");
            }
            ensureRequestActive(request);
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception error) {
            temporary.delete();
            throw error;
        }
    }

    private String sha256IfFile(File file) throws Exception {
        return file.isFile() ? sha256(file) : "";
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format("%02x", value));
        return result.toString();
    }

    private void send(BufferedWriter writer, String command) throws Exception {
        writer.write(command);
        writer.newLine();
        writer.flush();
    }

    private String waitFor(BufferedReader reader, Process process, long request, long timeoutMs, LineMatcher matcher, String timeoutMessage) throws Exception {
        long deadline = System.nanoTime() + timeoutMs * 1_000_000L;
        while (System.nanoTime() < deadline) {
            ensureRequestActive(request);
            if (reader.ready()) {
                String line = reader.readLine();
                if (line == null) break;
                if (matcher.matches(line)) return line;
            } else {
                if (!process.isAlive()) throw new IllegalStateException("Pikafish 进程已退出（" + process.exitValue() + "）");
                Thread.sleep(10);
            }
        }
        throw new IllegalStateException(timeoutMessage);
    }

    private AnalysisResult waitForAnalysis(BufferedReader reader, Process process, long request, long timeoutMs) throws Exception {
        long deadline = System.nanoTime() + timeoutMs * 1_000_000L;
        Map<Integer, PikafishProtocol.AnalysisLine> lines = new TreeMap<>();
        while (System.nanoTime() < deadline) {
            ensureRequestActive(request);
            if (reader.ready()) {
                String line = reader.readLine();
                if (line == null) break;
                PikafishProtocol.AnalysisLine info = PikafishProtocol.parseInfo(line);
                if (info != null && !info.pv.isEmpty()) {
                    PikafishProtocol.AnalysisLine previous = lines.get(info.multiPv);
                    if (previous == null || info.depth >= previous.depth) lines.put(info.multiPv, info);
                }
                String bestMove = PikafishProtocol.parseBestMove(line);
                if (bestMove != null) return new AnalysisResult(bestMove, lines);
            } else {
                if (!process.isAlive()) throw new IllegalStateException("Pikafish 进程提前退出");
                Thread.sleep(10);
            }
        }
        throw new IllegalStateException("引擎计算超时");
    }

    private void putAnalysis(JSObject result, AnalysisResult analysis) {
        result.put("bestMove", analysis.bestMove);
        JSONArray rows = new JSONArray();
        for (PikafishProtocol.AnalysisLine line : analysis.lines.values()) {
            JSObject row = new JSObject();
            row.put("multipv", line.multiPv);
            row.put("depth", line.depth);
            if (line.scoreCp != null) row.put("scoreCp", line.scoreCp);
            if (line.mate != null) row.put("mate", line.mate);
            row.put("nodes", line.nodes);
            row.put("nps", line.nps);
            row.put("pv", new JSONArray(line.pv));
            rows.put(row);
        }
        result.put("lines", rows);
    }

    private void ensureRequestActive(long request) {
        if (request != requestGeneration.get() || Thread.currentThread().isInterrupted()) {
            throw new CancellationException("request cancelled");
        }
    }

    private void stopActiveProcess() {
        Process process = activeProcess;
        if (process != null && process.isAlive()) process.destroyForcibly();
    }

    @Override
    protected void handleOnDestroy() {
        requestGeneration.incrementAndGet();
        stopActiveProcess();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private interface LineMatcher {
        boolean matches(String line);
    }

    private static final class EngineResources {
        final File engine;
        final File nnue;

        EngineResources(File engine, File nnue) {
            this.engine = engine;
            this.nnue = nnue;
        }
    }

    private static final class AnalysisResult {
        final String bestMove;
        final Map<Integer, PikafishProtocol.AnalysisLine> lines;

        AnalysisResult(String bestMove, Map<Integer, PikafishProtocol.AnalysisLine> lines) {
            this.bestMove = bestMove;
            this.lines = lines;
        }
    }
}

package cn.xiangqi.endgame.training;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

final class PikafishProtocol {
    private static final int DEFAULT_MOVE_TIME_MS = 800;
    private static final int MIN_MOVE_TIME_MS = 100;
    private static final int MAX_MOVE_TIME_MS = 5000;

    private PikafishProtocol() {}

    static String parseBestMove(String line) {
        if (line == null) return null;
        String[] parts = line.trim().split("\\s+");
        if (parts.length < 2 || !"bestmove".equals(parts[0])) return null;
        String move = parts[1].toLowerCase(Locale.ROOT);
        return move.matches("[a-i][0-9][a-i][0-9]") ? move : null;
    }

    static int clampMoveTimeMs(Integer requested) {
        int value = requested == null ? DEFAULT_MOVE_TIME_MS : requested;
        return Math.max(MIN_MOVE_TIME_MS, Math.min(MAX_MOVE_TIME_MS, value));
    }

    static int clampMultiPv(Integer requested) {
        int value = requested == null ? 4 : requested;
        return Math.max(1, Math.min(4, value));
    }

    static AnalysisLine parseInfo(String line) {
        if (line == null) return null;
        String[] parts = line.trim().split("\\s+");
        if (parts.length < 2 || !"info".equals(parts[0])) return null;
        AnalysisLine result = new AnalysisLine();
        for (int index = 1; index < parts.length; index++) {
            switch (parts[index]) {
                case "depth":
                    result.depth = intAt(parts, ++index, result.depth);
                    break;
                case "multipv":
                    result.multiPv = intAt(parts, ++index, result.multiPv);
                    break;
                case "nodes":
                    result.nodes = longAt(parts, ++index, result.nodes);
                    break;
                case "nps":
                    result.nps = longAt(parts, ++index, result.nps);
                    break;
                case "score":
                    if (index + 2 < parts.length) {
                        String kind = parts[++index];
                        Integer value = nullableInt(parts[++index]);
                        if ("cp".equals(kind)) result.scoreCp = value;
                        if ("mate".equals(kind)) result.mate = value;
                    }
                    break;
                case "pv":
                    List<String> pv = new ArrayList<>();
                    while (++index < parts.length) {
                        String move = parts[index].toLowerCase(Locale.ROOT);
                        if (move.matches("[a-i][0-9][a-i][0-9]")) pv.add(move);
                    }
                    result.pv = Collections.unmodifiableList(pv);
                    break;
                default:
                    break;
            }
        }
        return result;
    }

    private static int intAt(String[] parts, int index, int fallback) {
        Integer value = index < parts.length ? nullableInt(parts[index]) : null;
        return value == null ? fallback : value;
    }

    private static long longAt(String[] parts, int index, long fallback) {
        if (index >= parts.length) return fallback;
        try { return Long.parseLong(parts[index]); }
        catch (NumberFormatException ignored) { return fallback; }
    }

    private static Integer nullableInt(String value) {
        try { return Integer.valueOf(value); }
        catch (NumberFormatException ignored) { return null; }
    }

    static final class AnalysisLine {
        int depth;
        int multiPv = 1;
        Integer scoreCp;
        Integer mate;
        long nodes;
        long nps;
        List<String> pv = Collections.emptyList();
    }
}

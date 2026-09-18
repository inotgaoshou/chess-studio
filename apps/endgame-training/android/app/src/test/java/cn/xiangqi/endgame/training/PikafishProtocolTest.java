package cn.xiangqi.endgame.training;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PikafishProtocolTest {

    @Test
    public void parsesBestMoveAndIgnoresPonderMove() {
        assertEquals("h2e2", PikafishProtocol.parseBestMove("bestmove h2e2 ponder h9g7"));
    }

    @Test
    public void rejectsMissingAndNullBestMoves() {
        assertNull(PikafishProtocol.parseBestMove("info depth 12 pv h2e2"));
        assertNull(PikafishProtocol.parseBestMove("bestmove (none)"));
        assertNull(PikafishProtocol.parseBestMove("bestmove 0000"));
    }

    @Test
    public void clampsMoveTimeForMobileSearches() {
        assertEquals(800, PikafishProtocol.clampMoveTimeMs(null));
        assertEquals(100, PikafishProtocol.clampMoveTimeMs(20));
        assertEquals(1200, PikafishProtocol.clampMoveTimeMs(1200));
        assertEquals(5000, PikafishProtocol.clampMoveTimeMs(9000));
    }

    @Test
    public void parsesStructuredMultiPvAnalysis() {
        PikafishProtocol.AnalysisLine line = PikafishProtocol.parseInfo(
            "info depth 18 seldepth 25 multipv 2 score cp -43 nodes 12345 nps 98765 pv h2e2 h9g7"
        );

        assertEquals(18, line.depth);
        assertEquals(2, line.multiPv);
        assertEquals(Integer.valueOf(-43), line.scoreCp);
        assertNull(line.mate);
        assertEquals(12345L, line.nodes);
        assertEquals(98765L, line.nps);
        assertEquals("h2e2", line.pv.get(0));
        assertEquals("h9g7", line.pv.get(1));
    }

    @Test
    public void parsesMateScoresAndRejectsNonAnalysisLines() {
        PikafishProtocol.AnalysisLine line = PikafishProtocol.parseInfo(
            "info depth 22 multipv 1 score mate 3 nodes 9 nps 20 pv a0a1"
        );

        assertEquals(Integer.valueOf(3), line.mate);
        assertNull(line.scoreCp);
        assertNull(PikafishProtocol.parseInfo("bestmove a0a1"));
    }
}

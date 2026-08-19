import test from "node:test";
import assert from "node:assert/strict";
import {
  dhtmlMoveListToIccs,
  extractGdchessIndexLinks,
  extractGdchessLinks,
  extractXiangqiqipuLinks,
  gameToMoveRows,
  gameToPgn,
  gameToPositionJobs,
  parseGdchessGame,
  parseOneXqGame,
  parseXiangqiqipuGame,
} from "./zhao-public-games.mjs";
import {
  extractOneXqGameListLinks,
  extractOneXqProfileEventLinks,
  extractOneXqRecentGameLinks,
} from "./master-public-games.mjs";

test("converts DhtmlXQ coordinate moves to ICCS", () => {
  assert.deepEqual(dhtmlMoveListToIccs("26252042"), ["c3c4", "c9e7"]);
});

test("extracts Xiangqiqipu category links mentioning Zhao Xinxin", () => {
  const html = `
    <a href="/Category/View-42812.html" title="赵鑫鑫 先负 陈汉华">棋谱</a>
    <a href="/Category/View-1.html" title="许银川 先胜 胡荣华">其它</a>
  `;
  assert.deepEqual(extractXiangqiqipuLinks(html), [
    {
      sourceUrl: "https://www.xiangqiqipu.com/Category/View-42812.html",
      title: "赵鑫鑫 先负 陈汉华",
    },
  ]);
});

test("extracts gdchess Zhao game links and pagination", () => {
  const html = `
    <table>
      <tr><td>1</td><td>2023-12-13</td><td><a href="/xqgame/gview.asp?id=50E93850-991E-" target="_blank">赵鑫鑫 先<font color=gray>和</font> 黄竹风</a></td><td>2023仙人指路杯大师邀请赛男子组</td></tr>
      <tr><td>2</td><td>2023-12-13</td><td><a href="/xqgame/gview.asp?id=OTHER">蒋川 先胜 孟辰</a></td><td>其它赛</td></tr>
    </table>
    <div>[<a href="?pid=0074&page=2">下页</a>][<a href="?pid=0074&page=88">尾页</a>]</div>
  `;
  assert.deepEqual(extractGdchessLinks(html, "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074"), [
    {
      sourceUrl: "http://www.gdchess.com/xqgame/gview.asp?id=50E93850-991E-",
      sourceSite: "gdchess.com",
      title: "赵鑫鑫 先和 黄竹风",
      listedDate: "2023-12-13",
      eventHint: "2023仙人指路杯大师邀请赛男子组",
    },
  ]);
  assert.deepEqual(extractGdchessIndexLinks(html, "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074"), [
    "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074&page=2",
    "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074&page=88",
  ]);
});

test("extracts gdchess links for a specified master player and source id", () => {
  const html = `
    <table>
      <tr><td>1</td><td>2024-01-01</td><td><a href="/xqgame/gview.asp?id=xu-game">许银川 先胜 胡荣华</a></td><td>测试赛</td></tr>
      <tr><td>2</td><td>2024-01-02</td><td><a href="/xqgame/gview.asp?id=zhao-game">赵鑫鑫 先和 黄竹风</a></td><td>测试赛</td></tr>
    </table>
    <div>[<a href=?pid=0001&page=2>下页</a>][<a href="?pid=0074&page=2">赵页</a>]</div>
    <div><a href="/xqplayer/xqplayer.asp?pid=0001">棋手资料不是棋谱分页</a></div>
  `;
  assert.deepEqual(extractGdchessLinks(html, "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0001", "许银川"), [
    {
      sourceUrl: "http://www.gdchess.com/xqgame/gview.asp?id=xu-game",
      sourceSite: "gdchess.com",
      title: "许银川 先胜 胡荣华",
      listedDate: "2024-01-01",
      eventHint: "测试赛",
    },
  ]);
  assert.deepEqual(extractGdchessIndexLinks(html, "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0001", "0001"), [
    "http://www.gdchess.com/xqgame/xqpgame.asp?pid=0001&page=2",
  ]);
});

test("extracts gdchess links when player names contain full-width spaces", () => {
  const html = `
    <table>
      <tr><td>1</td><td>2026-03-01</td><td><a href="/xqgame/gview.asp?id=lu-game">徐天红 先<font color=green>负</font> 吕　钦</a></td><td>五羊杯元老组</td></tr>
      <tr><td>2</td><td>2026-03-01</td><td><a href="/xqgame/gview.asp?id=other-game">柳大华 先胜 于幼华</a></td><td>五羊杯元老组</td></tr>
    </table>
  `;
  assert.deepEqual(extractGdchessLinks(html, "http://www.gdchess.com/XQData/GameList.asp?eid=100003465", "吕钦"), [
    {
      sourceUrl: "http://www.gdchess.com/xqgame/gview.asp?id=lu-game",
      sourceSite: "gdchess.com",
      title: "徐天红 先负 吕 钦",
      listedDate: "2026-03-01",
      eventHint: "五羊杯元老组",
    },
  ]);
});

test("parses gdchess MOVE_STR game pages", () => {
  const html = `
    <title>赵鑫鑫 和 崔革 - 2016第7届杨官璘杯专业男子组</title>
    <div id="game-info">
      <div class="info-title">赛事：2016第7届杨官璘杯专业男子组 第5轮 日期:20160907</div>
      <a href="/xqplayer/xqplayer.asp?pid=0074">赵鑫鑫</a> 先和 <a href="/xqplayer/xqplayer.asp?pid=7579">崔　革</a>
    </div>
    <script>
      MOVE_STR = "69477232";
      AIScores = [-5,7];
    </script>
  `;
  const game = parseGdchessGame(html, "http://www.gdchess.com/xqgame/gview.asp?id=sample");
  assert.equal(game.sourceSite, "gdchess.com");
  assert.equal(game.redPlayer, "赵鑫鑫");
  assert.equal(game.blackPlayer, "崔革");
  assert.equal(game.event, "2016第7届杨官璘杯专业男子组 第5轮");
  assert.equal(game.date, "2016-09-07");
  assert.equal(game.result, "1/2-1/2");
  assert.deepEqual(game.moves, ["g0e2", "h7d7"]);
  assert.match(gameToPgn(game), /\[Site "http:\/\/www\.gdchess\.com\/xqgame\/gview\.asp\?id=sample"\]/);
});

test("extracts 01xq profile event and recent game links for Lu Qin", () => {
  const html = `
    <div id="qp">
      <b>20260301</b> <a href="http://www.01xq.com/e_game_view.asp?id=0030438DA3414E">XuTianHong <font color=green>0-2</font> LvQin</a> 2026 32nd Wu Yang Cup Xiangqi Tournament Elder Group<br />
    </div>
    <table>
      <tr><td>1</td><td>2026-03-01</td><td>10003</td><td><a href='../archives/EventInfo.asp?eid=100003465'>2026 32nd Wu Yang Cup Xiangqi Tournament Elder Group</a></td></tr>
    </table>
  `;
  assert.deepEqual(extractOneXqRecentGameLinks(html, "http://www.01xq.com/xqplayer/xqplayer.asp?pid=0002", "吕钦"), [
    {
      sourceUrl: "http://www.01xq.com/e_game_view.asp?id=0030438DA3414E",
      sourceSite: "01xq.com",
      title: "XuTianHong 0-2 LvQin",
      listedDate: "2026-03-01",
      eventHint: "2026 32nd Wu Yang Cup Xiangqi Tournament Elder Group",
    },
  ]);
  assert.deepEqual(extractOneXqProfileEventLinks(html, "http://www.01xq.com/xqplayer/xqplayer.asp?pid=0002"), [
    {
      sourceUrl: "http://www.01xq.com/archives/GameList.asp?eid=100003465",
      infoUrl: "http://www.01xq.com/archives/EventInfo.asp?eid=100003465",
      sourceSite: "01xq.com",
      title: "2026 32nd Wu Yang Cup Xiangqi Tournament Elder Group",
      listedDate: "2026-03-01",
    },
  ]);
});

test("extracts and parses 01xq MOVE_STR game pages", () => {
  const listHtml = `
    <table>
      <tr><td>20260301</td><td>5</td><td>1</td><td>XuTianHong</td><td><font color=green>0-2</font></td><td>LvQin</td><td><a href=http://www.01xq.com/e_game_view.asp?id=0030438DA3414E>View</a></td><td>72</td><td>Central Cannon</td></tr>
    </table>
  `;
  assert.deepEqual(extractOneXqGameListLinks(listHtml, "http://www.01xq.com/archives/GameList.asp?eid=100003465", "吕钦"), [
    {
      sourceUrl: "http://www.01xq.com/e_game_view.asp?id=0030438DA3414E",
      sourceSite: "01xq.com",
      title: "徐天红 0-2 吕钦",
      listedDate: "2026-03-01",
      roundHint: "Round 5",
      openingHint: "Central Cannon",
    },
  ]);

  const gameHtml = `
    <title>2026 32nd Wu Yang Cup Xiangqi Tournament Elder GroupXuTianHong 0:2 LvQin</title>
    <div id="game_tips" class="game_tips"><div></div><div>XuTianHong 0:2 LvQin - 2026 32nd Wu Yang Cup Xiangqi Tournament Elder Group Round 5 </div></div>
    <script>
      MOVE_STR = "77477062";
    </script>
  `;
  const game = parseOneXqGame(gameHtml, "http://www.01xq.com/e_game_view.asp?id=0030438DA3414E");
  assert.equal(game.sourceSite, "01xq.com");
  assert.equal(game.redPlayer, "徐天红");
  assert.equal(game.blackPlayer, "吕钦");
  assert.equal(game.result, "0-1");
  assert.equal(game.round, "Round 5");
  assert.deepEqual(game.moves, ["h2e2", "h9g7"]);
});

test("parses DhtmlXQ game metadata and emits ICCS PGN", () => {
  const html = `
    <h1>赵鑫鑫 先胜 某棋手</h1>
    <div id="qipu">
      [DhtmlXQ]
      [DhtmlXQ_title]赵鑫鑫 胜 某棋手[/DhtmlXQ_title]
      [DhtmlXQ_movelist]26252042[/DhtmlXQ_movelist]
      [DhtmlXQ_redname]赵鑫鑫[/DhtmlXQ_redname]
      [DhtmlXQ_blackname]某棋手[/DhtmlXQ_blackname]
      [DhtmlXQ_event]测试赛[/DhtmlXQ_event]
      [DhtmlXQ_date]2026-08-05[/DhtmlXQ_date]
      [DhtmlXQ_result]红胜[/DhtmlXQ_result]
      [DhtmlXQ_open]仙人指路[/DhtmlXQ_open]
      [/DhtmlXQ]
    </div>
  `;
  const game = parseXiangqiqipuGame(html, "https://example.test/game");
  assert.equal(game.redPlayer, "赵鑫鑫");
  assert.equal(game.blackPlayer, "某棋手");
  assert.equal(game.result, "1-0");
  assert.deepEqual(game.moves, ["c3c4", "c9e7"]);
  const pgn = gameToPgn(game);
  assert.match(pgn, /\[Format "ICCS"\]/);
  assert.match(pgn, /1\. c3c4 c9e7 1-0/);
});

test("does not infer players from commentary titles containing win words", () => {
  const html = `
    <h1>传世名局：据传出自王天一VS赵鑫鑫，瞎眼狗&弃车砍卒&无车胜有车</h1>
    <div id="qipu">
      [DhtmlXQ]
      [DhtmlXQ_title]传世名局：据传出自王天一VS赵鑫鑫，瞎眼狗&弃车砍卒&无车胜有车[/DhtmlXQ_title]
      [DhtmlXQ_movelist]26252042[/DhtmlXQ_movelist]
      [/DhtmlXQ]
    </div>
  `;
  const game = parseXiangqiqipuGame(html, "https://example.test/game");
  assert.equal(game.redPlayer, "");
  assert.equal(game.blackPlayer, "");
  assert.equal(gameToPositionJobs(game).length, 0);
});

test("builds Zhao-only position jobs with FEN before the played move", () => {
  const game = {
    sourceUrl: "https://example.test/game",
    fingerprint: "sample",
    redPlayer: "赵鑫鑫",
    blackPlayer: "某棋手",
    event: "测试赛",
    date: "2026-08-05",
    opening: "仙人指路",
    moves: ["c3c4", "c7c6", "h2e2"],
  };
  const jobs = gameToPositionJobs(game);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].beforeFen, "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  assert.equal(jobs[0].playedMove, "c3c4");
  assert.equal(jobs[1].playedMove, "h2e2");
});

test("expands every game move for MySQL master_game_moves import", () => {
  const game = {
    sourceUrl: "https://example.test/game",
    fingerprint: "sample",
    redPlayer: "赵鑫鑫",
    blackPlayer: "某棋手",
    moves: ["c3c4", "c7c6"],
  };
  const rows = gameToMoveRows(game);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ply, 1);
  assert.equal(rows[0].moveNo, 1);
  assert.equal(rows[0].sideToMove, "red");
  assert.equal(rows[0].moveIccs, "c3c4");
  assert.equal(rows[0].phase, "opening");
  assert.equal(rows[1].sideToMove, "black");
  assert.equal(rows[1].moveIccs, "c7c6");
  assert.match(rows[1].beforeFen, / b /);
});

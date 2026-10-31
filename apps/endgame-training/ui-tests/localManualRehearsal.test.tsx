// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalManualRehearsal } from "../src/LocalManualRehearsal";
import type { LocalManualGame } from "../src/types";
import { Board } from "../src/App";
import { playTrainingFeedback, type TrainingFeedbackEvent } from "../src/moveFeedback";
import { boardAt } from "../src/wasm";

vi.mock("../src/moveFeedback", async importOriginal => ({
  ...await importOriginal<typeof import("../src/moveFeedback")>(),
  playTrainingFeedback: vi.fn(), cancelTrainingFeedback: vi.fn(),
}));

vi.mock("../src/wasm", () => ({
  hasLocalPikafish: () => false,
  boardAt: vi.fn(async (_fen: string, moves: string[]) => ({
    fen: `4k4/9/9/9/9/9/9/9/9/4K4 ${moves.length % 2 ? "b" : "w"} - - 0 1`,
    pieces: [{ row: moves.length ? 8 : 9, col: 0, color: "red",kind:"rook",label:"车" }, { row: moves.length > 1 ? 1 : 0, col: 0, color: "black",kind:"rook",label:"车" }],
    status: "进行中",
  })),
  chineseLine: vi.fn(async () => ["车九进一"]),
}));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.useRealTimers(); });
const game: LocalManualGame = {
  id: "rehearsal-test", title: "测试棋谱", note: "", startingFen: "start w - - 0 1",
  currentNodeId: "root", currentFen: "start w - - 0 1",
  moves: ["a0a1", "a9a8", "a1a2"], cursor: 0, branches: [], comments: {},
  createdAt: "", updatedAt: "",
};

it("lets the chosen side move, auto-plays the opponent and preserves the board on a wrong move", async () => {
  render(<LocalManualRehearsal game={game} onClose={vi.fn()} renderBoard={(_board, _selected, _hint, flipped, _square, move) =>
    <div data-testid="rehearsal-board" data-flipped={flipped}>
      <button onClick={() => move({ row: 9, col: 0 }, { row: 8, col: 0 })}>走正着</button>
      <button onClick={() => move({ row: 9, col: 0 }, { row: 7, col: 0 })}>走错着</button>
    </div>
  }/>);
  await screen.findByTestId("rehearsal-board");
  expect(screen.getByTestId("rehearsal-board").getAttribute("data-flipped")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "走错着" }));
  expect(screen.getByText(/偏差 1 次/)).toBeTruthy();
  expect(screen.getByText(/已走 0 步/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "走正着" }));
  await waitFor(() => expect(screen.getByText(/已走 2 步/)).toBeTruthy(), { timeout: 2500 });
  expect(screen.getByText(/偏差 1 次/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "我执黑" }));
  await waitFor(() => expect(screen.getByText(/已走 1 步/)).toBeTruthy(), { timeout: 2500 });
  expect(screen.getByTestId("rehearsal-board").getAttribute("data-flipped")).toBe("true");
  expect(screen.getByText(/偏差 0 次/)).toBeTruthy();
});

it("animates and sounds actual rehearsal moves and replies, but not restart or wrong moves", async () => {
  vi.useFakeTimers();
  const renderBoard=(board:any,selected:any,hint:any,flipped:boolean,square:any,move:any,feedback?:{lastMove?:string;event?:TrainingFeedbackEvent})=><Board pieces={board.pieces} selected={selected} hintMove={hint} flipped={flipped} lastMove={feedback?.lastMove} feedback={feedback?.event?.kind} feedbackEvent={feedback?.event} boardSkin="classic" pieceSkin="classic" riverText="" riverTextColor="#000" riverTextSize={20} supportsCustomRiverText={false} onSquare={square} onMove={move}/>;
  const ui=render(<LocalManualRehearsal game={game} onClose={vi.fn()} renderBoard={renderBoard}/>);
  await act(async()=>{});
  fireEvent.click(screen.getByRole('button',{name:'a0 红车',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'a2',exact:true}));
  expect(playTrainingFeedback).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'a0 红车',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'a1',exact:true}));
  await act(async()=>{});
  expect(playTrainingFeedback).toHaveBeenCalledWith(expect.objectContaining({iccs:'a0a1',kind:'move'}));
  expect(ui.container.querySelector('.board-moving-piece')).toBeTruthy();
  await act(async()=>{vi.advanceTimersByTime(420);});
  expect(playTrainingFeedback).toHaveBeenCalledTimes(2);
  expect(playTrainingFeedback).toHaveBeenLastCalledWith(expect.objectContaining({iccs:'a9a8'}));
  expect(ui.container.querySelector('.board-moving-piece')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'重新开始'}));
  await act(async()=>{});
  expect(ui.container.querySelector('.board-moving-piece')).toBeNull();
  expect(playTrainingFeedback).toHaveBeenCalledTimes(2);
});

it("lets a capture cue finish before the automatic reply and cancels it on backgrounding", async () => {
  vi.useFakeTimers();
  const initial=await boardAt(game.startingFen,[]);
  vi.mocked(boardAt).mockResolvedValueOnce(initial).mockResolvedValueOnce({...initial,fen:initial.fen.replace(' w ',' b '),pieces:[{row:0,col:0,color:'red',kind:'rook',label:'车'}]});
  render(<LocalManualRehearsal game={{...game,moves:['a0a9','b9c7']}} onClose={vi.fn()} renderBoard={(_board,_selected,_hint,_flipped,_square,move)=><button onClick={()=>move({row:9,col:0},{row:0,col:0})}>吃车</button>}/>);
  await act(async()=>{});
  fireEvent.click(screen.getByRole('button',{name:'吃车'}));
  await act(async()=>{});
  expect(playTrainingFeedback).toHaveBeenCalledWith(expect.objectContaining({kind:'capture',captured:expect.objectContaining({kind:'rook'})}));
  await act(async()=>{vi.advanceTimersByTime(420);});
  expect(playTrainingFeedback).toHaveBeenCalledTimes(1);
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  fireEvent(document,new Event('visibilitychange'));
  await act(async()=>{vi.advanceTimersByTime(2000);});
  expect(playTrainingFeedback).toHaveBeenCalledTimes(1);
  visibility.mockRestore();
});

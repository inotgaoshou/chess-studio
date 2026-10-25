import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { Board } from "../src/App";
import { cancelTrainingFeedback, playTrainingFeedback, trainingFeedbackEvent, TRAINING_FEEDBACK_PACK, FEEDBACK_DURATION } from "../src/moveFeedback";
import { currentVerification, needsTerminalWin, terminalWin, VERIFIER_VERSION } from "../src/verificationPolicy";
import type { BoardPiece, BoardState } from "../src/types";

const piece:BoardPiece={row:0,col:2,color:"red",kind:"horse",label:"马"};
const state:BoardState={fen:"9/3kN4/9/9/9/9/9/9/9/4K4 b - - 1 1",pieces:[{...piece,row:1,col:4}],sideToMove:"black",status:"将军"};
afterEach(()=>{cancelTrainingFeedback();vi.unstubAllGlobals();vi.useRealTimers();});
describe("actual-move feedback",()=>{
  it("repeated checks have independent events; board overlays expire without moving hit targets",()=>{
    vi.useFakeTimers();
    const first=trainingFeedbackEvent([piece],state,"c9e8");
    const second=trainingFeedbackEvent([piece],state,"c9e8");
    expect(first.kind).toBe("check");expect(second.id).not.toBe(first.id);
    const props={pieces:state.pieces,lastMove:"c9e8",feedback:first.kind,feedbackEvent:first,boardSkin:"classic",pieceSkin:"classic",riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:false,onSquare:vi.fn()};
    const ui=render(<Board {...props}/>);
    expect(ui.container.querySelectorAll(".board-square")).toHaveLength(90);
    const target=ui.container.querySelector('.board-square[aria-label="e8 红马"]') as HTMLElement;
    const position=target.style.cssText;
    expect(ui.container.querySelector(".board-moving-piece")).toBeTruthy();
    const origin=ui.container.querySelector('.board-square[aria-label="c9"]') as HTMLElement;
    const moving=ui.container.querySelector(".board-moving-piece") as HTMLElement;
    expect(moving.style.getPropertyValue("--move-from-x")).toBe(origin.style.getPropertyValue("--piece-left"));
    expect(moving.style.getPropertyValue("--move-from-y")).toBe(origin.style.getPropertyValue("--piece-top"));
    expect(moving.style.getPropertyValue("--move-to-x")).toBe(target.style.getPropertyValue("--piece-left"));
    expect(moving.style.getPropertyValue("--move-to-y")).toBe(target.style.getPropertyValue("--piece-top"));
    act(()=>vi.advanceTimersByTime(180));
    expect(ui.container.querySelector(".board-moving-piece")).toBeNull();
    expect(target.style.cssText).toBe(position);
    const oldSeal=ui.container.querySelector(".ink-feedback");
    ui.rerender(<Board {...props} feedbackEvent={second}/>);
    expect(ui.container.querySelector(".ink-feedback")).not.toBe(oldSeal);
    expect(ui.container.querySelector(".board-moving-piece")).toBeTruthy();
    ui.rerender(<Board {...props} feedbackEvent={undefined} lastMove={undefined}/>);
    expect(ui.container.querySelector(".board-moving-piece")).toBeNull();
  });
  it("keeps a capture notice visible while the next piece responds immediately",()=>{
    vi.useFakeTimers();const onSquare=vi.fn(),capture={id:9901,kind:"capture" as const,iccs:"c9e8",piece};
    const props={pieces:state.pieces,lastMove:"c9e8",feedback:"capture" as const,feedbackEvent:capture,boardSkin:"classic",pieceSkin:"classic",riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:false,onSquare};
    const ui=render(<Board {...props}/>);const notice=ui.container.querySelector(".capture-feedback");
    act(()=>vi.advanceTimersByTime(100));ui.rerender(<Board {...props} lastMove="e8c7" feedback="move" feedbackEvent={{...capture,id:9902,kind:"move",iccs:"e8c7"}}/>);
    fireEvent.click(ui.container.querySelector(".board-square")!);expect(onSquare).toHaveBeenCalled();expect(ui.container.querySelector(".capture-feedback")).toBe(notice);
    expect((ui.container.querySelector(".xiangqi-board") as HTMLElement).style.getPropertyValue("--feedback-duration")).toBe(`${FEEDBACK_DURATION.capture}ms`);
    act(()=>vi.advanceTimersByTime(FEEDBACK_DURATION.capture-100));expect(ui.container.querySelector(".capture-feedback")).toBeNull();
  });
  it("uses distinct stalemate audio and tolerates rejected playback",async()=>{
    const instances:Array<{src:string;pause:ReturnType<typeof vi.fn>;play:ReturnType<typeof vi.fn>}> = [];
    vi.stubGlobal("Audio",class {currentTime=0;volume=0;preload="";pause=vi.fn();play=vi.fn(()=>Promise.reject(Error("muted")));constructor(public src:string){instances.push(this);}});
    playTrainingFeedback("checkmate");playTrainingFeedback("stalemate");
    expect(instances[0].src).not.toBe(instances[1].src);
    expect(instances[1].src).toBe(TRAINING_FEEDBACK_PACK.voice.stalemate);
    expect(instances[0].pause).toHaveBeenCalled();
    await Promise.resolve();
  });
  it("guards old verdicts and terminal results for either solver side",()=>{
    expect(()=>currentVerification({verifierVersion:"training-multisolution-v1"} as never)).toThrow();
    expect(currentVerification({verifierVersion:VERIFIER_VERSION} as never)).toBeTruthy();
    expect(needsTerminalWin({trainingGoal:{kind:"endgame_win"} as never})).toBe(true);
    expect(needsTerminalWin({trainingGoal:{kind:"gain_material"} as never})).toBe(false);
    expect(terminalWin({startingFen:"9 w"},state)).toBe(false);
    expect(terminalWin({startingFen:"9 w"},{...state,status:"将死"})).toBe(true);
    expect(terminalWin({startingFen:"9 b"},{...state,status:"困毙"})).toBe(false);
    expect(terminalWin({startingFen:"9 b"},{...state,fen:state.fen.replace(" b "," w "),status:"困毙"})).toBe(true);
  });
});

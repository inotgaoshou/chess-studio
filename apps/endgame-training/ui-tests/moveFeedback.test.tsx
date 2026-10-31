import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { Board } from "../src/App";
import { cancelTrainingFeedback, playTrainingFeedback, prepareTrainingFeedbackAudio, replayTrainingFeedbackEvent, trainingFeedbackEvent, TRAINING_FEEDBACK_PACK, FEEDBACK_DURATION, unlockTrainingFeedbackAudio } from "../src/moveFeedback";
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
  it("anchors capture feedback and the fading captured piece to the actual destination",()=>{
    vi.useFakeTimers();
    const captured:BoardPiece={row:1,col:4,color:"black",kind:"pawn",label:"卒"};
    const event=trainingFeedbackEvent([piece,captured],{...state,status:"正常"},"c9e8");
    expect(event.kind).toBe("capture");
    expect(event.captured).toEqual(captured);
    const props={pieces:state.pieces,lastMove:"c9e8",feedback:event.kind,feedbackEvent:event,boardSkin:"classic",pieceSkin:"classic",riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:false,onSquare:vi.fn()};
    const ui=render(<Board {...props}/>);
    const target=ui.container.querySelector('.board-square[aria-label="e8 红马"]') as HTMLElement;
    const shadow=ui.container.querySelector('.board-captured-piece') as HTMLElement;
    const notice=ui.container.querySelector('.capture-feedback') as HTMLElement;
    expect(shadow.style.getPropertyValue("--piece-left")).toBe(target.style.getPropertyValue("--piece-left"));
    expect(shadow.style.getPropertyValue("--piece-top")).toBe(target.style.getPropertyValue("--piece-top"));
    expect(notice.style.getPropertyValue("--feedback-x")).toBe(target.style.getPropertyValue("--piece-left"));
    expect(notice.style.getPropertyValue("--feedback-y")).toBe(target.style.getPropertyValue("--piece-top"));
    act(()=>vi.advanceTimersByTime(180));
    expect(ui.container.querySelector('.board-captured-piece')).toBeNull();
    ui.rerender(<Board {...props} lastMove="e8c7" feedback="move" feedbackEvent={{...event,id:event.id+1,kind:"move",iccs:"e8c7",captured:undefined}}/>);
    expect((ui.container.querySelector('.capture-feedback') as HTMLElement).style.getPropertyValue("--feedback-y")).toBe(target.style.getPropertyValue("--piece-top"));
  });
  it("replays feedback for one forward step, but not for backward or skipped moves",()=>{
    const captured:BoardPiece={row:1,col:4,color:"black",kind:"pawn",label:"卒"};
    const after={...state,status:"困毙"};
    const forward=replayTrainingFeedbackEvent([piece,captured],after,["c9e8"],0,1);
    expect(forward).toMatchObject({kind:"stalemate",iccs:"c9e8",captured});
    expect(replayTrainingFeedbackEvent([piece,captured],after,["c9e8"],1,0)).toBeUndefined();
    expect(replayTrainingFeedbackEvent([piece,captured],after,["c9e8","e8c7"],0,2)).toBeUndefined();
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
  it("plays only the latest move after an initially blocked clip finishes decoding",async()=>{
    const resolveBuffers:Array<(value:AudioBuffer)=>void>=[];
    const start=vi.fn();
    const context={state:"suspended",destination:{},resume:vi.fn(async()=>{context.state="running";}),decodeAudioData:vi.fn(()=>new Promise<AudioBuffer>(resolve=>resolveBuffers.push(resolve))),createBufferSource:vi.fn(()=>({buffer:undefined,connect:vi.fn(),disconnect:vi.fn(),stop:vi.fn(),start,onended:null})),createGain:vi.fn(()=>({gain:{value:0},connect:vi.fn()}))};
    vi.stubGlobal("AudioContext",class {constructor(){return context;}});
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));
    vi.stubGlobal("Audio",class {currentTime=0;volume=0;preload="";pause=vi.fn();play=vi.fn(()=>Promise.reject(Error("blocked")));constructor(public src:string){}});
    prepareTrainingFeedbackAudio();
    await vi.waitFor(()=>expect(resolveBuffers).toHaveLength(5));
    unlockTrainingFeedbackAudio();
    await context.resume.mock.results[0]?.value;
    playTrainingFeedback("capture");
    playTrainingFeedback("move");
    resolveBuffers.forEach(resolve=>resolve({} as AudioBuffer));
    await vi.waitFor(()=>expect(start).toHaveBeenCalledTimes(1));
  });
});

it("renders a numbered arrowhead for every saved branch independently of AI hints",()=>{
  const moves=["b0c2","h0g2","a3a4","c3c4","e3e4","g3g4"];
  const ui=render(<Board pieces={[]} branchMoves={moves} analysisMoves={[]} boardSkin="classic" pieceSkin="classic" riverText="" riverTextColor="#000" riverTextSize={20} supportsCustomRiverText={false} onSquare={vi.fn()}/>);
  const arrows=[...ui.container.querySelectorAll('.saved-branch-arrow')];
  expect(arrows).toHaveLength(moves.length);
  expect(arrows.map(arrow=>arrow.querySelector('text')?.textContent)).toEqual(['1','2','3','4','5','6']);
  for(const arrow of arrows){
    const ref=arrow.querySelector('.analysis-arrow-stem')!.getAttribute('marker-end')!;
    expect([...ui.container.querySelectorAll('marker')].some(marker=>ref===`url(#${marker.id})`)).toBe(true);
  }
});

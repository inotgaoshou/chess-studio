import { useId, type CSSProperties } from "react";
import { captureLabel, captureVariant, TRAINING_FEEDBACK_PACK, type TrainingFeedbackEvent, type TrainingFeedbackKind } from "./moveFeedback";
import "./feedbackSeal.css";

/** Decorative overlays only: the actual board, move tree and touch targets stay fixed. */
export function FeedbackSeal({kind,event,style}:{kind:Exclude<TrainingFeedbackKind,"move">;event?:TrainingFeedbackEvent;style?:CSSProperties}) {
  const id=useId().replace(/:/g,"");
  const capture=kind==="capture", variant=captureVariant(event), terminal=kind==="checkmate"||kind==="stalemate";
  const label=capture?captureLabel(event):TRAINING_FEEDBACK_PACK.labels[kind];
  const center=!capture||variant!=="ordinary";
  return <span className={`board-event-seal ${capture?"capture-feedback":"ink-feedback"} ${kind} capture-${variant} ${center?"feedback-center":""} ${terminal?"feedback-terminal":""}`} style={style} role="status" aria-label={label}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-smoke`}><stop stopColor="#211a14" stopOpacity=".85"/><stop offset=".55" stopColor="#30261d" stopOpacity=".5"/><stop offset="1" stopColor="#30261d" stopOpacity="0"/></radialGradient>
        <radialGradient id={`${id}-ink`} cx="40%" cy="30%"><stop stopColor="#c12713"/><stop offset=".65" stopColor="#92140c"/><stop offset="1" stopColor="#5b100c"/></radialGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fffbe2"/><stop offset=".4" stopColor="#fff0a9"/><stop offset="1" stopColor="#efac32"/></linearGradient>
        <radialGradient id={`${id}-flare`}><stop stopColor="#fffde4"/><stop offset=".22" stopColor="#ffe480" stopOpacity=".95"/><stop offset=".6" stopColor="#ff9a1e" stopOpacity=".42"/><stop offset="1" stopColor="#ff7810" stopOpacity="0"/></radialGradient>
      </defs>
      <g className="feedback-smoke"><circle cx="100" cy="100" r="82" fill={`url(#${id}-smoke)`}/></g>
      <g className="feedback-medallion">
        <path fill={`url(#${id}-ink)`} d="M102 17L117 20 128 16 138 27 151 29 157 42 172 49 173 62 183 77 179 91 184 103 179 116 181 130 168 139 163 154 149 158 137 171 123 172 108 183 96 177 80 181 68 172 53 169 47 155 33 146 31 132 20 119 24 106 18 89 24 76 24 61 37 53 43 39 58 34 67 23 83 25 93 17Z"/>
        <g fill="none" stroke="#a81e11" strokeWidth="3" strokeLinecap="round"><path d="M30 73C47 22 117 4 161 43M25 134C53 188 133 199 174 146M58 25l-12 13M145 173l18-10"/><path d="M23 87C15 113 28 144 46 158M173 53c14 18 17 44 11 66" strokeWidth="2"/></g>
        <g fill="#b62d17"><path d="M29 143l-13 15 20-9M158 33l16-11-8 20M55 174l-8 12 17-8"/><circle cx="22" cy="70" r="2"/><circle cx="178" cy="140" r="2"/></g>
      </g>
      <g className="feedback-flare"><circle cx="100" cy="100" r="98" fill={`url(#${id}-flare)`}/><path d="M100 4L106 88 190 100 106 109 100 194 93 110 9 100 93 91Z" fill="#fff2ab"/><circle cx="100" cy="100" r="67" fill="none" stroke="#ffdb74" strokeWidth="2"/></g>
      {terminal&&<g className="feedback-slash"><path d="M-30 117L224 71 48 116 226 94 15 136 180 104Z" fill="#a1190d"/><path d="M-30 103L224 72" stroke="#fff3ae" strokeWidth="5"/><path d="M-30 112L213 83" stroke="#e95922" strokeWidth="3"/></g>}
      <g className="feedback-lettering" fill={`url(#${id}-gold)`} stroke="#a73418" strokeWidth="1.6" paintOrder="stroke fill" textAnchor="middle">
        {terminal?<><text x="65" y="107" fontSize="99">{kind==="checkmate"?"绝":"困"}</text><text x="134" y="148" fontSize="99">{kind==="checkmate"?"杀":"毙"}</text></>:<text x="100" y="128" fontSize={label.length===1?120:76}>{label}</text>}
      </g>
    </svg>
  </span>;
}

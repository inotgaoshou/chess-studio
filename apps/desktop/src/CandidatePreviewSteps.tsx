import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { PreviewLineStep } from "./platform";

type Props = {
  activeStep: number;
  onSelect: (step: number) => void;
  steps: PreviewLineStep[];
};

export function CandidatePreviewSteps({ activeStep, onSelect, steps }: Props) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    buttons.current[activeStep]?.scrollIntoView?.({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeStep, steps]);

  return <div className="candidate-preview-steps" aria-label="候选推演步骤">
    {steps.map((step, index) => {
      const side = step.movedBy === "红方" ? "red" : "black";
      return <button
        ref={(element) => { buttons.current[index] = element; }}
        key={`${index}-${step.notation}-${step.fen}`}
        type="button"
        className={`${index === activeStep ? "active" : ""} side-${side}`.trim()}
        aria-current={index === activeStep ? "step" : undefined}
        aria-label={`第 ${index + 1} 步，${step.movedBy}，${step.notation}`}
        onClick={() => onSelect(index)}
        title={`${index + 1}. ${step.movedBy} ${step.notation}`}
      >
        <span className="preview-step-number">{index + 1}</span>
        <i className={`preview-step-side ${side}`}>{side === "red" ? "红" : "黑"}</i>
        <small>{step.notation}</small>
        {index === activeStep && <span className="preview-step-active-mark" aria-hidden="true"><Check size={13}/></span>}
      </button>;
    })}
  </div>;
}

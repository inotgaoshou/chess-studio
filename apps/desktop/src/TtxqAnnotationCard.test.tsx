import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtxqAnnotationCard } from "./TtxqAnnotationCard";

afterEach(cleanup);

describe("TtxqAnnotationCard", () => {
  it("does not present an importer route label as a local annotation", () => {
    render(<TtxqAnnotationCard value="天天象棋路线 3" editable onSaveLocal={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "本地备注" })).toBeNull();
    expect(screen.queryByText("天天象棋路线 3")).toBeNull();
  });

  it("keeps a route label out of the editable area beside a managed source block", async () => {
    render(<TtxqAnnotationCard value={["天天象棋路线 3", "【天天象棋注解】", "作者 · 23-08-17 15:01", "分支说明", "【天天象棋注解结束】"].join("\n")} editable onSaveLocal={vi.fn()} />);
    const card = screen.getByRole("region", { name: "天天象棋注解" });
    await userEvent.click(within(card).getByRole("button", { name: "编辑本地备注" }));
    expect((within(card).getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(within(card).queryByText("天天象棋路线 3")).toBeNull();
  });

  it("can collapse a long source annotation without losing its heading", async () => {
    render(<TtxqAnnotationCard value={["【天天象棋注解】", "作者 · 23-08-17 15:01", "第一步", "【天天象棋注解结束】"].join("\n")} />);
    const card = screen.getByLabelText("天天象棋注解");
    await userEvent.click(within(card).getByRole("button", { name: "收起天天象棋注解" }));
    expect(within(card).queryByText("第一步")).toBeNull();
    expect(within(card).getByText("天天象棋注解")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "展开天天象棋注解" }));
    expect(within(card).getByText("第一步")).toBeTruthy();
  });

  it("renders each imported timestamp as a separate annotation entry", () => {
    render(<TtxqAnnotationCard value={["【天天象棋注解】", "作者 · 23-08-17 15:01", "第一步", "作者 · 23-08-17 15:02", "第二步", "【天天象棋注解结束】"].join("\n")} />);
    expect(screen.getAllByText("作者 · 23-08-17 15:01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("作者 · 23-08-17 15:02").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("第一步")).toBeTruthy();
    expect(screen.getByText("第二步")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("keeps a byline-shaped sentence inside a delimited annotation", () => {
    render(<TtxqAnnotationCard value={[
      "【天天象棋注解】",
      "【天天象棋注解条目】",
      "作者 · 23-08-17 15:01",
      "正文中的作者 · 23-08-17 15:02 不应开启新条目",
      "【天天象棋注解条目结束】",
      "【天天象棋注解结束】",
    ].join("\n")} />);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("正文中的作者 · 23-08-17 15:02 不应开启新条目")).toBeTruthy();
  });
});

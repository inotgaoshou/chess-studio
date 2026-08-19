import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileManualRoute } from "./MobileManualRoute";
import type { ManualTreeNode, MoveItem, Side } from "./platform";

function move(id: string, notation: string, movedBy: Side, isMainline = false): MoveItem {
  return { id, notation, movedBy, isMainline, iccs: "a0a1", from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, comment: "" };
}

afterEach(cleanup);

describe("MobileManualRoute", () => {
  it("opens a branch menu and navigates to the selected letter", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const black = move("b1", "马8进7", "黑方", true);
    const a = move("a", "马八进七", "红方", true);
    const b = move("b", "马二进三", "红方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: black, children: [{ move: a, children: [] }, { move: b, children: [] }] }] }];
    const onNavigate = vi.fn();
    render(<MobileManualRoute nodes={tree} history={[red, black, b]} currentNode="b" onNavigate={onNavigate} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "2B 变招" }));
    expect(screen.getByRole("dialog", { name: "变招选择" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "A.马八进七" }));
    expect(onNavigate).toHaveBeenCalledWith("a");
  });

  it("closes the branch menu with Escape and restores focus to its trigger", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马八进七", "黑方", true);
    const b = move("b", "马2进3", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    render(<MobileManualRoute nodes={tree} history={[red, b]} currentNode="b" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);
    const trigger = screen.getByRole("button", { name: "2B 变招" });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "变招选择" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the branch menu when the user taps outside it", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马8进7", "黑方", true);
    const b = move("b", "马2进3", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    render(<MobileManualRoute nodes={tree} history={[red, b]} currentNode="b" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "2B 变招" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "变招选择" })).toBeNull();
  });

  it("shows the opening header and saves, switches, and deletes the selected variation", async () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马8进7", "黑方", true);
    const b = { ...move("b", "马2进3", "黑方"), comment: "已有注释" };
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    const onNavigate = vi.fn();
    const onSaveComment = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(false);
    render(<MobileManualRoute nodes={tree} history={[red, b]} currentNode="b" onNavigate={onNavigate} onSaveComment={onSaveComment} onDelete={onDelete}/>);

    expect(screen.getByText("==开局==")).toBeTruthy();
    expect((screen.getByLabelText("当前变招注释") as HTMLTextAreaElement).value).toBe("已有注释");
    expect(screen.getByRole("button", { name: "下移变招" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("当前变招注释"), { target: { value: "更新注释" } });
    expect(screen.getByText("即将自动保存")).toBeTruthy();
    await waitFor(() => expect(onSaveComment).toHaveBeenCalledWith("b", "更新注释"), { timeout: 900 });
    await waitFor(() => expect(screen.getByText("已自动保存")).toBeTruthy());
    const moveUp = screen.getByRole("button", { name: "上移变招" });
    await waitFor(() => expect(moveUp.hasAttribute("disabled")).toBe(false));
    fireEvent.click(moveUp);
    expect(onNavigate).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "当前变招" }));
    fireEvent.click(screen.getByRole("option", { name: "A.马8进7" }));
    expect(onNavigate).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "删除当前分支" }));
    expect(screen.getByRole("alertdialog", { name: "删除该分支及后续着法？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除分支" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("b"));
  });

  it("shows a saved annotation beside its move", () => {
    const red = { ...move("r1", "炮二平五", "红方", true), comment: "抢占中路" };
    render(<MobileManualRoute nodes={[{ move: red, children: [] }]} history={[red]} currentNode="r1" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);

    expect(document.querySelector(".mobile-manual-route-comment")?.textContent).toBe("抢占中路");
  });

  it("uses the down arrow to navigate to the next sibling branch without reordering", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马8进7", "黑方", true);
    const b = move("b", "马2进3", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    const onNavigate = vi.fn();
    render(<MobileManualRoute nodes={tree} history={[red, a]} currentNode="a" onNavigate={onNavigate} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);

    expect(screen.getByRole("button", { name: "上移变招" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "下移变招" }));
    expect(onNavigate).toHaveBeenCalledWith("b");
  });

  it("closes the branch deletion dialog when the user chooses no", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马8进7", "黑方", true);
    const b = move("b", "马2进3", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    const onDelete = vi.fn();
    render(<MobileManualRoute nodes={tree} history={[red, b]} currentNode="b" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={onDelete}/>);

    fireEvent.click(screen.getByRole("button", { name: "删除当前分支" }));
    fireEvent.click(screen.getByRole("button", { name: "取消删除分支" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("allows an explicitly confirmed deletion from a linear score", async () => {
    const red = move("r1", "炮二平五", "红方", true);
    const onDelete = vi.fn().mockResolvedValue(true);
    render(<MobileManualRoute nodes={[{ move: red, children: [] }]} history={[red]} currentNode="r1" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={onDelete}/>);

    expect(screen.getByRole("button", { name: "删除当前分支" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "删除当前分支" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除分支" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("r1"));
  });

  it("shows an autosave failure instead of claiming the comment was saved", async () => {
    const red = move("r1", "炮二平五", "红方", true);
    const onSaveComment = vi.fn().mockResolvedValue(false);
    render(<MobileManualRoute nodes={[{ move: red, children: [] }]} history={[red]} currentNode="r1" onNavigate={vi.fn()} onSaveComment={onSaveComment} onDelete={vi.fn()}/>);

    fireEvent.change(screen.getByLabelText("当前变招注释"), { target: { value: "需要复查" } });
    await waitFor(() => expect(onSaveComment).toHaveBeenCalledWith("r1", "需要复查"), { timeout: 900 });
    expect(screen.getByText("保存失败，请继续编辑重试")).toBeTruthy();
  });

  it("keeps the continuation visible and navigable after going back", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const black = move("b1", "马8进7", "黑方", true);
    const red2 = move("r2", "马二进三", "红方", true);
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: black, children: [{ move: red2, children: [] }] }] }];
    const onNavigate = vi.fn();
    const { container } = render(<MobileManualRoute nodes={tree} history={[red]} continuation={[black, red2]} currentNode="r1" onNavigate={onNavigate} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);

    expect(container.querySelectorAll(".mobile-manual-route-cell.continuation")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "马8进7" }));
    expect(onNavigate).toHaveBeenCalledWith("b1");
  });

  it("keeps the custom variation picker inside the editor and closes it with Escape", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马8进7", "黑方", true);
    const b = move("b", "马2进3", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    render(<MobileManualRoute nodes={tree} history={[red, b]} currentNode="b" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);

    fireEvent.click(screen.getByRole("button", { name: "当前变招" }));
    expect(screen.getByRole("listbox", { name: "当前变招选择" }).closest(".mobile-manual-variation-editor")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "当前变招选择" })).toBeNull();
  });

  it("places variation actions before the selector", () => {
    const red = move("r1", "炮二平五", "红方", true);
    const a = move("a", "马8进7", "黑方", true);
    const b = move("b", "马2进3", "黑方");
    const tree: ManualTreeNode[] = [{ move: red, children: [{ move: a, children: [] }, { move: b, children: [] }] }];
    render(<MobileManualRoute nodes={tree} history={[red, b]} currentNode="b" onNavigate={vi.fn()} onSaveComment={vi.fn()} onDelete={vi.fn()}/>);

    const actions = screen.getByRole("group", { name: "变招操作" });
    const selector = screen.getByRole("button", { name: "当前变招" });
    expect(actions.compareDocumentPosition(selector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

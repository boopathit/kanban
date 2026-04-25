import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData } from "@/lib/kanban";
import type { BoardActions } from "@/lib/useBoard";

const FIXTURE: BoardData = {
  columns: [
    { id: "col-a", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "Done", cardIds: [] },
  ],
  cards: {
    "card-1": { id: "card-1", title: "First", details: "first details" },
    "card-2": { id: "card-2", title: "Second", details: "second details" },
  },
};

const stubActions = (overrides: Partial<BoardActions> = {}): BoardActions => ({
  renameColumn: vi.fn().mockResolvedValue(undefined),
  createCard: vi.fn().mockResolvedValue(undefined),
  moveCard: vi.fn().mockResolvedValue(undefined),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const renderBoard = (props: Partial<React.ComponentProps<typeof KanbanBoard>> = {}) => {
  const actions = props.actions ?? stubActions();
  const utils = render(
    <KanbanBoard
      board={FIXTURE}
      loading={false}
      error={null}
      actions={actions}
      {...props}
    />
  );
  return { ...utils, actions };
};

describe("KanbanBoard", () => {
  it("renders the loading placeholder while loading", () => {
    render(
      <KanbanBoard
        board={null}
        loading={true}
        error={null}
        actions={stubActions()}
      />
    );
    expect(screen.getByTestId("board-loading")).toBeInTheDocument();
  });

  it("also renders the loading placeholder when board is null", () => {
    render(
      <KanbanBoard
        board={null}
        loading={false}
        error={null}
        actions={stubActions()}
      />
    );
    expect(screen.getByTestId("board-loading")).toBeInTheDocument();
  });

  it("renders one column per board.columns entry", () => {
    renderBoard();
    expect(screen.getAllByTestId(/^column-/i)).toHaveLength(2);
  });

  it("forwards rename keystrokes to actions.renameColumn", async () => {
    const { actions } = renderBoard();
    const column = screen.getAllByTestId(/^column-/i)[0];
    const input = within(column).getByLabelText("Column title");
    // The parent owns state in real usage; here we just check the prop is wired.
    await userEvent.type(input, "X");
    expect(actions.renameColumn).toHaveBeenCalled();
    const lastCall =
      (actions.renameColumn as ReturnType<typeof vi.fn>).mock.calls.at(-1) ?? [];
    expect(lastCall[0]).toBe("col-a");
    expect(typeof lastCall[1]).toBe("string");
  });

  it("submitting the new card form calls actions.createCard", async () => {
    const { actions } = renderBoard();
    const column = screen.getAllByTestId(/^column-/i)[0];
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "New card");
    await userEvent.type(within(column).getByPlaceholderText(/details/i), "Notes");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    expect(actions.createCard).toHaveBeenCalledWith("col-a", "New card", "Notes");
  });

  it("clicking remove forwards to actions.deleteCard with just the card id", async () => {
    const { actions } = renderBoard();
    const column = screen.getAllByTestId(/^column-/i)[0];
    await userEvent.click(
      within(column).getByRole("button", { name: /delete first/i })
    );
    expect(actions.deleteCard).toHaveBeenCalledWith("card-1");
  });

  it("renders the error toast when an error is provided and dismiss invokes the callback", async () => {
    const onDismiss = vi.fn();
    render(
      <KanbanBoard
        board={FIXTURE}
        loading={false}
        error="Something broke"
        onDismissError={onDismiss}
        actions={stubActions()}
      />
    );
    const toast = screen.getByTestId("board-error-toast");
    expect(toast).toHaveTextContent("Something broke");
    await userEvent.click(within(toast).getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides the logout button when no onLogout prop is provided", () => {
    renderBoard();
    expect(screen.queryByTestId("logout-button")).not.toBeInTheDocument();
  });

  it("renders a logout button that calls onLogout when clicked", async () => {
    const onLogout = vi.fn();
    renderBoard({ onLogout });
    const button = screen.getByTestId("logout-button");
    expect(button).toHaveTextContent(/log out/i);
    await userEvent.click(button);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

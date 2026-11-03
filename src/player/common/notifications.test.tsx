import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Notification, NotificationProvider, useNotify } from "./notifications";

function Sender({ notifications }: { notifications: Notification[] }) {
  const notify = useNotify();
  return (
    <button type="button" onClick={() => notifications.forEach(notify)}>
      Send
    </button>
  );
}

describe("NotificationProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["success", "info"] as const)(
    "announces a %s message politely as a status",
    (severity) => {
      render(
        <NotificationProvider>
          <Sender notifications={[{ severity, message: "Added 3 tracks." }]} />
        </NotificationProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(screen.getByRole("status")).toHaveTextContent("Added 3 tracks.");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  );

  it.each(["warning", "error"] as const)(
    "announces a %s message as an alert",
    (severity) => {
      render(
        <NotificationProvider>
          <Sender notifications={[{ severity, message: "Couldn't read 2 files." }]} />
        </NotificationProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read 2 files.");
    }
  );

  it.each(["warning", "error"] as const)(
    "keeps a %s message up until it is closed (WCAG 2.2.1)",
    (severity) => {
      render(
        <NotificationProvider>
          <Sender notifications={[{ severity, message: "Couldn't read 2 files." }]} />
        </NotificationProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      act(() => {
        vi.advanceTimersByTime(10 * 60 * 1000);
      });
      act(() => {
        vi.runAllTimers();
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read 2 files.");
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    }
  );

  it.each(["success", "info"] as const)("hides a %s message by itself", (severity) => {
    render(
      <NotificationProvider>
        <Sender notifications={[{ severity, message: "Added 3 tracks." }]} />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can be dismissed with an accessible close button", () => {
    render(
      <NotificationProvider>
        <Sender notifications={[{ severity: "error", message: "Couldn't read the folder." }]} />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows queued messages one after another", () => {
    render(
      <NotificationProvider>
        <Sender
          notifications={[
            { severity: "success", message: "First" },
            { severity: "info", message: "Second" },
          ]}
        />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("status")).toHaveTextContent("First");
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Second");
  });

  it("logs instead of failing when there is no provider", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    render(<Sender notifications={[{ severity: "info", message: "Hello" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(info).toHaveBeenCalledWith("Hello");
  });
});

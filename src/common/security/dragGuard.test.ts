// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installDocumentDropGuard } from "./dragGuard";

function fire(target: EventTarget, type: string, types: string[] = []) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  target.dispatchEvent(event);
  return event;
}

let remove: (() => void) | undefined;
afterEach(() => {
  remove?.();
  document.body.innerHTML = "";
});

describe("installDocumentDropGuard (SEC-7)", () => {
  it("cancels file drags and drops that reach the document", () => {
    remove = installDocumentDropGuard(document);
    expect(fire(document.body, "dragover", ["Files"]).defaultPrevented).toBe(true);
    expect(fire(document.body, "drop", ["Files"]).defaultPrevented).toBe(true);
  });

  it("cancels dropped links outside text fields", () => {
    remove = installDocumentDropGuard(document);
    expect(fire(document.body, "drop", ["text/uri-list"]).defaultPrevented).toBe(true);
  });

  it("lets text be dropped into a text field", () => {
    remove = installDocumentDropGuard(document);
    const input = document.createElement("input");
    document.body.append(input);
    expect(fire(input, "drop", ["text/plain"]).defaultPrevented).toBe(false);
  });

  it("still cancels a file dropped onto a text field", () => {
    remove = installDocumentDropGuard(document);
    const input = document.createElement("textarea");
    document.body.append(input);
    expect(fire(input, "drop", ["Files"]).defaultPrevented).toBe(true);
  });

  it("does not stop drop zones that handle the event first", () => {
    remove = installDocumentDropGuard(document);
    const zone = document.createElement("div");
    document.body.append(zone);
    let received = false;
    zone.addEventListener("drop", (event) => {
      received = true;
      event.stopPropagation();
    });
    fire(zone, "drop", ["Files"]);
    expect(received).toBe(true);
  });

  it("leaves other events alone", () => {
    remove = installDocumentDropGuard(document);
    expect(fire(document.body, "click").defaultPrevented).toBe(false);
  });

  it("can be removed", () => {
    installDocumentDropGuard(document)();
    expect(fire(document.body, "drop", ["Files"]).defaultPrevented).toBe(false);
  });
});

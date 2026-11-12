// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installDocumentDropGuard } from "./dragGuard";

function fire(target: EventTarget, type: string, types: string[] = []) {
  const event = new Event(type, { cancelable: true, bubbles: true });
  const dataTransfer = { types, dropEffect: "copy" };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(event);
  return Object.assign(event, { dropEffect: () => dataTransfer.dropEffect });
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

  it("shows the no-drop cursor for a file dragged outside a drop zone", () => {
    remove = installDocumentDropGuard(document);
    expect(fire(document.body, "dragover", ["Files"]).dropEffect()).toBe("none");
  });

  it("leaves the drop effect a drop zone chose, so the browser drops there (w51-fix2: Library drops did nothing)", () => {
    remove = installDocumentDropGuard(document);
    const zone = document.createElement("div");
    document.body.append(zone);
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      (event as DragEvent).dataTransfer!.dropEffect = "copy";
    });
    const over = fire(zone, "dragover", ["Files"]);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dropEffect()).toBe("copy");
  });

  it("lets a link be dropped into a text field as text", () => {
    remove = installDocumentDropGuard(document);
    const input = document.createElement("input");
    document.body.append(input);
    const types = ["text/uri-list", "text/plain"];
    const over = fire(input, "dragover", types);
    expect(over.defaultPrevented).toBe(false);
    expect(over.dropEffect()).toBe("copy");
    expect(fire(input, "drop", types).defaultPrevented).toBe(false);
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

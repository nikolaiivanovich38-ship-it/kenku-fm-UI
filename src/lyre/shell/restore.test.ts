import { afterEach, describe, expect, it } from "vitest";

import { controlKey, findControl, scrollKey, scrollsOf, findScroller } from "./restore";

function view(html: string): HTMLElement {
  const v = document.createElement("main");
  v.id = "view";
  v.innerHTML = html;
  document.body.appendChild(v);
  return v;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("finding the control used to leave again (UX-18)", () => {
  it("names a control by its kind, its name and which of the same it is, and finds it in a new drawing", () => {
    const v = view('<a href="#/playlist/a">Ashen King</a><a href="#/playlist/b">The Abbess</a><button aria-label="Preview The Abbess">p</button><a href="#/playlist/a">Ashen King</a>');
    const second = v.querySelectorAll("a")[2];
    const key = controlKey(second, v);
    expect(key).toBe("a|Ashen King|1");
    v.innerHTML = '<p>loading</p><a href="#/playlist/a">Ashen King</a><a href="#/playlist/b">The Abbess</a><a href="#/playlist/a">Ashen King</a>';
    expect(findControl(key, v)).toBe(v.querySelectorAll("a")[2]);
  });

  it("prefers an element's data-k or id, which stay the same however the screen is drawn", () => {
    const v = view('<button data-k="nav-x">Go</button><input id="cp-c-notes">');
    expect(controlKey(v.querySelector("button")!, v)).toBe("k:nav-x");
    expect(controlKey(v.querySelector("input")!, v)).toBe("id:cp-c-notes");
    expect(findControl("id:cp-c-notes", v)).toBe(v.querySelector("input"));
    expect(findControl("k:nav-x", v)).toBe(v.querySelector("button"));
  });

  it("finds nothing for a control that is not there (yet), or no key", () => {
    const v = view("<p>loading</p>");
    expect(findControl("a|Ashen King|0", v)).toBeNull();
    expect(findControl("", v)).toBeNull();
  });
});

describe("keeping scroll positions (UX-18)", () => {
  it("keys a scrolling box by its data-scroll, else by where it sits in the work area", () => {
    const v = view('<div class="viewbody"><div class="a"></div><div class="b" data-scroll="scenes"></div></div>');
    expect(scrollKey(v.querySelector(".b")!, v)).toBe("scenes");
    expect(scrollKey(v.querySelector(".a")!, v)).toBe("div:0/div:0");
    expect(scrollKey(v, v)).toBe("view");
    expect(findScroller("div:0/div:0", v)).toBe(v.querySelector(".a"));
    expect(findScroller("scenes", v)).toBe(v.querySelector(".b"));
    expect(findScroller("view", v)).toBe(v);
  });

  it("lists only the boxes that are scrolled", () => {
    const v = view('<div class="viewbody"></div><div class="other"></div>');
    const body = v.querySelector<HTMLElement>(".viewbody")!;
    Object.defineProperty(body, "scrollTop", { value: 400, configurable: true });
    expect(scrollsOf(v)).toEqual({ "div:0": 400 });
  });
});

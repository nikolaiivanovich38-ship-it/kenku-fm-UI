import { describe, expect, it } from "vitest";
import {
  argsMatch,
  isBoolean,
  isFiniteNumber,
  isIntegerIn,
  isOneOf,
  isStringUpTo,
  isWebContentsId,
  noArgs,
  optional,
} from "./ipcArgs";

describe("IPC argument checks (SEC-8)", () => {
  it("accepts web contents ids as safe integers only", () => {
    expect(isWebContentsId(1)).toBe(true);
    expect(isWebContentsId(-1)).toBe(true);
    for (const bad of [1.5, NaN, Infinity, "1", null, undefined, {}, 2 ** 60]) {
      expect(isWebContentsId(bad)).toBe(false);
    }
  });

  it("accepts finite numbers only", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(12.5)).toBe(true);
    for (const bad of [NaN, Infinity, -Infinity, "3", null, undefined]) {
      expect(isFiniteNumber(bad)).toBe(false);
    }
  });

  it("accepts booleans only", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
    for (const bad of [0, 1, "true", null, undefined]) {
      expect(isBoolean(bad)).toBe(false);
    }
  });

  it("limits string length", () => {
    const check = isStringUpTo(5);
    expect(check("")).toBe(true);
    expect(check("abcde")).toBe(true);
    expect(check("abcdef")).toBe(false);
    expect(check(5)).toBe(false);
    expect(check(["a"])).toBe(false);
  });

  it("limits integers to a range", () => {
    const check = isIntegerIn(1, 2);
    expect(check(1)).toBe(true);
    expect(check(2)).toBe(true);
    expect(check(0)).toBe(false);
    expect(check(1.5)).toBe(false);
    expect(check("1")).toBe(false);
  });

  it("accepts one of a fixed set of values", () => {
    const check = isOneOf("lowLatency", "performance");
    expect(check("performance")).toBe(true);
    expect(check("other")).toBe(false);
    expect(check(undefined)).toBe(false);
  });

  it("makes a check optional", () => {
    const check = optional(isBoolean);
    expect(check(undefined)).toBe(true);
    expect(check(true)).toBe(true);
    expect(check("yes")).toBe(false);
  });

  it("matches an argument list position by position and refuses extra arguments", () => {
    const check = argsMatch(isWebContentsId, isBoolean);
    expect(check([3, true])).toBe(true);
    expect(check([3])).toBe(false);
    expect(check(["3", true])).toBe(false);
    expect(check([3, true, "extra"])).toBe(false);
    expect(argsMatch(isWebContentsId, optional(isBoolean))([3])).toBe(true);
  });

  it("accepts no arguments for channels that take none", () => {
    expect(noArgs([])).toBe(true);
    expect(noArgs([1])).toBe(false);
  });
});

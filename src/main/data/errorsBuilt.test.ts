/**
 * The app's bundles are compiled with the project's TypeScript settings (ts-loader, tsconfig.json), which turn
 * classes into ES5 functions. There, a class that extends Error loses its prototype unless it sets it again, and
 * `instanceof` (how LyreApi tells a refusal from a bug) is always false. Tests run the source as it is written, so
 * this test compiles each such file as the app's bundles do and checks `instanceof` there.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");

function compiledAsInTheApp(file: string): Record<string, unknown> {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: options, fileName: file });
  const exports: Record<string, unknown> = {};
  const module = { exports };
  // Only the error classes are evaluated; their files import nothing at run time but each other's types.
  new Function("exports", "module", "require", outputText)(exports, module, (name: string) => {
    throw new Error(`unexpected import of ${name}`);
  });
  return module.exports;
}

type ErrorClass = new (...args: unknown[]) => Error;

describe("error classes keep instanceof in the app's ES5 bundles", () => {
  it.each([
    ["src/main/data/errors.ts", "ValidationError", ["title", "Type a title."]],
    ["src/main/data/errors.ts", "NotFoundError", ["track", "t1"]],
    ["src/main/data/errors.ts", "LibraryBusyError", ["Tag 5,000 tracks"]],
    ["src/main/data/errors.ts", "LibraryDatabaseError", ["corrupt", "Damaged."]],
    ["src/main/data/import/cancel.ts", "CancelledError", []],
    ["src/main/lyreApi/refused.ts", "Refused", ["invalid", "There is no such tag group.", "group"]],
  ] as const)("%s %s", (file, name, args) => {
    const Class = compiledAsInTheApp(file)[name] as ErrorClass;
    const error = new Class(...args);
    expect(error).toBeInstanceOf(Class);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toBe("");
  });
});

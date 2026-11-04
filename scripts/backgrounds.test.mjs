// Tests for the background picture generator (scripts/backgrounds). The
// pictures themselves are checked in src/player/backgrounds/index.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAMES, SCENES, hashName, makeNoise, mulberry32 } from "./backgrounds/paint.mjs";

test("paints exactly Kenku FM's 23 background names, spelling included", () => {
  assert.deepEqual(NAMES, [
    "autumn", "beach", "butterflys", "castle", "cathedral", "dragon", "haunted", "lines",
    "mountain", "sand", "skulls", "sky", "smoke", "sparks", "stars", "tavern", "texture",
    "town", "tree", "veins", "volcano", "war", "winter",
  ]);
  assert.deepEqual(Object.keys(SCENES).sort(), [...NAMES].sort());
});

test("random numbers repeat for the same seed, so rebuilding gives the same pictures", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const first = Array.from({ length: 5 }, a);
  assert.deepEqual(first, Array.from({ length: 5 }, b));
  assert.ok(first.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(first, Array.from({ length: 5 }, mulberry32(43)));
});

test("noise is the same for the same seed and differs between pictures", () => {
  const one = makeNoise(mulberry32(hashName("tavern")));
  const two = makeNoise(mulberry32(hashName("tavern")));
  const other = makeNoise(mulberry32(hashName("stars")));
  const points = [[0.5, 0.25], [12.3, 4.56], [100.1, 7.7]];
  for (const [x, y] of points) {
    assert.equal(one.fbm(x, y), two.fbm(x, y));
    assert.ok(Math.abs(one.noise(x, y)) <= 1);
  }
  assert.notDeepEqual(
    points.map(([x, y]) => one.fbm(x, y)),
    points.map(([x, y]) => other.fbm(x, y)),
  );
  assert.notEqual(hashName("tavern"), hashName("stars"));
});

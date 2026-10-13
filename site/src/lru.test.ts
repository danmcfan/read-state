import { expect, test } from "bun:test";
import { write } from "./lru.ts";

test("a write to a cached key is a hit and moves it to the front", () => {
  expect(write(["c", "b", "a"], "a", 3)).toEqual({ order: ["a", "c", "b"], hit: true });
});

test("a new key goes in front and evicts the least recently used once full", () => {
  expect(write(["c", "b", "a"], "d", 3)).toEqual({ order: ["d", "c", "b"], hit: false, evicted: "a" });
});

test("a new key in a cache with room evicts nothing", () => {
  expect(write(["a"], "b", 3)).toEqual({ order: ["b", "a"], hit: false });
});

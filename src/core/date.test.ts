import test from "node:test";
import assert from "node:assert/strict";
import { assertDateString, today } from "./date.js";

test("today formats dates in JST rather than UTC", () => {
  assert.equal(today(new Date("2026-05-17T15:30:00.000Z")), "2026-05-18");
});

test("today can format another timezone when explicitly requested", () => {
  assert.equal(today(new Date("2026-05-17T15:30:00.000Z"), "UTC"), "2026-05-17");
});

test("assertDateString rejects non YYYY-MM-DD values", () => {
  assert.throws(() => assertDateString("2026/05/18"), /Invalid date/);
});


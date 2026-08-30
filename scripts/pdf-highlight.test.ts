import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMatrix,
  extractNameHighlights,
  IDENTITY,
  isHighlightColor,
  multiply,
  yOverlapsHighlight,
} from "./pdf-highlight.ts";
import { isDangerZone } from "../src/lib/format.ts";
import { qualifyFromHighlights } from "./qualify.ts";

test("isHighlightColor accepts rosa and magenta, rejects yellow white gray", () => {
  assert.equal(isHighlightColor("#f4cccc"), true);
  assert.equal(isHighlightColor("#ff00ff"), true);
  assert.equal(isHighlightColor("#ffff00"), false);
  assert.equal(isHighlightColor("#ffffff"), false);
  assert.equal(isHighlightColor("#000000"), false);
  assert.equal(isHighlightColor("#b7b7b7"), false);
  assert.equal(isHighlightColor("#ff0000"), false);
});

test("yOverlapsHighlight matches a couple row inside a name-column fill", () => {
  const rects = [{ x0: 50, y0: 80, x1: 400, y1: 120, color: "#f4cccc" }];
  assert.equal(yOverlapsHighlight(90, rects), true);
  assert.equal(yOverlapsHighlight(200, rects), false);
});

test("extractNameHighlights ignores right-side score-cell tints", () => {
  const ops = {
    setFillRGBColor: 1,
    constructPath: 2,
    transform: 3,
    save: 4,
    restore: 5,
  };
  const opList = {
    fnArray: [ops.setFillRGBColor, ops.constructPath, ops.setFillRGBColor, ops.constructPath],
    argsArray: [
      ["#ff00ff"],
      [22, [{ 0: 0 }], [791, 91, 968, 134]],
      ["#f4cccc"],
      [22, [{ 0: 0 }], [21, 91, 350, 134]],
    ],
  };
  const rects = extractNameHighlights(opList, ops);
  assert.equal(rects.length, 1);
  assert.equal(rects[0]!.color, "#f4cccc");
  assert.equal(rects[0]!.x0, 21);
});

test("qualifyFromHighlights uses min highlighted average as cutoff", () => {
  const rows = [
    { coupleId: 1, average: 8, highlighted: true },
    { coupleId: 2, average: 7.36, highlighted: true },
    { coupleId: 3, average: 7.2, highlighted: false },
  ];
  const q = qualifyFromHighlights(rows, (r) => r.highlighted);
  assert.equal(q.classifiedCount, 2);
  assert.equal(q.cutoff, 7.36);
  assert.equal(q.ranks.get(1), 1);
});

test("multiply then applyMatrix maps a flipped page transform", () => {
  const flip = multiply(IDENTITY, [1, 0, 0, -1, 0, 595]);
  const [x, y] = applyMatrix(flip, 50, 100);
  assert.equal(x, 50);
  assert.equal(y, 495);
});

test("isDangerZone uses classified count not half the field", () => {
  assert.equal(isDangerZone(30, true, 32), true);
  assert.equal(isDangerZone(10, true, 32), false);
  assert.equal(isDangerZone(34, false, 32), true);
  assert.equal(isDangerZone(80, false, 32), false);
});

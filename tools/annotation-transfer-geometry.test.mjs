import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRectToPage,
  computeTargetRect,
  normalizeGrabOffset,
} from "../assets/annotation-transfer-geometry.mjs";

const pageBounds = [0, 0, 600, 800];

function viewport(rotation, scale) {
  const [left, bottom, right, top] = pageBounds;
  const width = right - left;
  const height = top - bottom;
  const convert = (x, y) => {
    switch (rotation) {
      case 0:
        return [(x - left) * scale, (top - y) * scale];
      case 90:
        return [(y - bottom) * scale, (x - left) * scale];
      case 180:
        return [(right - x) * scale, (y - bottom) * scale];
      case 270:
        return [(top - y) * scale, (right - x) * scale];
      default:
        throw new Error(`Unsupported rotation: ${rotation}`);
    }
  };
  const invert = (x, y) => {
    switch (rotation) {
      case 0:
        return [x / scale + left, top - y / scale];
      case 90:
        return [y / scale + left, x / scale + bottom];
      case 180:
        return [right - x / scale, y / scale + bottom];
      case 270:
        return [right - y / scale, top - x / scale];
      default:
        throw new Error(`Unsupported rotation: ${rotation}`);
    }
  };
  return {
    convertToViewportPoint: convert,
    convertToPdfPoint: invert,
    displaySize:
      rotation % 180 === 0 ? [width * scale, height * scale] : [height * scale, width * scale],
  };
}

test("normalizes grab offsets", () => {
  assert.deepEqual(normalizeGrabOffset(undefined), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizeGrabOffset({ x: -1, y: 2 }), { x: 0, y: 1 });
});

test("clamps by repositioning without resizing", () => {
  assert.deepEqual(clampRectToPage([-20, 760, 80, 810], pageBounds), [0, 750, 100, 800]);
  assert.deepEqual(clampRectToPage([570, -10, 670, 40], pageBounds), [500, 0, 600, 50]);
});

for (const rotation of [0, 90, 180, 270]) {
  for (const scale of [0.5, 1, 2]) {
    test(`preserves PDF dimensions at ${rotation} degrees and ${scale}x zoom`, () => {
      const targetViewport = viewport(rotation, scale);
      const [displayWidth, displayHeight] = targetViewport.displaySize;
      const rect = computeTargetRect({
        sourceRect: [10, 20, 110, 70],
        pageBounds,
        viewport: targetViewport,
        pageClientRect: { left: 25, top: 40 },
        clientX: 25 + displayWidth / 2,
        clientY: 40 + displayHeight / 2,
        grabOffset: { x: 0.5, y: 0.5 },
      });
      assert.ok(rect);
      assert.ok(Math.abs(rect[2] - rect[0] - 100) < 1e-9);
      assert.ok(Math.abs(rect[3] - rect[1] - 50) < 1e-9);
    });
  }
}

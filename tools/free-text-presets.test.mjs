import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRESETS,
  normalizeFreeTextPresets,
  normalizePreset,
  stylesEqual,
} from "../assets/free-text-preset-model.mjs";

test("always returns exactly four presets", () => {
  assert.equal(normalizeFreeTextPresets([]).length, 4);
  assert.equal(normalizeFreeTextPresets([{}, {}, {}, {}, {}]).length, 4);
});

test("fills missing presets from defaults", () => {
  const presets = normalizeFreeTextPresets([{ name: "Query" }]);
  assert.equal(presets[0].name, "Query");
  assert.deepEqual(presets[1], DEFAULT_PRESETS[1]);
  assert.deepEqual(presets[3], DEFAULT_PRESETS[3]);
});

test("normalizes colors and preserves transparent fill", () => {
  const preset = normalizePreset(
    {
      name: "  Review  ",
      fontSize: 12,
      fontColor: "#ff0000",
      borderWidth: 0.5,
      borderColor: "#0066ff",
      backgroundColor: null,
    },
    DEFAULT_PRESETS[0],
  );
  assert.deepEqual(preset, {
    name: "Review",
    fontSize: 12,
    fontColor: "#FF0000",
    borderWidth: 0.5,
    borderColor: "#0066FF",
    backgroundColor: null,
  });
});

test("falls back invalid fields without rejecting the other fields", () => {
  const preset = normalizePreset(
    {
      name: "Valid name",
      fontSize: 101,
      fontColor: "red",
      borderWidth: -1,
      borderColor: "#abcdef",
      backgroundColor: "rgb(1, 2, 3)",
    },
    DEFAULT_PRESETS[3],
  );
  assert.equal(preset.name, "Valid name");
  assert.equal(preset.fontSize, DEFAULT_PRESETS[3].fontSize);
  assert.equal(preset.fontColor, DEFAULT_PRESETS[3].fontColor);
  assert.equal(preset.borderWidth, DEFAULT_PRESETS[3].borderWidth);
  assert.equal(preset.borderColor, "#ABCDEF");
  assert.equal(preset.backgroundColor, null);
});

test("active preset matching compares every PDF style property", () => {
  const base = DEFAULT_PRESETS[1];
  assert.equal(stylesEqual(base, { ...base }), true);
  for (const [key, value] of [
    ["fontSize", 11],
    ["fontColor", "#000000"],
    ["borderWidth", 2],
    ["borderColor", "#FF0000"],
    ["backgroundColor", null],
  ]) {
    assert.equal(stylesEqual(base, { ...base, [key]: value }), false, key);
  }
});

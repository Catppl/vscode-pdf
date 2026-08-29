export const PRESET_COUNT = 4;

const HEX_COLOR_PATTERN = /^#[\dA-F]{6}$/u;

export const DEFAULT_PRESETS = Object.freeze([
  Object.freeze({
    name: "Preset 1",
    fontSize: 10,
    fontColor: "#000000",
    borderWidth: 1,
    borderColor: "#FF0000",
    backgroundColor: "#FFFFFF",
  }),
  Object.freeze({
    name: "Preset 2",
    fontSize: 10,
    fontColor: "#FF0000",
    borderWidth: 1,
    borderColor: "#0066FF",
    backgroundColor: "#FFFF99",
  }),
  Object.freeze({
    name: "Preset 3",
    fontSize: 10,
    fontColor: "#0000FF",
    borderWidth: 1,
    borderColor: "#0000FF",
    backgroundColor: "#EAF3FF",
  }),
  Object.freeze({
    name: "Preset 4",
    fontSize: 10,
    fontColor: "#000000",
    borderWidth: 0,
    borderColor: "#000000",
    backgroundColor: null,
  }),
]);

export function normalizeColor(value, fallback) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizeNumber(value, fallback, minimum, maximum) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

export function normalizePreset(value, fallback) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const name =
    typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim().slice(0, 40)
      : fallback.name;
  let backgroundColor = fallback.backgroundColor;
  if (candidate.backgroundColor === null) {
    backgroundColor = null;
  } else if (candidate.backgroundColor !== undefined) {
    const normalized =
      typeof candidate.backgroundColor === "string" ? candidate.backgroundColor.toUpperCase() : "";
    backgroundColor = HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback.backgroundColor;
  }

  return {
    name,
    fontSize: normalizeNumber(candidate.fontSize, fallback.fontSize, 5, 100),
    fontColor: normalizeColor(candidate.fontColor, fallback.fontColor),
    borderWidth: normalizeNumber(candidate.borderWidth, fallback.borderWidth, 0, 10),
    borderColor: normalizeColor(candidate.borderColor, fallback.borderColor),
    backgroundColor,
  };
}

export function normalizeFreeTextPresets(value) {
  const candidates = Array.isArray(value) ? value.slice(0, PRESET_COUNT) : [];
  return DEFAULT_PRESETS.map((fallback, index) => normalizePreset(candidates[index], fallback));
}

export function cloneStyle(style) {
  return {
    fontSize: style.fontSize,
    fontColor: style.fontColor,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,
    backgroundColor: style.backgroundColor,
  };
}

export function stylesEqual(left, right) {
  return (
    left.fontSize === right.fontSize &&
    left.fontColor === right.fontColor &&
    left.borderWidth === right.borderWidth &&
    left.borderColor === right.borderColor &&
    left.backgroundColor === right.backgroundColor
  );
}

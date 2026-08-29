export interface FreeTextPreset {
  readonly name: string;
  readonly fontSize: number;
  readonly fontColor: string;
  readonly borderWidth: number;
  readonly borderColor: string;
  readonly backgroundColor: string | null;
}

export const FREE_TEXT_PRESET_COUNT = 4;

export const DEFAULT_FREE_TEXT_PRESETS: readonly FreeTextPreset[] = Object.freeze([
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

const HEX_COLOR_PATTERN = /^#[\dA-F]{6}$/u;
const MAX_PRESET_NAME_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.toUpperCase();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback;
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value.toUpperCase());
}

export function isValidBackgroundColor(value: unknown): value is string | null {
  return value === null || isValidHexColor(value);
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

export function normalizeFreeTextPreset(value: unknown, fallback: FreeTextPreset): FreeTextPreset {
  const candidate = isRecord(value) ? value : {};
  const name =
    typeof candidate["name"] === "string" && candidate["name"].trim().length > 0
      ? candidate["name"].trim().slice(0, MAX_PRESET_NAME_LENGTH)
      : fallback.name;
  let backgroundColor = fallback.backgroundColor;
  if (candidate["backgroundColor"] === null) {
    backgroundColor = null;
  } else if (candidate["backgroundColor"] !== undefined) {
    const normalized =
      typeof candidate["backgroundColor"] === "string"
        ? candidate["backgroundColor"].toUpperCase()
        : "";
    backgroundColor = HEX_COLOR_PATTERN.test(normalized) ? normalized : fallback.backgroundColor;
  }

  return {
    name,
    fontSize: normalizeNumber(candidate["fontSize"], fallback.fontSize, 5, 100),
    fontColor: normalizeColor(candidate["fontColor"], fallback.fontColor),
    borderWidth: normalizeNumber(candidate["borderWidth"], fallback.borderWidth, 0, 10),
    borderColor: normalizeColor(candidate["borderColor"], fallback.borderColor),
    backgroundColor,
  };
}

export function normalizeFreeTextPresets(value: unknown): FreeTextPreset[] {
  const candidates = Array.isArray(value) ? value.slice(0, FREE_TEXT_PRESET_COUNT) : [];
  return DEFAULT_FREE_TEXT_PRESETS.map((fallback, index) =>
    normalizeFreeTextPreset(candidates[index], fallback),
  );
}

export function isFreeTextPresetUpdateMessage(value: unknown): value is {
  readonly type: "updateFreeTextPreset";
  readonly index: number;
  readonly preset: unknown;
} {
  return (
    isRecord(value) &&
    value["type"] === "updateFreeTextPreset" &&
    Number.isInteger(value["index"]) &&
    (value["index"] as number) >= 0 &&
    (value["index"] as number) < FREE_TEXT_PRESET_COUNT &&
    "preset" in value
  );
}

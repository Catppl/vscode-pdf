const DEFAULT_TRANSFER_TTL_MS = 30_000;
const MAX_TRANSFER_PAYLOAD_BYTES = 1024 * 1024;
const FREETEXT_ANNOTATION_TYPE = 3;

export interface AnnotationGrabOffset {
  readonly x: number;
  readonly y: number;
}

export interface AnnotationTransferSession {
  readonly id: string;
  readonly sourceUri: string;
  readonly annotationType: "freetext";
  readonly payload: Record<string, unknown>;
  readonly grabOffset: AnnotationGrabOffset;
  readonly createdAt: number;
  readonly committingTarget?: string;
}

export interface AnnotationCopyStartMessage {
  readonly type: "annotationCopyStart";
  readonly transferId: string;
  readonly annotationType: "freetext";
  readonly payload: unknown;
  readonly grabOffset: unknown;
}

export interface AnnotationDropRequestMessage {
  readonly type: "annotationDropRequest";
  readonly transferId: string;
}

export interface AnnotationDropResultMessage {
  readonly type: "annotationDropResult";
  readonly transferId: string;
  readonly success: boolean;
}

export interface AnnotationTransferReadyMessage {
  readonly type: "annotationTransferReady";
}

export interface AnnotationTransferModeSetMessage {
  readonly type: "annotationTransferModeSet";
  readonly enabled: boolean;
}

export type AnnotationTransferMessage =
  | AnnotationCopyStartMessage
  | AnnotationDropRequestMessage
  | AnnotationDropResultMessage
  | AnnotationTransferReadyMessage
  | AnnotationTransferModeSetMessage;

type Now = () => number;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) && value.length === length && value.every((item) => isFiniteNumber(item))
  );
}

function isTransferId(value: unknown): value is string {
  return typeof value === "string" && /^pdf-annotation-[A-Za-z0-9-]{8,128}$/u.test(value);
}

function isGrabOffset(value: unknown): value is AnnotationGrabOffset {
  return (
    isObject(value) &&
    isFiniteNumber(value["x"]) &&
    value["x"] >= 0 &&
    value["x"] <= 1 &&
    isFiniteNumber(value["y"]) &&
    value["y"] >= 0 &&
    value["y"] <= 1
  );
}

export function isSerializedFreeText(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) {
    return false;
  }
  if (
    value["annotationType"] !== FREETEXT_ANNOTATION_TYPE ||
    typeof value["value"] !== "string" ||
    !Number.isInteger(value["pageIndex"]) ||
    (value["pageIndex"] as number) < 0 ||
    !isFiniteNumberArray(value["rect"], 4) ||
    !isFiniteNumber(value["fontSize"]) ||
    value["fontSize"] <= 0 ||
    !isFiniteNumber(value["borderWidth"]) ||
    value["borderWidth"] < 0
  ) {
    return false;
  }
  if (value["color"] !== undefined && !isFiniteNumberArray(value["color"], 3)) {
    return false;
  }
  if (value["borderColor"] !== undefined && !isFiniteNumberArray(value["borderColor"], 3)) {
    return false;
  }
  if (
    value["backgroundColor"] !== undefined &&
    value["backgroundColor"] !== null &&
    !isFiniteNumberArray(value["backgroundColor"], 3)
  ) {
    return false;
  }
  return true;
}

function getPayloadSize(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function parseAnnotationTransferMessage(value: unknown): AnnotationTransferMessage | null {
  if (!isObject(value) || typeof value["type"] !== "string") {
    return null;
  }
  switch (value["type"]) {
    case "annotationCopyStart":
      return isTransferId(value["transferId"]) &&
        value["annotationType"] === "freetext" &&
        isSerializedFreeText(value["payload"]) &&
        isGrabOffset(value["grabOffset"]) &&
        getPayloadSize(value["payload"]) <= MAX_TRANSFER_PAYLOAD_BYTES
        ? {
            type: value["type"],
            transferId: value["transferId"],
            annotationType: value["annotationType"],
            payload: value["payload"],
            grabOffset: value["grabOffset"],
          }
        : null;
    case "annotationDropRequest":
      return isTransferId(value["transferId"])
        ? { type: value["type"], transferId: value["transferId"] }
        : null;
    case "annotationDropResult":
      return isTransferId(value["transferId"]) && typeof value["success"] === "boolean"
        ? {
            type: value["type"],
            transferId: value["transferId"],
            success: value["success"],
          }
        : null;
    case "annotationTransferReady":
      return { type: value["type"] };
    case "annotationTransferModeSet":
      return typeof value["enabled"] === "boolean"
        ? { type: value["type"], enabled: value["enabled"] }
        : null;
    default:
      return null;
  }
}

export class AnnotationTransferManager {
  private active: AnnotationTransferSession | null = null;
  private readonly now: Now;
  private readonly ttlMs: number;

  constructor(now: Now = Date.now, ttlMs = DEFAULT_TRANSFER_TTL_MS) {
    this.now = now;
    this.ttlMs = ttlMs;
  }

  startTransfer(
    message: AnnotationCopyStartMessage,
    sourceUri: string,
  ): AnnotationTransferSession | null {
    if (
      !sourceUri ||
      !isTransferId(message.transferId) ||
      message.annotationType !== "freetext" ||
      !isSerializedFreeText(message.payload) ||
      !isGrabOffset(message.grabOffset) ||
      getPayloadSize(message.payload) > MAX_TRANSFER_PAYLOAD_BYTES
    ) {
      return null;
    }
    this.active = {
      id: message.transferId,
      sourceUri,
      annotationType: "freetext",
      payload: message.payload,
      grabOffset: message.grabOffset,
      createdAt: this.now(),
    };
    return this.active;
  }

  getActiveTransfer(transferId?: string): AnnotationTransferSession | null {
    this.expireStaleTransfer();
    if (!this.active || (transferId !== undefined && this.active.id !== transferId)) {
      return null;
    }
    return this.active;
  }

  beginCommit(transferId: string, targetUri: string): AnnotationTransferSession | null {
    const session = this.getActiveTransfer(transferId);
    if (
      !session ||
      !targetUri ||
      targetUri === session.sourceUri ||
      (session.committingTarget !== undefined && session.committingTarget !== targetUri)
    ) {
      return null;
    }
    this.active = { ...session, committingTarget: targetUri };
    return this.active;
  }

  completeTransfer(transferId: string, targetUri: string): AnnotationTransferSession | null {
    const session = this.getActiveTransfer(transferId);
    if (!session || session.committingTarget !== targetUri) {
      return null;
    }
    this.active = null;
    return session;
  }

  cancelTransfer(transferId?: string): AnnotationTransferSession | null {
    const session = this.getActiveTransfer(transferId);
    if (!session) {
      return null;
    }
    this.active = null;
    return session;
  }

  cancelForUri(uri: string): AnnotationTransferSession | null {
    const session = this.getActiveTransfer();
    if (!session || (session.sourceUri !== uri && session.committingTarget !== uri)) {
      return null;
    }
    this.active = null;
    return session;
  }

  private expireStaleTransfer(): void {
    if (this.active && this.now() - this.active.createdAt > this.ttlMs) {
      this.active = null;
    }
  }
}

export const annotationTransferLimits = Object.freeze({
  ttlMs: DEFAULT_TRANSFER_TTL_MS,
  maxPayloadBytes: MAX_TRANSFER_PAYLOAD_BYTES,
});

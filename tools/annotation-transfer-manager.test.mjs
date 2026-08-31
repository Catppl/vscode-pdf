import assert from "node:assert/strict";
import test from "node:test";

import {
  AnnotationTransferManager,
  annotationTransferLimits,
  parseAnnotationTransferMessage,
} from "../src/annotation-transfer-manager.ts";

const sourceUri = "file:///source.pdf";
const targetUri = "file:///target.pdf";

function payload(overrides = {}) {
  return {
    annotationType: 3,
    pageIndex: 0,
    rect: [10, 20, 110, 70],
    rotation: 0,
    value: "Please verify",
    fontSize: 12,
    color: [255, 0, 0],
    borderWidth: 2,
    borderColor: [0, 102, 255],
    backgroundColor: [255, 255, 153],
    ...overrides,
  };
}

function startMessage(id = "pdf-annotation-12345678", overrides = {}) {
  return {
    type: "annotationCopyStart",
    transferId: id,
    annotationType: "freetext",
    payload: payload(),
    grabOffset: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

test("parses a bounded FreeText copy payload", () => {
  const message = startMessage();
  assert.deepEqual(parseAnnotationTransferMessage(message), message);
});

test("parses continuous-mode lifecycle messages", () => {
  assert.deepEqual(parseAnnotationTransferMessage({ type: "annotationTransferReady" }), {
    type: "annotationTransferReady",
  });
  assert.deepEqual(
    parseAnnotationTransferMessage({ type: "annotationTransferModeSet", enabled: true }),
    { type: "annotationTransferModeSet", enabled: true },
  );
  assert.equal(
    parseAnnotationTransferMessage({ type: "annotationTransferModeSet", enabled: "yes" }),
    null,
  );
});

test("rejects invalid or oversized copy payloads", () => {
  assert.equal(
    parseAnnotationTransferMessage(startMessage(undefined, { annotationType: "ink" })),
    null,
  );
  assert.equal(
    parseAnnotationTransferMessage(
      startMessage(undefined, { payload: payload({ rect: [0, 1, Number.NaN, 3] }) }),
    ),
    null,
  );
  assert.equal(
    parseAnnotationTransferMessage(
      startMessage(undefined, {
        payload: payload({ value: "x".repeat(annotationTransferLimits.maxPayloadBytes) }),
      }),
    ),
    null,
  );
});

test("replaces the single active transfer and validates the target", () => {
  const manager = new AnnotationTransferManager();
  const first = manager.startTransfer(startMessage(), sourceUri);
  const secondMessage = startMessage("pdf-annotation-87654321");
  const second = manager.startTransfer(secondMessage, sourceUri);

  assert.equal(first?.id, "pdf-annotation-12345678");
  assert.equal(manager.getActiveTransfer(first?.id), null);
  assert.equal(second?.id, secondMessage.transferId);
  assert.equal(manager.beginCommit(secondMessage.transferId, sourceUri), null);
  assert.equal(
    manager.beginCommit(secondMessage.transferId, targetUri)?.committingTarget,
    targetUri,
  );
  assert.equal(manager.beginCommit(secondMessage.transferId, "file:///third.pdf"), null);
});

test("completes only for the committing target", () => {
  const manager = new AnnotationTransferManager();
  const message = startMessage();
  manager.startTransfer(message, sourceUri);
  manager.beginCommit(message.transferId, targetUri);

  assert.equal(manager.completeTransfer(message.transferId, "file:///wrong.pdf"), null);
  assert.equal(manager.completeTransfer(message.transferId, targetUri)?.id, message.transferId);
  assert.equal(manager.getActiveTransfer(), null);
});

test("cancel and URI disposal clear the matching session", () => {
  const manager = new AnnotationTransferManager();
  const message = startMessage();
  manager.startTransfer(message, sourceUri);
  assert.equal(manager.cancelForUri(targetUri), null);
  assert.equal(manager.cancelTransfer("pdf-annotation-wrong000"), null);
  assert.equal(manager.cancelForUri(sourceUri)?.id, message.transferId);
  assert.equal(manager.getActiveTransfer(), null);
});

test("expires stale sessions without a timer", () => {
  let now = 1_000;
  const manager = new AnnotationTransferManager(() => now, 30_000);
  const message = startMessage();
  manager.startTransfer(message, sourceUri);
  now += 30_001;
  assert.equal(manager.getActiveTransfer(message.transferId), null);
});

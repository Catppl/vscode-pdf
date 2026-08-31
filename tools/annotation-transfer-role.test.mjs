import assert from "node:assert/strict";
import test from "node:test";

import {
  AnnotationTransferDocumentRole,
  canUseDocumentAsTransferRole,
} from "../assets/annotation-transfer.mjs";

test("an unassigned PDF can become the source or target", () => {
  assert.equal(canUseDocumentAsTransferRole(null, AnnotationTransferDocumentRole.SOURCE), true);
  assert.equal(canUseDocumentAsTransferRole(null, AnnotationTransferDocumentRole.TARGET), true);
});

test("the source PDF cannot become a target during the same copy-mode session", () => {
  assert.equal(
    canUseDocumentAsTransferRole(
      AnnotationTransferDocumentRole.SOURCE,
      AnnotationTransferDocumentRole.SOURCE,
    ),
    true,
  );
  assert.equal(
    canUseDocumentAsTransferRole(
      AnnotationTransferDocumentRole.SOURCE,
      AnnotationTransferDocumentRole.TARGET,
    ),
    false,
  );
});

test("a successful target PDF cannot become the next source", () => {
  assert.equal(
    canUseDocumentAsTransferRole(
      AnnotationTransferDocumentRole.TARGET,
      AnnotationTransferDocumentRole.TARGET,
    ),
    true,
  );
  assert.equal(
    canUseDocumentAsTransferRole(
      AnnotationTransferDocumentRole.TARGET,
      AnnotationTransferDocumentRole.SOURCE,
    ),
    false,
  );
});

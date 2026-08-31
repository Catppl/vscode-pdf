import assert from "node:assert/strict";
import test from "node:test";

globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.Path2D ??= class Path2D {};

const { PDFJSBridge } = await import("../assets/pdfjs-bridge.mjs");
const { AnnotationEditorType } = await import("../assets/pdf.js/build/pdf.mjs");

function createBridge(initialMode) {
  let mode = initialMode;
  const updates = [];
  const uiManager = {
    getMode: () => mode,
    updateMode: async (value) => {
      mode = value;
      updates.push(value);
    },
  };
  const bridge = new PDFJSBridge({
    pdfViewer: {
      _layerProperties: { annotationEditorUIManager: uiManager },
    },
  });
  return {
    bridge,
    getMode: () => mode,
    setModeDirect: (value) => {
      mode = value;
    },
    updates,
  };
}

test("external copy silently enables FreeText and restores the previous mode", async () => {
  const { bridge, getMode, updates } = createBridge(AnnotationEditorType.NONE);

  assert.equal(await bridge.beginExternalCopyMode(), true);
  assert.equal(getMode(), AnnotationEditorType.FREETEXT);
  await bridge.endExternalCopyMode();

  assert.equal(getMode(), AnnotationEditorType.NONE);
  assert.deepEqual(updates, [AnnotationEditorType.FREETEXT, AnnotationEditorType.NONE]);
});

test("external copy preserves an already active FreeText tool", async () => {
  const { bridge, getMode, updates } = createBridge(AnnotationEditorType.FREETEXT);

  assert.equal(await bridge.beginExternalCopyMode(), true);
  await bridge.endExternalCopyMode();

  assert.equal(getMode(), AnnotationEditorType.FREETEXT);
  assert.deepEqual(updates, []);
});

test("external copy does not overwrite a tool selected while the mode was active", async () => {
  const { bridge, getMode, setModeDirect, updates } = createBridge(AnnotationEditorType.NONE);

  await bridge.beginExternalCopyMode();
  updates.length = 0;
  setModeDirect(AnnotationEditorType.INK);
  await bridge.endExternalCopyMode();

  assert.equal(getMode(), AnnotationEditorType.INK);
  assert.deepEqual(updates, []);
});

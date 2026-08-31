import { computeTargetRect } from "./annotation-transfer-geometry.mjs";
import { cloneStyle, DEFAULT_PRESETS, normalizePreset } from "./free-text-preset-model.mjs";
import { AnnotationEditorParamsType, AnnotationEditorType } from "./pdf.js/build/pdf.mjs";

const STYLE_PARAMS = [
  [AnnotationEditorParamsType.FREETEXT_SIZE, "fontSize"],
  [AnnotationEditorParamsType.FREETEXT_COLOR, "fontColor"],
  [AnnotationEditorParamsType.FREETEXT_BORDER_WIDTH, "borderWidth"],
  [AnnotationEditorParamsType.FREETEXT_BORDER_COLOR, "borderColor"],
  [AnnotationEditorParamsType.FREETEXT_BACKGROUND_COLOR, "backgroundColor"],
];

export class PDFJSBridge {
  #app;
  #getFreeTextStyle = () => cloneStyle(DEFAULT_PRESETS[3]);

  constructor(app) {
    this.#app = app;
  }

  setFreeTextStyleGetter(getter) {
    this.#getFreeTextStyle = typeof getter === "function" ? getter : this.#getFreeTextStyle;
  }

  setFreeTextStyle(style, activate = false) {
    const currentStyle = this.getFreeTextStyle();
    const normalized = normalizePreset(
      { ...style, name: "Current" },
      { name: "Current", ...currentStyle },
    );
    const eventBus = this.#app.eventBus;
    for (const [type, key] of STYLE_PARAMS) {
      eventBus.dispatch("switchannotationeditorparams", {
        source: this,
        type,
        value: normalized[key],
      });
    }
    eventBus.dispatch("annotationeditorparamschanged", {
      source: this,
      details: STYLE_PARAMS.map(([type, key]) => [type, normalized[key]]),
    });
    if (activate) {
      eventBus.dispatch("switchannotationeditormode", {
        source: this,
        mode: AnnotationEditorType.FREETEXT,
      });
    }
    return cloneStyle(normalized);
  }

  getFreeTextStyle() {
    return cloneStyle(this.#getFreeTextStyle());
  }

  activateFreeTextMode() {
    this.#app.eventBus.dispatch("switchannotationeditormode", {
      source: this,
      mode: AnnotationEditorType.FREETEXT,
    });
  }

  serializeSelectedAnnotationForCopy(clientX, clientY) {
    return this.#uiManager()?.serializeSelectedEditorForExternalCopy(clientX, clientY) ?? null;
  }

  async insertSerializedAnnotationAt(payload, placement) {
    const pageIndex = placement?.pageIndex;
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      return false;
    }
    const pageView = this.#app.pdfViewer.getPageView(pageIndex);
    const pageElement = placement.pageElement;
    const pageBounds = pageView?.pdfPage?.view;
    const viewport = pageView?.viewport;
    if (!pageView || !pageElement || !pageBounds || !viewport) {
      return false;
    }
    const rect = computeTargetRect({
      sourceRect: payload?.rect,
      pageBounds,
      viewport,
      pageClientRect: pageElement.getBoundingClientRect(),
      clientX: placement.clientX,
      clientY: placement.clientY,
      grabOffset: placement.grabOffset,
    });
    if (!rect) {
      return false;
    }
    return (await this.#uiManager()?.pasteSerializedEditorAt(payload, pageIndex, rect)) === true;
  }

  installGlobal() {
    window.VSCodePDFBridge = Object.freeze({
      owner: this,
      setFreeTextStyle: this.setFreeTextStyle.bind(this),
      getFreeTextStyle: this.getFreeTextStyle.bind(this),
      activateFreeTextMode: this.activateFreeTextMode.bind(this),
      serializeSelectedAnnotationForCopy: this.serializeSelectedAnnotationForCopy.bind(this),
      insertSerializedAnnotationAt: this.insertSerializedAnnotationAt.bind(this),
    });
    return this;
  }

  destroy() {
    if (window.VSCodePDFBridge?.owner === this) {
      delete window.VSCodePDFBridge;
    }
  }

  #uiManager() {
    return this.#app.pdfViewer?._layerProperties?.annotationEditorUIManager ?? null;
  }
}

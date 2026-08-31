function isObject(value) {
  return typeof value === "object" && value !== null;
}

export const AnnotationTransferDocumentRole = Object.freeze({
  SOURCE: "source",
  TARGET: "target",
});

export function canUseDocumentAsTransferRole(currentRole, requestedRole) {
  return currentRole === null || currentRole === requestedRole;
}

export class AnnotationTransferController {
  #app;
  #bridge;
  #modeEnabled = false;
  #activeTransferId = null;
  #sourceTransferId = null;
  #pendingPlacement = null;
  #documentRole = null;
  #startSelectedWhenEnabled = false;
  #button = null;
  #hint = null;
  #abortController = new AbortController();

  constructor({ app, bridge }) {
    this.#app = app;
    this.#bridge = bridge;
  }

  initialize() {
    this.#createButton();
    const signal = this.#abortController.signal;
    document.addEventListener("pointerdown", this.#onPointerDown, {
      capture: true,
      signal,
    });
    document.addEventListener("click", this.#onDocumentClick, {
      capture: true,
      signal,
    });
    document.addEventListener("keydown", this.#onKeyDown, {
      capture: true,
      signal,
    });
    window.addEventListener("message", this.#onWindowMessage, { signal });
    this.#postMessage({ type: "annotationTransferReady" });
    return this;
  }

  destroy() {
    this.#abortController.abort();
    this.#button?.remove();
    this.#button = null;
    this.#clearTransferState();
    this.#hint?.remove();
    this.#hint = null;
  }

  #onPointerDown = (event) => {
    if (!this.#modeEnabled || !event.target.closest?.(".page[data-page-number]")) {
      return;
    }
    const editor = event.target.closest?.(".freeTextEditor");
    if (this.#activeTransferId || !editor) {
      // In copy mode a page click is either the destination or an invalid
      // source choice. Do not let the FreeText tool create an empty editor.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  #createButton() {
    const presetButtons = document.querySelector("#freeTextPresetButtons");
    const freeTextTool = document.querySelector("#editorFreeText");
    const anchor = presetButtons ?? freeTextTool;
    if (!anchor) {
      throw new Error("PDF.js FreeText toolbar was not found.");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.id = "annotationTransferModeButton";
    button.className = "annotationTransferModeButton";
    button.title =
      "Continuous cross-PDF FreeText copy: select a source annotation, then click its destination";
    button.setAttribute("aria-label", "Toggle continuous cross-PDF FreeText copy");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<span aria-hidden="true">A→B</span>';
    button.addEventListener(
      "click",
      () => {
        const enabled = !this.#modeEnabled;
        this.#startSelectedWhenEnabled = enabled;
        if (enabled) {
          this.#bridge.activateFreeTextMode();
        }
        this.#postMessage({ type: "annotationTransferModeSet", enabled });
      },
      { signal: this.#abortController.signal },
    );
    anchor.after(button);
    this.#button = button;
  }

  #onDocumentClick = (event) => {
    if (!this.#modeEnabled || event.target.closest?.("#annotationTransferModeButton")) {
      return;
    }

    if (this.#activeTransferId) {
      const pageElement = event.target.closest?.(".page[data-page-number]");
      const pageNumber = Number(pageElement?.dataset.pageNumber);
      if (!pageElement || !Number.isInteger(pageNumber) || pageNumber < 1) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#pendingPlacement = {
        pageIndex: pageNumber - 1,
        pageElement,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      document.documentElement.classList.add("annotationTransferCommitting");
      this.#setHint("Copying FreeText annotation…");
      this.#postMessage({
        type: "annotationDropRequest",
        transferId: this.#activeTransferId,
      });
      return;
    }

    const editor = event.target.closest?.(".freeTextEditor");
    if (!editor || event.target.closest?.("button, .resizer, .resizers")) {
      return;
    }

    const { clientX, clientY } = event;
    // Let PDF.js finish its normal selection handling first. The native
    // serializer then guarantees that exactly one selected FreeText is copied.
    setTimeout(() => this.#stageSelectedAnnotation(clientX, clientY), 0);
  };

  #onKeyDown = (event) => {
    if (event.key !== "Escape" || !this.#modeEnabled) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#postMessage({ type: "annotationTransferModeSet", enabled: false });
  };

  #onWindowMessage = async (event) => {
    if (event.origin !== window.origin || !isObject(event.data)) {
      return;
    }
    const message = event.data;
    switch (message.action) {
      case "annotationTransferModeChanged":
        if (typeof message.enabled !== "boolean") {
          return;
        }
        this.#setModeEnabled(message.enabled);
        if (message.enabled && this.#startSelectedWhenEnabled) {
          this.#startSelectedWhenEnabled = false;
          setTimeout(() => this.#stageSelectedAnnotation(), 0);
        }
        return;
      case "annotationTransferSourceReady":
        if (message.transferId !== this.#sourceTransferId) {
          return;
        }
        if (
          !canUseDocumentAsTransferRole(this.#documentRole, AnnotationTransferDocumentRole.SOURCE)
        ) {
          this.#clearTransferState();
          this.#setHint("This PDF is the copy destination. Select the source PDF.", true);
          return;
        }
        this.#documentRole = AnnotationTransferDocumentRole.SOURCE;
        this.#setHint("Source ready — click the destination page in another PDF. Esc exits.");
        return;
      case "annotationTransferAvailable":
        if (typeof message.transferId !== "string" || message.annotationType !== "freetext") {
          return;
        }
        if (
          !canUseDocumentAsTransferRole(this.#documentRole, AnnotationTransferDocumentRole.TARGET)
        ) {
          return;
        }
        this.#activeTransferId = message.transferId;
        this.#pendingPlacement = null;
        document.documentElement.classList.add("annotationTransferAvailable");
        this.#setHint("FreeText ready — click this PDF page to place it. Esc exits.");
        return;
      case "annotationDropCommit": {
        if (
          message.transferId !== this.#activeTransferId ||
          !this.#pendingPlacement ||
          !isObject(message.payload)
        ) {
          return;
        }
        const success = await this.#bridge.insertSerializedAnnotationAt(message.payload, {
          ...this.#pendingPlacement,
          grabOffset: message.grabOffset,
        });
        if (success) {
          this.#documentRole = AnnotationTransferDocumentRole.TARGET;
        }
        this.#postMessage({
          type: "annotationDropResult",
          transferId: message.transferId,
          success,
        });
        this.#setHint(
          success
            ? "Copied. Select the next source FreeText, or press Esc to exit."
            : "FreeText annotation could not be copied.",
          !success,
        );
        return;
      }
      case "annotationTransferRejected":
        if (
          message.transferId === this.#activeTransferId ||
          message.transferId === this.#sourceTransferId
        ) {
          this.#clearTransferState();
          this.#setHint("FreeText copy request was rejected.", true);
        }
        return;
      case "annotationTransferCleared":
        if (
          message.transferId === this.#activeTransferId ||
          message.transferId === this.#sourceTransferId
        ) {
          this.#clearTransferState();
          if (this.#modeEnabled) {
            if (message.dropSuccess === true) {
              this.#setHint("Copied — select the next source FreeText. Esc exits.");
            } else if (message.dropSuccess === false) {
              this.#setHint("FreeText annotation could not be copied.", true);
            } else {
              this.#setHint("Continuous copy is on — select the next source FreeText. Esc exits.");
            }
          }
        }
        return;
    }
  };

  #stageSelectedAnnotation(clientX, clientY) {
    if (!this.#modeEnabled) {
      return;
    }
    if (!canUseDocumentAsTransferRole(this.#documentRole, AnnotationTransferDocumentRole.SOURCE)) {
      this.#setHint(
        "This PDF is the copy destination. Select the next FreeText in the source PDF.",
        true,
      );
      return;
    }
    const serialized = this.#bridge.serializeSelectedAnnotationForCopy(clientX, clientY);
    if (!serialized?.payload || !serialized?.grabOffset) {
      this.#setHint("Select exactly one FreeText annotation to copy.", true);
      return;
    }

    const transferId = `pdf-annotation-${crypto.randomUUID()}`;
    this.#sourceTransferId = transferId;
    this.#postMessage({
      type: "annotationCopyStart",
      transferId,
      annotationType: "freetext",
      payload: serialized.payload,
      grabOffset: serialized.grabOffset,
    });
  }

  #setModeEnabled(enabled) {
    this.#modeEnabled = enabled;
    this.#button?.classList.toggle("active", enabled);
    this.#button?.setAttribute("aria-pressed", `${enabled}`);
    document.documentElement.classList.toggle("annotationTransferMode", enabled);
    if (!enabled) {
      this.#startSelectedWhenEnabled = false;
      this.#documentRole = null;
      this.#clearTransferState();
      return;
    }
    if (!this.#sourceTransferId && !this.#activeTransferId) {
      this.#setHint("Continuous copy is on — select a source FreeText. Esc exits.");
    }
  }

  #postMessage(message) {
    this.#app.pdfLinkService.postMessage(message);
  }

  #clearTransferState() {
    this.#activeTransferId = null;
    this.#sourceTransferId = null;
    this.#pendingPlacement = null;
    document.documentElement.classList.remove(
      "annotationTransferAvailable",
      "annotationTransferCommitting",
    );
    this.#hint?.remove();
    this.#hint = null;
  }

  #setHint(text, isError = false) {
    this.#hint ||= document.createElement("div");
    this.#hint.id = "annotationTransferHint";
    this.#hint.classList.toggle("error", isError);
    this.#hint.textContent = text;
    if (!this.#hint.isConnected) {
      document.body.append(this.#hint);
    }
  }
}

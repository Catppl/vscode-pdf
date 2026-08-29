import {
  cloneStyle,
  DEFAULT_PRESETS,
  normalizeColor,
  normalizeFreeTextPresets,
  normalizePreset,
  stylesEqual,
} from "./free-text-preset-model.mjs";
import { AnnotationEditorParamsType, AnnotationEditorType } from "./pdf.js/build/pdf.mjs";

const PARAM_TO_STYLE = new Map([
  [AnnotationEditorParamsType.FREETEXT_SIZE, "fontSize"],
  [AnnotationEditorParamsType.FREETEXT_COLOR, "fontColor"],
  [AnnotationEditorParamsType.FREETEXT_BORDER_WIDTH, "borderWidth"],
  [AnnotationEditorParamsType.FREETEXT_BORDER_COLOR, "borderColor"],
  [AnnotationEditorParamsType.FREETEXT_BACKGROUND_COLOR, "backgroundColor"],
]);

function formatBackground(color) {
  return color ?? "Transparent";
}

export class FreeTextPresetController {
  #app;
  #presets;
  #buttons = [];
  #container = null;
  #dialog = null;
  #form = null;
  #editingIndex = -1;
  #currentStyle = cloneStyle(DEFAULT_PRESETS[3]);
  #abortController = new AbortController();

  constructor({ app, presets }) {
    this.#app = app;
    this.#presets = normalizeFreeTextPresets(presets);
  }

  initialize() {
    if (this.#container) {
      return this;
    }
    const freeTextTool = document.querySelector("#editorFreeText");
    if (!freeTextTool) {
      throw new Error("PDF.js FreeText toolbar was not found.");
    }

    this.#container = document.createElement("div");
    this.#container.id = "freeTextPresetButtons";
    this.#container.className = "freeTextPresetButtons toolbarHorizontalGroup";
    this.#container.setAttribute("role", "group");
    this.#container.setAttribute("aria-label", "FreeText style presets");
    freeTextTool.after(this.#container);

    this.#createDialog();
    this.renderPresets();
    this.#installBridge();

    const signal = this.#abortController.signal;
    this.#app.eventBus.on("switchannotationeditorparams", this.#onParamSwitched, {
      signal,
    });
    this.#app.eventBus.on("annotationeditorparamschanged", this.#onParamsChanged, { signal });
    window.addEventListener("message", this.#onWindowMessage, { signal });
    return this;
  }

  renderPresets() {
    this.#container.replaceChildren();
    this.#buttons = this.#presets.map((preset, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "freeTextPresetButton";
      button.dataset.presetIndex = `${index}`;
      button.setAttribute("aria-pressed", "false");
      button.title = this.#tooltip(preset);
      button.addEventListener("click", () => this.applyPreset(index));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.editPreset(index);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          this.editPreset(index);
        }
      });

      const preview = document.createElement("span");
      preview.className = "freeTextPresetPreview";
      preview.textContent = "Aa";
      preview.style.color = preset.fontColor;
      preview.style.borderColor = preset.borderColor;
      if (preset.backgroundColor === null) {
        preview.classList.add("transparent");
      } else {
        preview.style.backgroundColor = preset.backgroundColor;
      }
      button.append(preview);
      this.#container.append(button);
      return button;
    });
    this.updateActiveState();
  }

  applyPreset(index) {
    const preset = this.#presets[index];
    if (!preset) {
      return;
    }
    window.VSCodePDFBridge.setFreeTextStyle(preset, true);
  }

  editPreset(index) {
    const preset = this.#presets[index];
    if (!preset) {
      return;
    }
    this.#editingIndex = index;
    this.#form.elements.name.value = preset.name;
    this.#form.elements.fontSize.value = `${preset.fontSize}`;
    this.#form.elements.fontColor.value = preset.fontColor;
    this.#form.elements.borderWidth.value = `${preset.borderWidth}`;
    this.#form.elements.borderColor.value = preset.borderColor;
    this.#form.elements.noBackground.checked = preset.backgroundColor === null;
    this.#form.elements.backgroundColor.value = preset.backgroundColor ?? "#FFFFFF";
    this.#form.elements.backgroundColor.disabled = preset.backgroundColor === null;
    this.#form.querySelector(".freeTextPresetError").textContent = "";
    this.#dialog.showModal();
    this.#form.elements.name.focus();
  }

  savePreset(index, value) {
    const fallback = this.#presets[index];
    if (!fallback) {
      return;
    }
    const preset = normalizePreset(value, fallback);
    const wasActive = stylesEqual(this.#currentStyle, fallback);
    this.#presets[index] = preset;
    this.renderPresets();
    if (wasActive) {
      window.VSCodePDFBridge.setFreeTextStyle(preset, false);
    }
    this.#app.pdfLinkService.postMessage({
      type: "updateFreeTextPreset",
      index,
      preset,
    });
  }

  refreshPreset(index, value) {
    const fallback = this.#presets[index] ?? DEFAULT_PRESETS[index];
    if (!fallback) {
      return;
    }
    this.#presets[index] = normalizePreset(value, fallback);
    this.renderPresets();
  }

  updateActiveState() {
    for (let index = 0; index < this.#buttons.length; index++) {
      const active = stylesEqual(this.#currentStyle, this.#presets[index]);
      this.#buttons[index].classList.toggle("active", active);
      this.#buttons[index].setAttribute("aria-pressed", `${active}`);
    }
  }

  destroy() {
    this.#abortController.abort();
    this.#dialog?.remove();
    this.#container?.remove();
    this.#dialog = null;
    this.#form = null;
    this.#container = null;
    if (window.VSCodePDFBridge?.owner === this) {
      delete window.VSCodePDFBridge;
    }
  }

  #installBridge() {
    window.VSCodePDFBridge = Object.freeze({
      owner: this,
      setFreeTextStyle: (style, activate = false) => {
        const normalized = normalizePreset(
          { ...style, name: "Current" },
          {
            name: "Current",
            ...this.#currentStyle,
          },
        );
        this.#currentStyle = cloneStyle(normalized);
        const eventBus = this.#app.eventBus;
        for (const [type, key] of PARAM_TO_STYLE) {
          eventBus.dispatch("switchannotationeditorparams", {
            source: this,
            type,
            value: normalized[key],
          });
        }
        eventBus.dispatch("annotationeditorparamschanged", {
          source: this,
          details: [...PARAM_TO_STYLE].map(([type, key]) => [type, normalized[key]]),
        });
        this.updateActiveState();
        if (activate) {
          eventBus.dispatch("switchannotationeditormode", {
            source: this,
            mode: AnnotationEditorType.FREETEXT,
          });
        }
      },
      getFreeTextStyle: () => cloneStyle(this.#currentStyle),
    });
  }

  #onParamSwitched = (event) => {
    this.#applyParamDetails([[event.type, event.value]]);
  };

  #onParamsChanged = (event) => {
    this.#applyParamDetails(event.details ?? []);
  };

  #applyParamDetails(details) {
    let changed = false;
    for (const [type, value] of details) {
      const key = PARAM_TO_STYLE.get(type);
      if (!key) {
        continue;
      }
      this.#currentStyle[key] =
        key.endsWith("Color") && value !== null
          ? normalizeColor(value, this.#currentStyle[key])
          : value;
      changed = true;
    }
    if (changed) {
      this.updateActiveState();
    }
  }

  #onWindowMessage = (event) => {
    if (event.origin !== window.origin || !event.data || typeof event.data !== "object") {
      return;
    }
    if (event.data.action === "freeTextPresetUpdated") {
      this.refreshPreset(event.data.index, event.data.preset);
    } else if (event.data.action === "freeTextPresetUpdateFailed") {
      console.error(event.data.message ?? "Unable to save the FreeText preset.");
    }
  };

  #tooltip(preset) {
    return [
      preset.name,
      `Font: ${preset.fontColor}`,
      `Border: ${preset.borderColor}`,
      `Background: ${formatBackground(preset.backgroundColor)}`,
      `Size: ${preset.fontSize}`,
      `Border width: ${preset.borderWidth}`,
      "Right-click to edit",
    ].join("\n");
  }

  #createDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "freeTextPresetDialog";
    dialog.className = "freeTextPresetDialog";
    dialog.innerHTML = `
      <form method="dialog" class="freeTextPresetForm">
        <h2>Edit FreeText Preset</h2>
        <label>Name<input name="name" type="text" required maxlength="40"></label>
        <label>Font size<input name="fontSize" type="number" required min="5" max="100" step="0.5"></label>
        <label>Font color<input name="fontColor" type="color" required></label>
        <label>Border width<input name="borderWidth" type="number" required min="0" max="10" step="0.5"></label>
        <label>Border color<input name="borderColor" type="color" required></label>
        <label>Background<input name="backgroundColor" type="color" required></label>
        <label class="freeTextPresetCheckbox"><input name="noBackground" type="checkbox">No background fill</label>
        <div class="freeTextPresetError" role="alert"></div>
        <div class="freeTextPresetDialogActions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>`;
    document.body.append(dialog);
    this.#dialog = dialog;
    this.#form = dialog.querySelector("form");
    const signal = this.#abortController.signal;
    this.#form.elements.noBackground.addEventListener(
      "change",
      (event) => {
        this.#form.elements.backgroundColor.disabled = event.currentTarget.checked;
      },
      { signal },
    );
    this.#form
      .querySelector('[data-action="cancel"]')
      .addEventListener("click", () => dialog.close(), {
        signal,
      });
    this.#form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        if (!this.#form.reportValidity()) {
          return;
        }
        const value = {
          name: this.#form.elements.name.value,
          fontSize: this.#form.elements.fontSize.valueAsNumber,
          fontColor: this.#form.elements.fontColor.value,
          borderWidth: this.#form.elements.borderWidth.valueAsNumber,
          borderColor: this.#form.elements.borderColor.value,
          backgroundColor: this.#form.elements.noBackground.checked
            ? null
            : this.#form.elements.backgroundColor.value,
        };
        this.savePreset(this.#editingIndex, value);
        dialog.close();
      },
      { signal },
    );
  }
}

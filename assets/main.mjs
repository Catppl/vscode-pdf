/*
 * Copyright 2021 Mathematic, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createCommentMatchHighlighter, createCommentResultsPanel } from "./comment-search-ui.mjs";
import { CommentSearchController, FIND_STATE } from "./comment-search.mjs";
import { FreeTextPresetController } from "./free-text-presets.mjs";
import { PDFViewerApplicationOptions } from "./pdf.js/web/viewer.mjs";

function loadConfig() {
  const elem = document.querySelector("#pdf-view-config");
  if (elem) {
    return JSON.parse(elem.dataset.config);
  }
  throw new Error("Could not load configuration.");
}

const config = loadConfig();

let pdfWorker = null;
let pdfWorkerBlobUrl = null;

async function preparePdfWorker() {
  try {
    const response = await fetch(config.workerSrc);
    if (!response.ok) {
      throw new Error(`PDF.js worker request failed with HTTP ${response.status}.`);
    }

    const workerSource = await response.arrayBuffer();
    pdfWorkerBlobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    pdfWorker = new Worker(pdfWorkerBlobUrl, { type: "module" });
    PDFViewerApplicationOptions.set("workerPort", pdfWorker);
  } catch (error) {
    console.warn("Could not create a blob PDF.js worker; using PDF.js fallback.", error);
    pdfWorker = null;
    if (pdfWorkerBlobUrl) {
      URL.revokeObjectURL(pdfWorkerBlobUrl);
      pdfWorkerBlobUrl = null;
    }

    try {
      await import(config.workerSrc);
    } catch (fallbackError) {
      console.error("Could not load the PDF.js worker fallback.", fallbackError);
    }
  }
}

window.addEventListener("pagehide", () => {
  pdfWorker?.terminate();
  pdfWorker = null;
  if (pdfWorkerBlobUrl) {
    URL.revokeObjectURL(pdfWorkerBlobUrl);
    pdfWorkerBlobUrl = null;
  }
});

function createCommentsOnlyCheckbox(findBar) {
  const container = document.querySelector("#findbarOptionsOneContainer");
  if (!container || document.querySelector("#findCommentsOnly")) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "toggleButton toolbarLabel";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "findCommentsOnly";
  checkbox.tabIndex = 0;

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = "Comments only";

  wrapper.append(checkbox, label);
  container.prepend(wrapper);
  findBar.commentsOnly = checkbox;
  return checkbox;
}

function installCommentSearch() {
  const app = window.PDFViewerApplication;
  const findBar = app.findBar;
  if (!findBar) {
    return null;
  }

  const commentsOnly = createCommentsOnlyCheckbox(findBar);
  if (!commentsOnly) {
    return null;
  }

  const updateNativeUIState = findBar.updateUIState.bind(findBar);
  const updateNativeResultsCount = findBar.updateResultsCount.bind(findBar);
  const dispatchDocumentFind = findBar.dispatchEvent.bind(findBar);
  const eventBus = app.eventBus;
  const findBarElement = document.querySelector("#findbar");
  if (!findBarElement) {
    return null;
  }

  let renderingCommentUI = false;
  let activeCommentQuery = "";
  let activeCommentCaseSensitive = false;
  let commentSearch;
  const commentResults = createCommentResultsPanel({
    document,
    container: document.querySelector("#outerContainer"),
    anchor: findBarElement,
    onSelect: (index) => commentSearch?.select(index),
  });
  const commentHighlighter = createCommentMatchHighlighter({
    document,
    app,
    eventBus,
  });
  const unsupportedControls = [findBar.highlightAll, findBar.matchDiacritics, findBar.entireWord];
  const initialDisabledState = new Map(
    unsupportedControls.map((control) => [control, control.disabled]),
  );

  const setUnsupportedControlsDisabled = (disabled) => {
    for (const control of unsupportedControls) {
      control.disabled = disabled ? true : initialDisabledState.get(control);
    }
  };

  const setPendingControls = (pending) => {
    findBar.findPreviousButton.disabled = pending;
    findBar.findNextButton.disabled = pending;
  };

  commentSearch = new CommentSearchController({
    navigate: (match) => {
      if (!match) {
        return;
      }
      if (Array.isArray(match.rect) && match.rect.length >= 4) {
        app.pdfLinkService.goToXY(match.pageIndex + 1, match.rect[0], match.rect[3], {
          center: "both",
        });
      } else {
        app.pdfLinkService.goToPage(match.pageIndex + 1);
      }
      commentHighlighter.highlight(match, activeCommentQuery, activeCommentCaseSensitive);
    },
    updateUI: ({ state, previous, matchesCount, matches = [], currentIndex = -1, query = "" }) => {
      renderingCommentUI = true;
      try {
        updateNativeUIState(state, previous, matchesCount);
      } finally {
        renderingCommentUI = false;
      }
      commentResults.render({
        matches,
        currentIndex,
        query,
        pending: state === FIND_STATE.PENDING,
      });
      if (currentIndex < 0) {
        commentHighlighter.clear();
      }
    },
    setPending: setPendingControls,
  });

  findBar.updateUIState = (state, previous, matchesCount) => {
    if (!commentsOnly.checked) {
      updateNativeUIState(state, previous, matchesCount);
    }
  };
  findBar.updateResultsCount = (matchesCount) => {
    if (!commentsOnly.checked || renderingCommentUI) {
      updateNativeResultsCount(matchesCount);
    }
  };
  findBar.dispatchEvent = (type, findPrevious = false) => {
    if (!commentsOnly.checked) {
      dispatchDocumentFind(type, findPrevious);
      return;
    }
    handleCurrentQuery(type, findPrevious);
  };

  const handleCurrentQuery = (type = "", findPrevious = false) => {
    activeCommentQuery = findBar.findField.value;
    activeCommentCaseSensitive = findBar.caseSensitive.checked;
    void commentSearch.handleFind({
      type,
      query: findBar.findField.value,
      caseSensitive: findBar.caseSensitive.checked,
      findPrevious,
    });
  };

  commentsOnly.addEventListener("change", () => {
    if (commentsOnly.checked) {
      setUnsupportedControlsDisabled(true);
      eventBus.dispatch("findbarclose", { source: findBar });
      handleCurrentQuery();
      return;
    }

    commentSearch.cancel();
    activeCommentQuery = "";
    commentResults.clear();
    commentHighlighter.clear();
    setUnsupportedControlsDisabled(false);
    dispatchDocumentFind("");
  });

  commentsOnly.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    commentsOnly.checked = !commentsOnly.checked;
    commentsOnly.dispatchEvent(new Event("change", { bubbles: true }));
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !commentsOnly.checked ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "g"
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      handleCurrentQuery("again", event.shiftKey);
    },
    true,
  );

  eventBus.on("pagesdestroy", () => {
    commentSearch.setDocument(null);
    activeCommentQuery = "";
    commentResults.clear();
    commentHighlighter.clear();
    if (commentsOnly.checked) {
      renderingCommentUI = true;
      try {
        updateNativeUIState(FIND_STATE.FOUND, false, { current: 0, total: 0 });
      } finally {
        renderingCommentUI = false;
      }
    }
  });
  eventBus.on("documentloaded", () => {
    commentSearch.setDocument(app.pdfDocument);
    commentResults.clear();
    commentHighlighter.clear();
    if (commentsOnly.checked && findBar.findField.value) {
      handleCurrentQuery();
    }
  });

  return commentSearch;
}

PDFViewerApplicationOptions.set("defaultUrl", "");
PDFViewerApplicationOptions.set("disablePreferences", true);
PDFViewerApplicationOptions.set("defaultZoomValue", config.defaultZoomValue ?? "auto");
PDFViewerApplicationOptions.set("sidebarViewOnLoad", config.sidebarViewOnLoad ?? 0);
PDFViewerApplicationOptions.set("workerSrc", config.workerSrc);
PDFViewerApplicationOptions.set("sandboxBundleSrc", config.sandboxBundleSrc);
PDFViewerApplicationOptions.set("cMapUrl", config.cMapUrl);
PDFViewerApplicationOptions.set("iccUrl", config.iccUrl);
PDFViewerApplicationOptions.set("standardFontDataUrl", config.standardFontDataUrl);
PDFViewerApplicationOptions.set("wasmUrl", config.wasmUrl);
PDFViewerApplicationOptions.set("imageResourcesPath", config.imageResourcesPath);

// Prevent pdf.js from intercepting Ctrl+P/Cmd+P and triggering the print dialog.
document.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);

void (async () => {
  await window.PDFViewerApplication.initializedPromise;
  await preparePdfWorker();
  installCommentSearch();
  await window.PDFViewerApplication.open(config);
  await window.PDFViewerApplication.pdfViewer.pagesPromise;
  new FreeTextPresetController({
    app: window.PDFViewerApplication,
    presets: config.freeTextPresets,
  }).initialize();
  const [, hash] = config.url.split("#");
  if (hash) {
    window.PDFViewerApplication.pdfLinkService.setHash(decodeURIComponent(hash));
  }
})();

window.addEventListener("message", async (event) => {
  if (event.origin !== window.origin) {
    return;
  }

  await window.PDFViewerApplication.initializedPromise;
  const currentPageNumber = window.PDFViewerApplication.pdfViewer.currentPageNumber;
  switch (event.data.action) {
    case "reload":
      await window.PDFViewerApplication.open(config);
      await window.PDFViewerApplication.pdfViewer.pagesPromise;
      window.PDFViewerApplication.pdfViewer.currentPageNumber = Math.min(
        currentPageNumber,
        window.PDFViewerApplication.pdfViewer.pagesCount,
      );
      break;
  }
});

window.addEventListener("error", (error) => {
  console.error(error);
});

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

function createElement(document, tagName, className, text = "") {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

function appendHighlightedText(document, parent, text, matchStart, matchLength) {
  const safeStart = Number.isInteger(matchStart) ? matchStart : -1;
  const safeLength = Number.isInteger(matchLength) ? matchLength : 0;
  if (safeStart < 0 || safeLength <= 0 || safeStart >= text.length) {
    parent.textContent = text;
    return;
  }

  parent.append(text.slice(0, safeStart));
  const mark = createElement(document, "mark", "commentSearchSnippetHit");
  mark.textContent = text.slice(safeStart, safeStart + safeLength);
  parent.append(mark, text.slice(safeStart + safeLength));
}

export function createCommentResultsPanel({ document, container, anchor, onSelect }) {
  const host = container ?? anchor?.closest("#outerContainer") ?? anchor?.parentElement;
  const panel = createElement(document, "section", "commentSearchResultsPanel");
  panel.id = "findCommentResultsPanel";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Comment search results");

  const resizer = createElement(document, "div", "commentSearchResultsResizer");
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "Resize comment search results panel");
  resizer.title = "Resize comment search results panel";
  resizer.tabIndex = 0;

  const header = createElement(document, "div", "commentSearchResultsHeader");
  const heading = createElement(document, "h2", "commentSearchResultsTitle", "Comment results");
  heading.id = "findCommentResultsTitle";

  const toggle = createElement(document, "button", "commentSearchResultsToggle", "Show results");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "findCommentResultsList");
  toggle.setAttribute("aria-label", "Toggle comment search results");
  header.append(heading, toggle);

  const content = createElement(document, "div", "commentSearchResultsContent");
  content.hidden = true;
  const summary = createElement(document, "div", "commentSearchResultsSummary");
  summary.id = "findCommentResultsSummary";
  summary.setAttribute("aria-live", "polite");
  const list = createElement(document, "div", "commentSearchResultsList");
  list.id = "findCommentResultsList";
  list.setAttribute("role", "listbox");
  content.append(summary, list);
  panel.append(resizer, header, content);

  let expanded = false;
  let visibleMatches = [];
  let panelWidth = 360;
  let pointerId = null;

  const getWidthBounds = () => {
    const availableWidth = host?.clientWidth || document.documentElement.clientWidth || 1024;
    const minWidth = Math.min(240, Math.max(180, availableWidth - 120));
    const maxWidth = Math.max(minWidth, Math.min(520, availableWidth - 120));
    return { minWidth, maxWidth };
  };

  const setPanelWidth = (nextWidth) => {
    const { minWidth, maxWidth } = getWidthBounds();
    panelWidth = Math.round(Math.max(minWidth, Math.min(maxWidth, nextWidth)));
    panel.style.setProperty("--comment-search-results-width", `${panelWidth}px`);
    host?.style.setProperty("--comment-search-results-width", `${panelWidth}px`);
    resizer.setAttribute("aria-valuemin", String(minWidth));
    resizer.setAttribute("aria-valuemax", String(maxWidth));
    resizer.setAttribute("aria-valuenow", String(panelWidth));
  };

  const syncViewerLayout = () => {
    host?.classList.toggle("commentSearchResultsOpen", !panel.hidden);
  };

  const stopResize = (event) => {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) {
      return;
    }
    pointerId = null;
    panel.classList.remove("resizing");
    host?.classList.remove("commentSearchResultsResizing");
    window.removeEventListener("pointermove", resizeFromPointer);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    if (event?.pointerId !== undefined && resizer.hasPointerCapture?.(event.pointerId)) {
      resizer.releasePointerCapture(event.pointerId);
    }
  };

  const resizeFromPointer = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    const right = panel.getBoundingClientRect().right;
    setPanelWidth(right - event.clientX);
  };

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    pointerId = event.pointerId;
    panel.classList.add("resizing");
    host?.classList.add("commentSearchResultsResizing");
    resizer.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", resizeFromPointer);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });

  resizer.addEventListener("keydown", (event) => {
    const { minWidth, maxWidth } = getWidthBounds();
    const isRtl = document.dir === "rtl";
    const step = 16;
    let nextWidth = null;
    if (event.key === "ArrowLeft") {
      nextWidth = panelWidth + (isRtl ? -step : step);
    } else if (event.key === "ArrowRight") {
      nextWidth = panelWidth + (isRtl ? step : -step);
    } else if (event.key === "Home") {
      nextWidth = minWidth;
    } else if (event.key === "End") {
      nextWidth = maxWidth;
    }
    if (nextWidth === null) {
      return;
    }
    event.preventDefault();
    setPanelWidth(nextWidth);
  });

  window.addEventListener("resize", () => setPanelWidth(panelWidth));

  const setExpanded = (nextExpanded) => {
    expanded = Boolean(nextExpanded);
    content.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Hide results" : "Show results";
  };

  toggle.addEventListener("click", () => setExpanded(!expanded));
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-result-index]");
    if (!row || !list.contains(row)) {
      return;
    }
    onSelect(Number(row.dataset.resultIndex));
  });
  list.addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-result-index]");
    if (!row || !list.contains(row)) {
      return;
    }
    const index = Number(row.dataset.resultIndex);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(index);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = Math.max(0, Math.min(visibleMatches.length - 1, index + delta));
    list.querySelector(`[data-result-index="${next}"]`)?.focus();
  });

  const render = ({ matches = [], currentIndex: nextIndex = -1, query = "", pending = false }) => {
    visibleMatches = matches;
    const hasQuery = Boolean(query);
    panel.hidden = !hasQuery;
    syncViewerLayout();
    if (!hasQuery) {
      setExpanded(false);
      summary.textContent = "";
      list.replaceChildren();
      return;
    }

    if (!expanded) {
      setExpanded(true);
    }
    if (pending) {
      summary.textContent = "Indexing comments…";
      list.replaceChildren();
      return;
    }

    summary.textContent =
      matches.length > 0
        ? `Comment results — ${nextIndex >= 0 ? nextIndex + 1 : 0} / ${matches.length}`
        : "No comment results";
    const fragment = document.createDocumentFragment();
    matches.forEach((match, index) => {
      const row = createElement(document, "button", "commentSearchResult");
      row.type = "button";
      row.dataset.resultIndex = String(index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === nextIndex));
      row.tabIndex = index === nextIndex ? 0 : -1;
      if (index === nextIndex) {
        row.classList.add("commentSearchResultCurrent");
        row.setAttribute("aria-current", "true");
      }

      const title = createElement(
        document,
        "span",
        "commentSearchResultTitle",
        `Page ${match.pageIndex + 1} · ${match.subtype || "Annotation"}`,
      );
      const snippet = createElement(document, "span", "commentSearchResultSnippet");
      appendHighlightedText(
        document,
        snippet,
        match.snippet ?? match.text,
        match.snippetMatchStart ?? match.matchStart,
        match.snippetMatchLength ?? match.matchLength,
      );
      row.append(title, snippet);
      fragment.append(row);
    });
    list.replaceChildren(fragment);
    if (nextIndex >= 0) {
      list
        .querySelector(`[data-result-index="${nextIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };

  const clear = () => {
    visibleMatches = [];
    render({ matches: [], currentIndex: -1, query: "" });
  };

  if (host) {
    host.append(panel);
  } else if (anchor) {
    anchor.after(panel);
  }
  setPanelWidth(panelWidth);
  syncViewerLayout();
  setExpanded(false);
  return { panel, render, clear, setExpanded };
}

function findAnnotationElement(app, match) {
  if (!match || !match.id || !app?.pdfViewer?.getPageView) {
    return null;
  }

  const pageView = app.pdfViewer.getPageView(match.pageIndex);
  const layer = pageView?.div;
  if (!layer) {
    return null;
  }

  const id = String(match.id);
  return (
    [...layer.querySelectorAll("[data-annotation-id]")].find(
      (element) => element.dataset.annotationId === id,
    ) ?? null
  );
}

function markFirstTextMatch(document, element, query, caseSensitive) {
  if (!query) {
    return null;
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue ?? "";
    const haystack = caseSensitive ? value : value.toLowerCase();
    const start = haystack.indexOf(needle);
    if (start === -1) {
      continue;
    }

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + query.length);
    const mark = createElement(document, "mark", "commentSearchAnnotationHit");
    range.surroundContents(mark);
    return () => {
      const parent = mark.parentNode;
      if (!parent) {
        return;
      }
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      mark.remove();
    };
  }
  return null;
}

export function createCommentMatchHighlighter({ document, app, eventBus }) {
  let cleanup = () => {};
  let requestId = 0;

  const clear = () => {
    requestId++;
    cleanup();
    cleanup = () => {};
  };

  const highlight = (match, query, caseSensitive = false) => {
    clear();
    if (!match) {
      return;
    }

    const currentRequest = requestId;
    let stopped = false;
    let timeoutId = null;
    const onRendered = ({ pageNumber }) => {
      if (pageNumber === match.pageIndex + 1) {
        attempt();
      }
    };
    const stopWaiting = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (eventBus) {
        eventBus.off("annotationlayerrendered", onRendered);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
    const attempt = () => {
      if (stopped || currentRequest !== requestId) {
        return;
      }
      const element = findAnnotationElement(app, match);
      if (!element) {
        return;
      }
      const exactCleanup = markFirstTextMatch(document, element, query, caseSensitive);
      element.classList.add("commentSearchAnnotationTarget");
      cleanup = () => {
        stopWaiting();
        exactCleanup?.();
        element.classList.remove("commentSearchAnnotationTarget");
      };
      stopWaiting();
    };

    eventBus?.on("annotationlayerrendered", onRendered);
    requestAnimationFrame(attempt);
    timeoutId = setTimeout(stopWaiting, 1500);
  };

  return { highlight, clear };
}

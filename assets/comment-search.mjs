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

const FIND_STATE = Object.freeze({
  FOUND: 0,
  NOT_FOUND: 1,
  WRAPPED: 2,
  PENDING: 3,
});

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getCommentText(annotation) {
  if (annotation?.subtype === "Popup") {
    return null;
  }

  const richText = trimmedString(annotation?.richText?.str);
  const contents = trimmedString(annotation?.contentsObj?.str);
  return richText || contents || null;
}

export function isValidRect(rect) {
  return (
    Array.isArray(rect) &&
    rect.length >= 4 &&
    rect.slice(0, 4).every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

export function findCommentMatch(text, query, caseSensitive = false) {
  if (typeof text !== "string" || typeof query !== "string" || query.length === 0) {
    return null;
  }

  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const start = haystack.indexOf(needle);
  return start === -1 ? null : { start, length: query.length };
}

export function buildCommentSnippet(text, start, length, contextLength = 60) {
  if (
    typeof text !== "string" ||
    !Number.isInteger(start) ||
    !Number.isInteger(length) ||
    start < 0 ||
    length <= 0 ||
    start >= text.length
  ) {
    return null;
  }

  const snippetStart = Math.max(0, start - contextLength);
  const snippetEnd = Math.min(text.length, start + length + contextLength);
  const prefix = snippetStart > 0 ? "…" : "";
  const suffix = snippetEnd < text.length ? "…" : "";
  return {
    text: `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`,
    matchStart: prefix.length + start - snippetStart,
    matchLength: Math.min(length, text.length - start),
  };
}

export async function buildCommentIndex(
  pdfDocument,
  isCurrentDocument = () => true,
  logger = console,
) {
  const comments = [];

  for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex++) {
    if (!isCurrentDocument()) {
      return null;
    }

    try {
      const page = await pdfDocument.getPage(pageIndex + 1);
      const annotations = await page.getAnnotations({ intent: "display" });

      if (!isCurrentDocument()) {
        return null;
      }

      for (const annotation of annotations) {
        const text = getCommentText(annotation);
        if (!text) {
          continue;
        }

        comments.push({
          id: annotation.id ?? null,
          pageIndex,
          rect: isValidRect(annotation.rect) ? annotation.rect : null,
          subtype: annotation.subtype ?? "",
          author: trimmedString(annotation.titleObj?.str),
          text,
        });
      }
    } catch (error) {
      logger.warn?.(`Unable to index PDF comments on page ${pageIndex + 1}.`, error);
    }
  }

  return comments;
}

export class CommentSearchController {
  #pdfDocument = null;
  #documentGeneration = 0;
  #indexPromise = null;
  #indexDocument = null;
  #comments = null;
  #matches = [];
  #currentIndex = -1;
  #requestId = 0;
  #lastQuery = "";
  #lastCaseSensitive = false;
  #navigate;
  #updateUI;
  #setPending;
  #logger;

  constructor({ navigate, updateUI, setPending = () => {}, logger = console }) {
    this.#navigate = navigate;
    this.#updateUI = updateUI;
    this.#setPending = setPending;
    this.#logger = logger;
  }

  setDocument(pdfDocument) {
    this.#documentGeneration++;
    this.#requestId++;
    this.#pdfDocument = pdfDocument ?? null;
    this.#indexPromise = null;
    this.#indexDocument = null;
    this.#comments = null;
    this.#matches = [];
    this.#currentIndex = -1;
    this.#lastQuery = "";
    this.#lastCaseSensitive = false;
    this.#setPending(false);
  }

  get matches() {
    return this.#matches;
  }

  get currentIndex() {
    return this.#currentIndex;
  }

  cancel() {
    this.#requestId++;
    this.#matches = [];
    this.#currentIndex = -1;
    this.#setPending(false);
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#matches.length) {
      return false;
    }

    this.#currentIndex = index;
    this.#emitUI(FIND_STATE.FOUND, false);
    this.#navigateCurrent();
    return true;
  }

  async handleFind({ type = "", query = "", caseSensitive = false, findPrevious = false }) {
    const requestId = ++this.#requestId;
    const documentGeneration = this.#documentGeneration;
    const pdfDocument = this.#pdfDocument;
    const sameSearch =
      type === "again" &&
      query === this.#lastQuery &&
      caseSensitive === this.#lastCaseSensitive &&
      this.#matches.length > 0;

    if (!query) {
      this.#matches = [];
      this.#currentIndex = -1;
      this.#lastQuery = query;
      this.#lastCaseSensitive = caseSensitive;
      this.#setPending(false);
      this.#emitUI(FIND_STATE.FOUND, false);
      return;
    }

    if (!pdfDocument) {
      this.#matches = [];
      this.#currentIndex = -1;
      this.#setPending(false);
      this.#emitUI(FIND_STATE.NOT_FOUND, findPrevious);
      return;
    }

    const indexReady = this.#indexDocument === pdfDocument && this.#comments !== null;
    if (!indexReady) {
      this.#setPending(true);
      this.#updateUI({
        state: FIND_STATE.PENDING,
        previous: findPrevious,
        matchesCount: { current: 0, total: 0 },
      });
    }
    const comments = await this.#ensureIndex(pdfDocument, documentGeneration);
    if (!this.#isCurrentRequest(requestId, documentGeneration, pdfDocument) || !comments) {
      return;
    }

    this.#setPending(false);
    if (sameSearch) {
      const previousIndex = this.#currentIndex;
      this.#currentIndex = findPrevious
        ? (previousIndex - 1 + this.#matches.length) % this.#matches.length
        : (previousIndex + 1) % this.#matches.length;
      const wrapped = findPrevious
        ? previousIndex === 0
        : previousIndex === this.#matches.length - 1;
      this.#emitUI(wrapped ? FIND_STATE.WRAPPED : FIND_STATE.FOUND, findPrevious);
      this.#navigateCurrent();
      return;
    }

    this.#matches = comments.flatMap((comment) => {
      const match = findCommentMatch(comment.text, query, caseSensitive);
      if (!match) {
        return [];
      }

      const snippet = buildCommentSnippet(comment.text, match.start, match.length);
      return [
        {
          ...comment,
          matchStart: match.start,
          matchLength: match.length,
          snippet: snippet?.text ?? comment.text,
          snippetMatchStart: snippet?.matchStart ?? match.start,
          snippetMatchLength: snippet?.matchLength ?? match.length,
        },
      ];
    });
    this.#lastQuery = query;
    this.#lastCaseSensitive = caseSensitive;
    this.#currentIndex = this.#matches.length > 0 ? 0 : -1;
    this.#emitUI(this.#matches.length > 0 ? FIND_STATE.FOUND : FIND_STATE.NOT_FOUND, findPrevious);
    this.#navigateCurrent();
  }

  #isCurrentRequest(requestId, documentGeneration, pdfDocument) {
    return (
      requestId === this.#requestId &&
      documentGeneration === this.#documentGeneration &&
      pdfDocument === this.#pdfDocument
    );
  }

  async #ensureIndex(pdfDocument, documentGeneration) {
    if (this.#indexPromise && this.#indexDocument === pdfDocument) {
      return this.#indexPromise;
    }

    this.#indexDocument = pdfDocument;
    this.#indexPromise = buildCommentIndex(
      pdfDocument,
      () => documentGeneration === this.#documentGeneration && pdfDocument === this.#pdfDocument,
      this.#logger,
    ).then((comments) => {
      if (
        comments &&
        documentGeneration === this.#documentGeneration &&
        pdfDocument === this.#pdfDocument
      ) {
        this.#comments = comments;
      }
      return comments;
    });
    return this.#indexPromise;
  }

  #emitUI(state, previous) {
    const current = this.#currentIndex >= 0 ? this.#currentIndex + 1 : 0;
    this.#updateUI({
      state,
      previous,
      matches: this.#matches.slice(),
      currentIndex: this.#currentIndex,
      query: this.#lastQuery,
      matchesCount: {
        current,
        total: this.#matches.length,
      },
    });
  }

  #navigateCurrent() {
    if (this.#currentIndex >= 0) {
      this.#navigate(this.#matches[this.#currentIndex]);
    }
  }
}

export { FIND_STATE };

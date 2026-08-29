import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommentIndex,
  buildCommentSnippet,
  CommentSearchController,
  findCommentMatch,
  FIND_STATE,
  getCommentText,
} from "../assets/comment-search.mjs";

function makeDocument(annotationPages, { failingPages = [], waitForPage } = {}) {
  const failures = new Set(failingPages);
  return {
    numPages: annotationPages.length,
    getPage(pageNumber) {
      if (failures.has(pageNumber)) {
        return Promise.reject(new Error(`page ${pageNumber} failed`));
      }
      return Promise.resolve({
        getAnnotations() {
          return waitForPage
            ? waitForPage(pageNumber)
            : Promise.resolve(annotationPages[pageNumber - 1]);
        },
      });
    },
  };
}

test("extracts non-empty rich text before plain contents and ignores Popup", () => {
  assert.equal(
    getCommentText({
      subtype: "Highlight",
      richText: { str: "  rich comment  " },
      contentsObj: { str: "plain comment" },
    }),
    "rich comment",
  );
  assert.equal(
    getCommentText({
      subtype: "Underline",
      richText: { str: "   " },
      contentsObj: { str: "  fallback comment " },
    }),
    "fallback comment",
  );
  assert.equal(getCommentText({ subtype: "Popup", contentsObj: { str: "duplicate" } }), null);
  assert.equal(getCommentText({ subtype: "Text", contentsObj: { str: "  " } }), null);
});

test("finds a case-aware match and keeps snippet offsets correct", () => {
  assert.deepEqual(findCommentMatch("Please Confirm now", "confirm"), {
    start: 7,
    length: 7,
  });
  assert.equal(findCommentMatch("Please Confirm now", "confirm", true), null);

  const snippet = buildCommentSnippet(`${"prefix ".repeat(12)}confirm suffix`, 84, 7, 10);
  assert.deepEqual(snippet, {
    text: "…ix prefix confirm suffix",
    matchStart: 11,
    matchLength: 7,
  });
  assert.equal(buildCommentSnippet("text", -1, 2), null);
});

test("builds an index for all annotation types and continues after a page failure", async () => {
  const document = makeDocument(
    [
      [
        { id: "text", subtype: "Text", contentsObj: { str: "first" } },
        { id: "popup", subtype: "Popup", contentsObj: { str: "duplicate" } },
      ],
      [{ id: "highlight", subtype: "Highlight", richText: { str: "second" } }],
      [{ id: "strikeout", subtype: "StrikeOut", contentsObj: { str: "third" } }],
    ],
    { failingPages: [2] },
  );
  const warnings = [];
  const comments = await buildCommentIndex(document, () => true, {
    warn: (...args) => warnings.push(args),
  });

  assert.deepEqual(
    comments.map(({ id, pageIndex, text }) => ({ id, pageIndex, text })),
    [
      { id: "text", pageIndex: 0, text: "first" },
      { id: "strikeout", pageIndex: 2, text: "third" },
    ],
  );
  assert.equal(warnings.length, 1);
});

test("searches comments with Match Case and wraps Previous/Next", async () => {
  const navigated = [];
  const ui = [];
  const controller = new CommentSearchController({
    navigate: (match) => navigated.push(match.id),
    updateUI: (state) => ui.push(state),
  });
  controller.setDocument(
    makeDocument([
      [{ id: "one", subtype: "Text", contentsObj: { str: "Please confirm" } }],
      [{ id: "two", subtype: "Highlight", contentsObj: { str: "confirm again" } }],
    ]),
  );

  await controller.handleFind({ query: "confirm", caseSensitive: false });
  assert.deepEqual(navigated, ["one"]);
  assert.deepEqual(ui.at(-1).matchesCount, { current: 1, total: 2 });
  assert.equal(ui.at(-1).matches[0].matchLength, 7);
  assert.equal(ui.at(-1).matches[0].snippetMatchLength, 7);

  await controller.handleFind({ type: "again", query: "confirm", findPrevious: false });
  assert.deepEqual(navigated, ["one", "two"]);

  await controller.handleFind({ type: "again", query: "confirm", findPrevious: false });
  assert.deepEqual(navigated, ["one", "two", "one"]);
  assert.equal(ui.at(-1).state, FIND_STATE.WRAPPED);

  await controller.handleFind({ query: "Please confirm", caseSensitive: true });
  assert.deepEqual(navigated, ["one", "two", "one", "one"]);
  assert.deepEqual(ui.at(-1).matchesCount, { current: 1, total: 1 });

  await controller.handleFind({ query: "CONFIRM", caseSensitive: true });
  assert.equal(ui.at(-1).state, FIND_STATE.NOT_FOUND);
  assert.deepEqual(ui.at(-1).matchesCount, { current: 0, total: 0 });
});

test("selects a result from the comment results panel without changing count semantics", async () => {
  const navigated = [];
  const ui = [];
  const controller = new CommentSearchController({
    navigate: (match) => navigated.push(match.id),
    updateUI: (state) => ui.push(state),
  });
  controller.setDocument(
    makeDocument([
      [{ id: "one", subtype: "Text", contentsObj: { str: "confirm one" } }],
      [{ id: "two", subtype: "FreeText", contentsObj: { str: "confirm two" } }],
    ]),
  );

  await controller.handleFind({ query: "confirm" });
  assert.equal(controller.select(1), true);
  assert.deepEqual(navigated, ["one", "two"]);
  assert.deepEqual(ui.at(-1).matchesCount, { current: 2, total: 2 });
  assert.equal(ui.at(-1).currentIndex, 1);
  assert.equal(controller.select(-1), false);
  assert.equal(controller.select(2), false);
});

test("builds one index per document and ignores stale document results", async () => {
  let resolveAnnotations;
  let getAnnotationsCalls = 0;
  const documentA = makeDocument([[]], {
    waitForPage: () => {
      getAnnotationsCalls++;
      return new Promise((resolve) => {
        resolveAnnotations = resolve;
      });
    },
  });
  const documentB = makeDocument([[{ id: "new", subtype: "Text", contentsObj: { str: "new" } }]]);
  const navigated = [];
  const controller = new CommentSearchController({
    navigate: (match) => navigated.push(match.id),
    updateUI: () => {},
  });

  controller.setDocument(documentA);
  const staleSearch = controller.handleFind({ query: "old" });
  controller.setDocument(documentB);
  await controller.handleFind({ query: "new" });
  assert.deepEqual(navigated, ["new"]);

  resolveAnnotations([{ id: "old", subtype: "Text", contentsObj: { str: "old" } }]);
  await staleSearch;
  assert.deepEqual(navigated, ["new"]);
  assert.equal(getAnnotationsCalls, 1);

  await controller.handleFind({ query: "new" });
  assert.deepEqual(navigated, ["new", "new"]);
});

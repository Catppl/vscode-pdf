# PDF “Comments only” Search — Phase 1 Implementation Plan

## 1. Document status

- Status: ready for implementation
- Target repository: `/Users/fk/docker/vscode-pdf`
- Target PDF.js version: `6.2.108`
- Phase: Phase 1 only
- Purpose: add a minimal `Comments only` mode to the existing PDF.js Find bar
- Implementation principle: preserve the upstream document-text search path exactly when the new option is unchecked

This document is an implementation plan, not a record of completed code changes.

## 2. Goal

Add one unchecked-by-default checkbox to the existing PDF Find bar:

```text
[ ] Comments only
```

When the checkbox is unchecked, all existing PDF.js search behavior must remain unchanged.

When it is checked, the Find bar must search only non-empty annotation comment content obtained from PDF.js annotation data. It must not search PDF document-body text, highlighted source text, author names, dates, or any other annotation metadata.

Phase 1 must support:

- substring search;
- Match Case;
- Previous;
- Next;
- wrap-around navigation;
- the existing result counter;
- navigation to the annotation location.

Phase 1 does not require annotation selection or custom annotation highlighting.

## 3. Scope boundaries

### 3.1 In scope

- Inject one checkbox into the existing Find bar.
- Read annotations through `PDFPageProxy.getAnnotations({ intent: "display" })`.
- Build one in-memory comment index for the current `PDFDocumentProxy`.
- Search `richText.str`, falling back to `contentsObj.str` when the rich text is empty.
- Ignore `Popup` annotations.
- Route Find bar input, Previous, Next, Enter, Shift+Enter, and Cmd/Ctrl+G to the comment controller while comment mode is active.
- Reuse `PDFViewerApplication.pdfLinkService.goToXY()` for navigation.
- Invalidate the index when the PDF is closed, replaced, or reloaded.
- Add focused automated tests for extraction, searching, wrapping, indexing, and stale asynchronous results.

### 3.2 Explicitly out of scope

- Annotation creation, editing, deletion, or save behavior.
- A comment sidebar or annotation list panel.
- Reusing comment text as PDF text-layer content.
- Annotation highlighting or a new selected-annotation rendering system.
- Searching highlighted source text.
- Searching annotation author, date, subject, or subtype.
- Regex search.
- Cross-document search.
- Persistent caches, JSON files, SQLite, or other file writes.
- Changes to PDF parsing.
- Changes to unrelated viewer or extension behavior.

## 4. Repository findings that govern the design

### 4.1 Find bar wiring

The Find bar markup is provided by:

```text
assets/pdf.js/web/viewer.html
```

PDF.js creates a `PDFFindBar` instance and exposes it as:

```js
window.PDFViewerApplication.findBar;
```

The existing input, option checkboxes, Previous button, Next button, Enter, and Shift+Enter handlers call the instance method:

```js
findBar.dispatchEvent(type, findPrevious);
```

That method dispatches the standard PDF.js event:

```js
eventBus.dispatch("find", state);
```

### 4.2 Document search controller wiring

`PDFFindController` registers an internal `find` event listener during viewer initialization. Its handler is a private class method:

```js
#onFind(state)
```

It starts or updates PDF body-text extraction and matching.

PDF.js EventBus invokes internal listeners before external listeners. Therefore, adding a normal `eventBus.on("find", ...)` listener in `assets/main.mjs` cannot cancel the native document search: the native controller has already received the event.

### 4.3 CommentManager reuse boundary

PDF.js `CommentManager` has comment-selection behavior, but its instance is not exposed as a stable public `PDFViewerApplication` property. Its annotation collections and ID-to-element maps are private and depend on comment-sidebar/UI initialization.

Consequently:

- do not use `CommentManager` as the search index;
- do not require the comment sidebar to be open;
- do not call private fields or bundled implementation details;
- use the public PDF document annotation API for indexing;
- reuse only the public link-service navigation behavior in Phase 1.

### 4.4 Existing customization boundary

The repository already loads `assets/main.mjs` after `viewer.mjs` initialization and exposes `window.PDFViewerApplication`. The extension also loads `assets/main.css` after the upstream viewer stylesheet.

The existing `patches/pdf.js.patch` currently handles only repository-required PDF.js distribution changes. The Comments-only feature can be implemented outside generated PDF.js assets, so no PDF.js patch is planned.

## 5. Approved architecture

```text
Existing PDF Find bar
        |
        +-- Comments only OFF
        |       |
        |       +-- original PDFFindBar.dispatchEvent()
        |               |
        |               +-- existing "find" event
        |                       |
        |                       +-- existing PDFFindController
        |
        +-- Comments only ON
                |
                +-- wrapped PDFFindBar.dispatchEvent()
                        |
                        +-- CommentSearchController
                                |
                                +-- ensureIndex()
                                +-- search()
                                +-- next()/previous()
                                +-- updateFindUI()
                                +-- goToCurrent()
```

The comment route must not dispatch a standard `find` event. This guarantees that only one search system runs for new comment-mode requests.

## 6. Planned files

### 6.1 Add `assets/comment-search.mjs`

Responsibilities:

- comment text extraction;
- annotation index construction;
- index lifecycle and document-generation checks;
- substring matching;
- Match Case handling;
- current-match state;
- Previous/Next wrap-around;
- navigation callback invocation;
- UI-state callback invocation.

Keep this module independent of the DOM where practical so it can be tested with a fake PDF document.

### 6.2 Modify `assets/main.mjs`

Responsibilities:

- initialize the feature after `PDFViewerApplication.initializedPromise`;
- inject the checkbox into the existing Find bar;
- wrap `findBar.dispatchEvent()`;
- isolate comment UI updates from stale native-search updates;
- connect PDF lifecycle events to `CommentSearchController.setDocument()`;
- intercept Cmd/Ctrl+G in comment mode;
- keep current PDF-open and reload behavior intact.

### 6.3 Modify `assets/main.css` only if necessary

First attempt to reuse existing PDF.js classes:

```text
toggleButton toolbarLabel toolbarHorizontalGroup
```

Do not add CSS if the existing Find bar layout works correctly. If styling is required, scope every rule under `#findbar` and the new feature-specific ID/class.

### 6.4 Add `tools/comment-search.test.mjs`

Use the built-in Node test runner. Do not add a third-party test framework.

### 6.5 Modify `package.json`

Add a focused test script and include it in `check`, for example:

```json
{
  "scripts": {
    "test:comment-search": "node --test tools/comment-search.test.mjs"
  }
}
```

The final command order may be adjusted to match repository formatting, but the new tests must be part of the normal verification path.

### 6.6 Files that must not be changed for this implementation

Unless an unforeseen blocker is proven during implementation, do not change:

```text
assets/pdf.js/web/viewer.mjs
assets/pdf.js/web/viewer.html
assets/pdf.js/web/viewer.css
patches/pdf.js.patch
src/pdf-viewer-provider.ts
```

If a generated PDF.js change becomes unavoidable, stop and document the blocker before extending the patch. Do not directly edit generated files without updating `patches/pdf.js.patch` through the repository patch workflow.

## 7. Comment data model

Use this in-memory record shape:

```js
{
  id,
  pageIndex,
  rect,
  subtype,
  author,
  text,
}
```

Definitions:

- `id`: `annotation.id ?? null`;
- `pageIndex`: the zero-based page index from the page iteration, not a required annotation field;
- `rect`: `annotation.rect` when it is a valid four-number rectangle, otherwise `null`;
- `subtype`: `annotation.subtype ?? ""`;
- `author`: `annotation.titleObj?.str ?? ""`, stored for possible future use but not searched;
- `text`: normalized non-empty comment text.

One matching index record equals one search result. If the query appears twice in one comment, that comment still counts as one result.

## 8. Comment extraction rules

The extraction helper must implement content priority based on non-empty values, not only nullish values.

Required behavior:

```js
export function getCommentText(annotation) {
  if (annotation?.subtype === "Popup") {
    return null;
  }

  const richText =
    typeof annotation?.richText?.str === "string" ? annotation.richText.str.trim() : "";

  const plainText =
    typeof annotation?.contentsObj?.str === "string" ? annotation.contentsObj.str.trim() : "";

  return richText || plainText || null;
}
```

Important consequences:

- subtype is not used as an allow-list;
- Text, Highlight, Underline, StrikeOut, FreeText, and other markup types are searchable when they contain comment text;
- a `Popup` is ignored even if it contains text, preventing parent/popup duplicates;
- whitespace-only rich text falls back to `contentsObj.str`;
- highlighted source text, quad points, alternative text, title, and author are not searched;
- rich-text HTML is not rendered or indexed; only `richText.str` is used.

## 9. Index construction

### 9.1 Trigger

Build lazily when Comments only is first used for the current PDF.

Do not build on every keystroke. Store a shared promise so all searches issued during the first build await the same work:

```js
this.indexPromise ||= this.buildIndex(pdfDocument, generation);
```

### 9.2 Algorithm

For Phase 1, use a sequential page loop. It is the smallest implementation, avoids a large burst of page/worker requests, and keeps index order deterministic.

Pseudocode:

```js
async function buildCommentIndex(pdfDocument, isCurrentDocument) {
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
          author: annotation.titleObj?.str ?? "",
          text,
        });
      }
    } catch (error) {
      console.warn(`Unable to index PDF comments on page ${pageIndex + 1}.`, error);
    }
  }

  return comments;
}
```

A single malformed page must not prevent comments on other pages from being searched.

### 9.3 Index order

Results are ordered by:

1. PDF page order;
2. the annotation order returned by PDF.js within that page.

Do not add geometric sorting in Phase 1. If users later require a visual top-to-bottom order within a page, treat that as a separate refinement.

### 9.4 Memory and persistence

- Keep only the annotation records required for search/navigation.
- Do not write index data to disk.
- Do not send comment data to the extension host.
- Do not add telemetry containing comment text.
- Release references when the PDF is replaced or closed.

## 10. Controller lifecycle and race protection

`CommentSearchController` should hold at least:

```js
this.pdfDocument = null;
this.documentGeneration = 0;
this.indexPromise = null;
this.comments = [];
this.matches = [];
this.currentIndex = -1;
this.searchRequestId = 0;
this.lastQuery = "";
this.lastCaseSensitive = false;
```

### 10.1 `setDocument(pdfDocument)`

Every call must:

1. increment `documentGeneration`;
2. increment `searchRequestId`;
3. replace `pdfDocument`;
4. clear `indexPromise`, `comments`, `matches`, and current selection;
5. clear the comment-mode result count;
6. leave no old asynchronous result eligible to update the UI.

The old index-building promise does not need hard cancellation. It must be ignored through document identity and generation checks.

### 10.2 PDF lifecycle hooks

Install lifecycle listeners before the first `PDFViewerApplication.open(config)` call:

- on `pagesdestroy`, call `setDocument(null)`;
- on `documentloaded`, call `setDocument(PDFViewerApplication.pdfDocument)`;
- if Comments only remains checked after reload, rerun the current query against the new document.

The checkbox starts unchecked when the viewer is first created. A same-webview PDF reload may preserve the user's checked state, but must never preserve the old index.

### 10.3 Search request generations

Every input/options/navigation request receives a monotonically increasing request ID. After awaiting the index, compare:

- request ID;
- document generation;
- current `PDFDocumentProxy` identity;
- current Comments-only checkbox state.

Only the latest valid request may update matches, navigation, or the Find UI. This prevents fast typing and PDF reloads from displaying stale results.

## 11. Search semantics

### 11.1 Matching

Use literal substring matching only:

```js
const needle = caseSensitive ? query : query.toLowerCase();
const haystack = caseSensitive ? comment.text : comment.text.toLowerCase();
const matched = haystack.includes(needle);
```

Do not interpret regex characters.

An empty query produces:

- `matches = []`;
- `currentIndex = -1`;
- no navigation;
- no Not Found indication;
- an empty result counter.

### 11.2 New query or Match Case change

When the query or Match Case value changes:

1. update the UI to Pending while the index is unavailable;
2. filter the comment index;
3. set `currentIndex` to `0` when results exist, otherwise `-1`;
4. update the counter;
5. navigate to the first result when one exists.

### 11.3 Next and Previous

For existing matches:

```js
nextIndex = (currentIndex + 1) % matches.length;
previousIndex = (currentIndex - 1 + matches.length) % matches.length;
```

The controller must report a wrapped UI state when crossing the bottom or top so PDF.js can reuse its existing localized wrap message.

### 11.4 Unsupported existing options in comment mode

Phase 1 does not define annotation rendering for Highlight All and does not require Match Diacritics or Entire Word.

While Comments only is checked:

- leave Match Case enabled;
- disable Highlight All;
- disable Match Diacritics;
- disable Entire Word unless it is implemented and tested without copying substantial PDF.js internals;
- preserve each checkbox's checked state while disabled;
- restore the controls immediately when Comments only is unchecked.

This avoids presenting enabled controls that silently do nothing. All options retain their original behavior in normal document-search mode.

## 12. Find bar UI integration

### 12.1 Checkbox creation

After `PDFViewerApplication.initializedPromise` resolves:

1. get `PDFViewerApplication.findBar`;
2. get `#findbarOptionsOneContainer`;
3. create a wrapper using the existing `toggleButton toolbarLabel` classes;
4. create an unchecked checkbox with ID `findCommentsOnly`;
5. create a `<label for="findCommentsOnly">Comments only</label>`;
6. insert it before the existing options without redesigning the bar;
7. assign the element to `findBar.commentsOnly` for discoverability by the custom integration layer.

Do not add a new toolbar, sidebar, popover, or panel.

### 12.2 Accessibility

- Use a real checkbox and associated label.
- Preserve normal Tab navigation.
- Add a local Enter-key handler for the new checkbox because the upstream `PDFFindBar` captured its known-checkbox map before this checkbox was injected.
- The Enter handler must toggle once, emit one `change`, prevent default, and stop immediate propagation.
- Do not interfere with Escape, which must continue closing the Find bar.

Localization of the new English label is not required in Phase 1. Adding strings to every bundled PDF.js locale would create disproportionate patch maintenance. The control must still have a readable label and accessible name.

## 13. Search routing implementation

### 13.1 Wrap `findBar.dispatchEvent`

Save the bound native method:

```js
const dispatchDocumentFind = findBar.dispatchEvent.bind(findBar);
```

Replace the instance method with a router:

```js
findBar.dispatchEvent = (type, findPrevious = false) => {
  if (!commentsOnly.checked) {
    dispatchDocumentFind(type, findPrevious);
    return;
  }

  commentSearch.handleFind({
    type,
    query: findBar.findField.value,
    caseSensitive: findBar.caseSensitive.checked,
    findPrevious,
  });
};
```

Do not dispatch the standard `find` event in the comment branch.

### 13.2 Enter, Shift+Enter, Previous, and Next

No new listeners are needed for the existing search input or buttons. Their upstream listeners call `this.dispatchEvent(...)`, which is routed by the wrapped instance method.

Required mapping:

- input change: new comment search;
- Enter: next comment result;
- Shift+Enter: previous comment result;
- Previous button: previous comment result;
- Next button: next comment result;
- Match Case click: rebuild matches from the existing annotation index.

### 13.3 Cmd/Ctrl+G

PDF.js handles Cmd/Ctrl+G outside `PDFFindBar.dispatchEvent()` and directly dispatches a native `find` event based on `PDFFindController.state`.

Add a capture-phase keydown handler in `assets/main.mjs` that activates only when Comments only is checked:

- Cmd+G or Ctrl+G: comment Next;
- Shift+Cmd+G or Shift+Ctrl+G: comment Previous;
- call `preventDefault()` and `stopImmediatePropagation()`;
- do not intercept Cmd/Ctrl+F;
- do not alter shortcuts while Comments only is unchecked.

### 13.4 Switching Comments only on

On the checkbox `change` event when checked:

1. disable unsupported option controls;
2. dispatch `findbarclose` directly on the PDF.js EventBus without closing the visible Find bar;
3. clear native text-layer highlights and cancel the native controller's pending debounce;
4. suppress later native result-count/UI updates while comment mode is active;
5. run the current query through `CommentSearchController`.

### 13.5 Switching Comments only off

On the checkbox `change` event when unchecked:

1. invalidate any pending comment-search UI request;
2. clear comment matches and selection;
3. restore the disabled option controls;
4. stop suppressing native Find UI updates;
5. call the saved original `dispatchDocumentFind("")` using the current query and current native option values.

The final step re-enters the existing PDF.js path and restores normal document matching/highlighting without duplicating its logic.

## 14. Prevent stale document-search UI from overwriting comment results

Dispatching `findbarclose` cancels the normal debounce and disables text-layer highlighting, but page text extraction or match calculations already in progress may still emit result-count events.

To preserve strict search-mode separation:

1. save bound references to `findBar.updateUIState` and `findBar.updateResultsCount` before wrapping them;
2. wrap the public instance methods;
3. while Comments only is checked, ignore native calls reaching those wrappers;
4. give `CommentSearchController` callbacks that invoke the saved original methods directly;
5. when Comments only is unchecked, pass all calls through unchanged.

Conceptual setup:

```js
const updateNativeUIState = findBar.updateUIState.bind(findBar);
const updateNativeResultsCount = findBar.updateResultsCount.bind(findBar);

findBar.updateUIState = (...args) => {
  if (!commentsOnly.checked) {
    updateNativeUIState(...args);
  }
};

findBar.updateResultsCount = (...args) => {
  if (!commentsOnly.checked) {
    updateNativeResultsCount(...args);
  }
};
```

The comment controller must call `updateNativeUIState`/`updateNativeResultsCount`, not the wrapped methods.

PDF.js 6.2.108 uses these Find states:

```js
const FIND_STATE = Object.freeze({
  FOUND: 0,
  NOT_FOUND: 1,
  WRAPPED: 2,
  PENDING: 3,
});
```

Keep this compatibility constant next to the UI adapter, label it with the pinned PDF.js version, and cover it with a repository verification assertion or an upgrade checklist entry. Do not modify PDF.js only to export the enum.

## 15. Result counter and status behavior

Reuse the saved native `findBar.updateUIState()` and `findBar.updateResultsCount()` methods so the existing counter, Not Found state, accessibility attributes, and localized wrap messages remain visually consistent.

Required states:

| Condition                    | Find state | Counter                                    |
| ---------------------------- | ---------- | ------------------------------------------ |
| Empty query                  | FOUND      | empty                                      |
| Index building               | PENDING    | empty                                      |
| Matches found                | FOUND      | `current / total` through existing l10n UI |
| No matches                   | NOT_FOUND  | empty                                      |
| Next wraps bottom to top     | WRAPPED    | wrapped current/total                      |
| Previous wraps top to bottom | WRAPPED    | wrapped current/total                      |

Disable Previous and Next only while the first comment index is pending. Restore them after the latest valid request completes. Do not leave normal-search buttons disabled after exiting comment mode.

## 16. Navigation

### 16.1 Normal path

For a valid rectangle:

```js
const match = this.matches[this.currentIndex];

PDFViewerApplication.pdfLinkService.goToXY(match.pageIndex + 1, match.rect[0], match.rect[3], {
  center: "both",
});
```

This mirrors PDF.js's existing comment navigation behavior and handles page change plus scroll positioning.

### 16.2 Fallback path

If `rect` is absent or invalid:

```js
PDFViewerApplication.pdfLinkService.goToPage(match.pageIndex + 1);
```

Do not discard a searchable comment only because precise coordinates are unavailable.

### 16.3 Selection boundary

Do not attempt to call private `CommentManager`, `CommentSidebar`, annotation-layer, or editor-layer methods. Navigation alone satisfies Phase 1.

## 17. Error handling

- No PDF loaded: clear comment matches and show no result count.
- Page acquisition failure: warn with page number and continue.
- Annotation acquisition failure: warn with page number and continue.
- Stale document generation: silently discard results.
- Stale query request: silently discard UI/navigation updates.
- Navigation with invalid page index: do not navigate and log a warning.
- Navigation with invalid rectangle: use page-only fallback.
- Index build failure outside a per-page failure: clear Pending state, show Not Found/empty results, and log the error without affecting normal document search.

Never display annotation contents in console errors or telemetry.

## 18. Automated test plan

Create fake PDF document/page objects; do not implement or import a PDF parser.

### 18.1 Extraction tests

- Text annotation with `contentsObj.str` is indexed.
- Highlight annotation with comment content is indexed.
- Underline annotation with comment content is indexed.
- StrikeOut annotation with comment content is indexed.
- FreeText annotation with comment content is indexed.
- Unknown subtype with non-empty comment content is indexed.
- Popup with content is ignored.
- Empty annotation is ignored.
- Whitespace-only annotation is ignored.
- Non-empty `richText.str` takes priority over `contentsObj.str`.
- Empty/whitespace `richText.str` falls back to `contentsObj.str`.
- Author exists in the index but does not affect matching.
- Highlighted source-text-like fields do not affect matching.

### 18.2 Search tests

- Default matching is case-insensitive substring matching.
- Match Case enforces exact case.
- Regex-looking input is treated literally.
- Empty query returns no matches and no selection.
- One comment containing the query twice counts as one result.
- Result order follows page and returned annotation order.

### 18.3 Navigation tests

- Initial result is index 0.
- Next advances one result.
- Previous moves back one result.
- Next wraps from last to first.
- Previous wraps from first to last.
- Valid rectangle calls coordinate navigation with `pageIndex + 1`, `rect[0]`, and `rect[3]`.
- Invalid rectangle calls page-only navigation.

### 18.4 Index lifecycle tests

- Multiple searches of the same PDF build the index once.
- Match Case changes do not rebuild the annotation index.
- `setDocument(newDocument)` clears all old state.
- An old delayed build cannot update state after a new document is set.
- A stale query cannot overwrite a newer query.
- One rejected page does not discard other pages' comments.

## 19. Manual acceptance plan

Use a real PDF containing at least:

- one sticky-note comment;
- one Highlight with comment content;
- one Underline or StrikeOut with comment content;
- one FreeText annotation;
- a parent annotation plus Popup representation;
- document-body text that overlaps with one search term but is not present in any comment.

### 19.1 Baseline document search

1. Open the PDF.
2. Confirm Comments only is unchecked.
3. Search a known body-text phrase.
4. Verify normal counter, Previous, Next, Highlight All, Match Case, Match Diacritics, and Entire Word.
5. Confirm behavior matches the unmodified extension.

### 19.2 Comment-only matching

1. Check Comments only.
2. Search `confirm` where two annotation comments contain the word.
3. Verify the result count is `1 / 2` through the existing Find UI.
4. Verify the first match navigates to the first annotation page/location.
5. Select Next and verify navigation to the second annotation.
6. Select Next again and verify wrap-around.
7. Select Previous and verify reverse wrap-around.

### 19.3 Source text exclusion

1. Find a Highlight annotation whose source text differs from its comment.
2. Search a phrase that exists only in the highlighted PDF text.
3. Verify Comments only reports no match.
4. Search a phrase in the attached comment.
5. Verify the annotation is found.

### 19.4 Body text exclusion

1. Search `denominator` where page 18 has a matching comment and page 35 has matching body text.
2. Verify Comments only returns only the page 18 annotation.
3. Uncheck Comments only.
4. Verify the normal search finds document-body occurrences according to PDF.js behavior.

### 19.5 Case behavior

1. Search a lowercase form with Match Case off and confirm a mixed-case comment is found.
2. Turn Match Case on.
3. Verify incorrect-case input is not found.
4. Verify exact-case input is found.

### 19.6 Mode-switch race test

1. Start a broad normal body-text search in a long PDF.
2. Immediately enable Comments only and enter a comment query.
3. Wait for all background work to settle.
4. Verify no body-text counter or highlight reappears.
5. Disable Comments only.
6. Verify normal search resumes using the current query.

### 19.7 Reload test

1. Build the comment index by performing a comment search.
2. Trigger the extension's existing PDF reload path.
3. Verify the index is rebuilt for the reloaded `PDFDocumentProxy`.
4. Verify old match objects cannot navigate or update the counter.
5. Verify the viewer restores the current page according to existing reload behavior.

### 19.8 Keyboard and accessibility test

1. Reach Comments only using Tab.
2. Toggle it with Space and Enter, one state change per key press.
3. Use Enter/Shift+Enter in the search input.
4. Use Cmd/Ctrl+G and Shift+Cmd/Ctrl+G.
5. Verify Escape still closes the Find bar.
6. Verify the checkbox has a readable accessible label.

## 20. Build and packaging verification

Run from `/Users/fk/docker/vscode-pdf`:

```bash
pnpm run test:comment-search
pnpm run check
pnpm run package
```

Then package the VSIX using the repository's normal packaging workflow and verify that it contains:

```text
assets/main.mjs
assets/comment-search.mjs
assets/main.css
assets/pdf.js/web/viewer.mjs
```

Launch an Extension Development Host or install the VSIX into a clean VS Code profile and repeat the high-value manual acceptance cases. A successful Node test or TypeScript build alone does not validate the VS Code webview, real PDF annotation data, or navigation behavior.

## 21. Acceptance criteria

Implementation is complete only when all of the following are true:

- [ ] The existing Find bar contains one unchecked `Comments only` checkbox.
- [ ] Unchecked mode uses the original `PDFFindBar` and `PDFFindController` path.
- [ ] Checked mode does not dispatch new native document-text searches.
- [ ] Checked mode searches all non-Popup annotations with non-empty comment content regardless of markup subtype.
- [ ] Rich text is preferred only when non-empty; otherwise plain contents are used.
- [ ] Highlighted source text and document body text are excluded.
- [ ] Match Case works.
- [ ] Previous and Next wrap.
- [ ] Counter/status use the existing Find UI.
- [ ] Each matching annotation counts once.
- [ ] Navigation reaches the page and annotation rectangle, with page fallback.
- [ ] The index is built at most once per current PDF and never on each keystroke.
- [ ] Reloading/replacing the PDF invalidates the old index and asynchronous results.
- [ ] Pending native search work cannot overwrite comment-mode UI or highlights.
- [ ] Unsupported controls are disabled only while comment mode is active.
- [ ] Cmd/Ctrl+G follows the active search mode.
- [ ] No annotation content is persisted, transmitted, or logged.
- [ ] No generated PDF.js file or patch was changed unless a separately documented blocker required it.
- [ ] Automated checks, VSIX packaging, and real-PDF manual acceptance pass.

## 22. Known Phase 1 limitations

- Results represent matching comment annotations, not every occurrence inside a comment.
- Match Diacritics is not supported in Comments-only mode.
- Entire Word is not supported unless it is implemented and explicitly tested during Phase 1.
- Highlight All does not apply to annotations.
- Navigation does not guarantee visual selection or opening of the annotation popup.
- The first Comments-only search waits for the complete in-memory annotation index.
- Annotation changes made after index construction are not reflected until the PDF is reloaded/reopened.
- Same-page ordering follows PDF.js annotation order rather than geometric order.
- The new English label is not added to every bundled PDF.js locale in Phase 1.

These limitations must not affect normal document search when Comments only is unchecked.

## 23. Rollback plan

Because the planned implementation stays outside generated PDF.js assets, rollback is limited to:

1. remove `assets/comment-search.mjs`;
2. remove the Comments-only setup/routing code from `assets/main.mjs`;
3. remove any feature-specific `assets/main.css` rules;
4. remove the focused test script/test file;
5. rerun `pnpm run check` and package verification.

No PDF migration, cache cleanup, database rollback, or saved-document repair is required.

## 24. Required completion report

After implementation, report:

1. every file changed and the purpose of each change;
2. whether `patches/pdf.js.patch` changed and why;
3. how index construction is cached and invalidated;
4. how native Find events are prevented in Comments-only mode;
5. how stale native and comment searches are isolated;
6. search semantics and result-count semantics;
7. navigation behavior and rectangle fallback;
8. unsupported/disabled controls and Phase 1 limitations;
9. automated commands run and their exact results;
10. real-PDF/VS Code manual flows actually validated;
11. any remaining target-environment acceptance work.

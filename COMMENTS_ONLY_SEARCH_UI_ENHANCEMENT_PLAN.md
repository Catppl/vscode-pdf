# PDF Search UI Enhancement — Construction Plan

## 1. Document status

- Status: implemented locally; automated checks passed; real VS Code Webview acceptance pending
- Target repository: `/Users/fk/docker/vscode-pdf`
- Target PDF.js: `6.2.108`
- Target VS Code compatibility: `1.133` and later versions allowed by the current extension manifest
- Governing base plan: `COMMENTS_ONLY_SEARCH_IMPLEMENTATION_PLAN.md`
- Nature of this document: an approved-scope addendum for search highlighting, result counts, and a clickable comment-result list
- The implementation is present in the working tree, but the feature is not release-accepted until the manual Webview and VS Code 1.133 checks in Section 7 pass.

This addendum supersedes only the following Phase 1 exclusions in the base plan:

- custom visual indication for the currently selected annotation result;
- an annotation-search result list shown in a temporary right-side viewer
  panel while Comments only search is active.

All other boundaries and compatibility requirements in the base plan remain in force.

## 2. Requested outcome

Implement the following three improvements without redesigning the PDF viewer:

1. Make search results immediately visible with a bright-yellow treatment.
2. Always show the current result and total result count, for example `1 / 20`.
3. When `Comments only` is enabled, provide a compact list of all matching comments so the user can click any result and navigate to it.

The intended Find UI is:

```text
Search: [________________________]  [Previous] [Next]  1 / 20

[x] Comments only
[ ] Highlight All   [ ] Match Case   [ ] Match Diacritics   [ ] Entire Word

[Show comment results]
+--------------------------------------------------------+
| 1   Page 16 · FreeText                                |
|     ... VSTESTCD when VSTESTCD="TEMP" ...             |
|                                                        |
| 2   Page 23 · FreeText                                |
|     ... verify VSTESTCD before submission ...         |
+--------------------------------------------------------+
```

The result list is a collapsible, right-side overlay panel mounted in the existing
viewer shell. It is not a permanent sidebar, a new viewer page, or an
annotation-management interface.

## 3. Fixed behavior and counting semantics

### 3.1 Comments only unchecked

- Continue to route the query through the original `PDFFindBar.dispatchEvent()` and `PDFFindController`.
- Preserve Highlight All, Match Case, Match Diacritics, Entire Word, Previous, Next, wrapping, and keyboard behavior.
- Change only the visual colors of the native PDF.js text-layer matches.
- Continue to use the native PDF.js result counter.
- Do not show the new comment-result panel.

### 3.2 Comments only checked

- Route the query only through `CommentSearchController`.
- Do not dispatch a native PDF.js `find` event.
- Count one matching annotation as one result.
- If a query occurs multiple times in one annotation comment, that annotation still contributes one result.
- Display `current / total`, where `current` is the selected annotation's one-based index in the result array.
- Show one list row for each matching annotation.
- Previous, Next, Enter, Shift+Enter, Cmd/Ctrl+G, and list-row clicks must all update the same current index.
- Keep Highlight All, Match Diacritics, and Entire Word disabled in this mode. Match Case remains available.

Example: if 20 annotations contain `confirm`, the count is `1 / 20`, even if one of those comments contains the word three times.

## 4. Current implementation findings

The existing implementation already has the correct high-level routing and annotation-index separation:

- `assets/main.mjs` wraps `findBar.dispatchEvent()`.
- Native document search is used only when `Comments only` is unchecked.
- `assets/comment-search.mjs` builds and caches an annotation index through `getAnnotations({ intent: "display" })`.
- `Popup` annotations are ignored.
- Comment text comes from non-empty `richText.str`, falling back to `contentsObj.str`.
- `CommentSearchController` already calculates `{ current, total }` and supports wrapping.
- Navigation already uses `pdfLinkService.goToXY()` with a page fallback.

The installed VS Code Webview uses a resource host such as
`file+.vscode-resource.vscode-cdn.net`. That host is valid for loading Webview
resources, but Chromium rejects it as a CSP host-source because `+` is not
valid in a DNS label. Adding its `URL.origin` to CSP therefore produces
`invalid source` warnings and does not fix the PDF.js worker. The worker must
instead be fetched through the existing Webview resource policy and started
from a same-Webview `blob:` URL.

The missing comment-mode counter has a specific cause in `assets/main.mjs`:

```js
findBar.updateResultsCount = (matchesCount) => {
  if (!commentsOnly.checked) {
    updateNativeResultsCount(matchesCount);
  }
};
```

`CommentSearchController` calls the captured native `updateUIState()`, but that method internally calls `this.updateResultsCount()`. The wrapper above then suppresses the count because `Comments only` is checked.

This must be repaired without allowing delayed native document-search events to overwrite the comment count.

## 5. Approved implementation architecture

```text
Existing Find bar
        |
        +-- Comments only OFF
        |       |
        |       +-- native PDFFindController
        |       +-- native result counter
        |       +-- bright-yellow native text-layer highlights
        |
        +-- Comments only ON
                |
                +-- CommentSearchController
                        |
                        +-- cached annotation index
                        +-- enriched result records
                        +-- current/total state
                        +-- Previous/Next/list selection
                        |
                        +-- CommentSearchUI
                                +-- native Find counter adapter
                                +-- collapsible results panel
                                +-- selected-row state
                                +-- transient annotation highlight
```

The search controller remains responsible for data and navigation state. DOM rendering and temporary highlighting stay in a small UI helper rather than being mixed into annotation extraction.

## 6. Files to add or modify

### 6.1 Modify `assets/comment-search.mjs`

Purpose: enrich matching records and expose a safe way to select a result from the list.

Required changes:

1. Add a pure helper that finds the first substring match while respecting Match Case.

   Suggested signature:

   ```js
   export function findCommentMatch(text, query, caseSensitive = false) {
     // Return { start, length } or null.
   }
   ```

2. Add a pure snippet builder.

   Suggested signature:

   ```js
   export function buildCommentSnippet(text, start, length, contextLength = 60) {
     // Return snippet text and the match range inside the snippet.
   }
   ```

3. Replace the current `comments.filter(...)` result construction with `comments.flatMap(...)` or an equivalent loop that creates result records.

   Search-result shape:

   ```js
   {
     ...comment,
     matchStart,
     matchLength,
     snippet,
     snippetMatchStart,
   }
   ```

4. Keep the underlying comment index unchanged. Match metadata belongs only to the current query result array.

5. Add a public result-selection method:

   ```js
   select(index) {
     // Validate the integer and range.
     // Update currentIndex.
     // Emit the same UI state as Previous/Next.
     // Navigate to the selected annotation.
     // Return true when selected, false for invalid input.
   }
   ```

6. Extend `#emitUI()` so the UI callback receives enough state for both the native counter and the list:

   ```js
   this.#updateUI({
     state,
     previous,
     matchesCount: { current, total },
     matches: this.#matches,
     currentIndex: this.#currentIndex,
     query: this.#lastQuery,
   });
   ```

7. Do not expose mutable index data as a supported external API. The UI may receive a read-only snapshot or a copied array when needed.

8. Preserve document-generation and request-ID checks so an old PDF or an old asynchronous query cannot repopulate the panel.

### 6.2 Add `assets/comment-search-ui.mjs`

Purpose: isolate new DOM behavior from search/index logic and keep `assets/main.mjs` focused on PDF.js wiring.

Recommended exports:

```js
export function createCommentResultsPanel(options) {}
export function createCommentMatchHighlighter(options) {}
```

#### Result panel responsibilities

- Inject one panel into the existing `#outerContainer` after viewer
  initialization. Position it on the right below the toolbar; do not modify the
  PDF.js Views Manager or create a second permanent sidebar.
- Use feature-specific IDs/classes such as:

  ```text
  #findCommentResultsPanel
  #findCommentResultsSummary
  #findCommentResultsList
  .commentSearchResult
  .commentSearchResultCurrent
  .commentSearchSnippetHit
  ```

- Default state: hidden.
- Show only when all of the following are true:
  - `Comments only` is checked;
  - the query is non-empty;
  - index construction is no longer pending.
- Show a compact empty state when the query has no results.
- Header text should contain the same count as the native counter, for example `Comment results — 1 / 20`.
- Each row must show:
  - one-based physical PDF page number (`pageIndex + 1`);
  - annotation subtype;
  - a text snippet around the first match;
  - bright-yellow `<mark>` only around the matching substring.
- Build row content with DOM nodes and `textContent`. Never insert annotation text through `innerHTML`.
- Set `data-result-index` on each row and call `CommentSearchController.select(index)` when clicked.
- Give rows keyboard behavior:
  - Enter or Space selects the focused row;
  - Arrow Up/Down moves focus within the list;
  - Escape collapses the panel and returns focus to the search field.
- Apply `aria-current="true"` to the selected row.
- Use an `aria-live="polite"` summary for count changes, but do not announce every list row.
- After Previous/Next or a list click, call `scrollIntoView({ block: "nearest" })` only on the result-list row, not on the whole Find bar.

#### Large result sets

For the initial implementation, create rows with one `DocumentFragment` and render the complete list. This is acceptable for the known `blankcrf.pdf` result volume.

Add a guarded threshold such as 500 results:

- below the threshold: render every row immediately;
- above the threshold: render in fixed-size batches as the user scrolls;
- never truncate the logical result set or display a false total;
- do not add a third-party virtualization dependency.

#### Annotation highlighter responsibilities

- Maintain at most one active annotation-result highlight.
- After navigation, wait for the matching page's `annotationlayerrendered` event when necessary.
- Locate the annotation with:

  ```js
  pageView.div.querySelector(`[data-annotation-id="${CSS.escape(String(match.id))}"]`);
  ```

- Search only within that annotation element's visible text nodes.
- When the query maps cleanly to one or more text nodes, wrap only the matching substring with:

  ```html
  <mark class="commentSearchAnnotationHit">...</mark>
  ```

- If a match spans multiple text nodes, wrap the relevant portion of each node.
- If the annotation DOM does not expose matching text, apply `.commentSearchAnnotationTarget` to the whole annotation element as a fallback.
- Store cleanup callbacks instead of rewriting the page's `innerHTML`.
- Remove the previous highlight before selecting another result.
- Clear on query changes, mode changes, `pagesdestroy`, page rerender, zoom/rotation rerender, and document replacement.
- Never write to `annotationStorage` and never change annotation data.

### 6.3 Modify `assets/main.mjs`

Purpose: connect PDF.js, `CommentSearchController`, and the new UI helper.

Required changes:

1. Import the new UI helpers.

2. Create the result panel and highlighter inside `installCommentSearch()` after the Find bar has been resolved.

3. Fix the result-count gate with an explicit source guard.

   Suggested pattern:

   ```js
   let renderingCommentUI = false;

   const renderCommentFindState = (state, previous, matchesCount) => {
     renderingCommentUI = true;
     try {
       updateNativeUIState(state, previous, matchesCount);
     } finally {
       renderingCommentUI = false;
     }
   };

   findBar.updateResultsCount = (matchesCount) => {
     if (!commentsOnly.checked || renderingCommentUI) {
       updateNativeResultsCount(matchesCount);
     }
   };
   ```

4. Keep the existing `findBar.updateUIState` guard for delayed native controller events while comment mode is active.

5. Change the controller's `updateUI` callback to:

   - call `renderCommentFindState(...)`;
   - render or update the comment-result panel;
   - synchronize the selected row;
   - clear the annotation highlight when no current result exists.

6. Change the navigation callback so it performs these operations in order:

   1. call `goToXY()` or the current page fallback;
   2. request highlighting of that annotation after its annotation layer is available;
   3. synchronize the current list row.

7. On `Comments only` enable:

   - keep disabling unsupported controls;
   - clear native body-text highlights through the existing native Find close/reset path;
   - run the current comment query;
   - open the result panel when the query is non-empty.

8. On `Comments only` disable:

   - cancel the comment request;
   - hide and clear the comment-result panel;
   - remove the transient annotation highlight;
   - restore disabled option states;
   - route the existing query back through native document search.

9. On `pagesdestroy` and `documentloaded`, reset the panel, highlighter, count, and controller together. Never display results from the previously opened PDF.

10. Do not add an `eventBus.on("find")` route for comment search. Native internal listeners run before external listeners, so that approach cannot cancel document search.

### 6.4 Modify `assets/main.css`

Purpose: improve native text-search visibility and style the comment UI without changing generated PDF.js CSS.

`main.css` is loaded after `viewer.css`, so use narrowly scoped overrides rather than modifying `assets/pdf.js/web/viewer.css`.

#### Native document-search colors

Add overrides equivalent to:

```css
.textLayer .highlight {
  --highlight-bg-color: rgb(255 242 0 / 0.72);
  --highlight-selected-bg-color: rgb(255 214 0 / 0.95);
}

.textLayer .highlight.selected {
  outline: 2px solid rgb(174 112 0);
  outline-offset: 1px;
}
```

The exact alpha may be adjusted during visual acceptance, but the hue must remain bright yellow and readable in both light and dark VS Code themes.

#### Comment match colors

Add scoped rules for:

```css
#findbar .commentSearchSnippetHit,
.annotationLayer .commentSearchAnnotationHit {
  background: #fff200;
  color: #111;
}

.annotationLayer .commentSearchAnnotationTarget {
  outline: 3px solid #fff200;
  outline-offset: 2px;
  box-shadow: 0 0 0 2px rgb(255 194 0 / 0.65);
}
```

Do not use `opacity` on the entire annotation because that would also fade its text.

#### Panel layout

- Scope every rule under `#findCommentResultsPanel` or another
  feature-specific class.
- Use the existing PDF.js/VS Code foreground, border, and toolbar variables where available.
- Set the panel below the toolbar with a bounded width and full available
  viewer height; keep the header and count fixed.
- Use `overflow-y: auto` on the result list only, so the result page scrolls
  independently of the PDF canvas.
- Keep the panel above the PDF canvas in the existing viewer shell stacking
  context, aligned to the right edge.
- Add a narrow-window rule so the panel width does not exceed the viewer
  viewport.
- Give the current row a visible selected state separate from the yellow keyword mark.
- Do not alter global `.highlight`, `mark`, `.annotationLayer`, or toolbar rules without feature scoping.

#### High-contrast mode

Add an explicit `@media (forced-colors: active)` block:

- use system `Highlight` and `HighlightText` colors;
- preserve an outline around the active annotation;
- do not force fixed yellow where the operating system requires forced colors.

### 6.5 Modify `tools/comment-search.test.mjs`

Add automated coverage for controller and pure helper behavior:

1. case-insensitive match range;
2. Match Case match range;
3. no match returns `null`;
4. snippet at the beginning, middle, and end of comment text;
5. snippet match offsets remain correct after adding ellipses;
6. one annotation containing the query multiple times still counts once;
7. `select(index)` updates `{ current, total }` and navigates to the selected annotation;
8. negative, fractional, and out-of-range selection indices are rejected;
9. Previous/Next and direct selection share the same current index;
10. stale document searches cannot repopulate the list or counter;
11. empty query clears matches and panel state;
12. a result with `id: null` still navigates by rectangle/page and uses whole-annotation fallback highlighting.

Keep the existing Node test runner. Do not add JSDOM or another test dependency solely for this feature. DOM rendering and PDF.js annotation-layer timing must be covered by manual Webview acceptance.

### 6.6 Modify `tools/check_pdfjs.mjs`

Add lightweight static guards for assumptions the implementation depends on:

- `main.css` remains loaded after PDF.js `viewer.css` in `src/pdf-viewer-provider.ts`;
- the generated PDF.js bundle still contains `data-annotation-id` support;
- the bundle still dispatches `annotationlayerrendered`;
- the Find-state numeric mapping remains unchanged;
- the comment-search UI module is referenced by `assets/main.mjs`.

These checks detect PDF.js upgrade drift but do not replace UI acceptance.

### 6.7 Modify `src/pdf-viewer-provider.ts`

Purpose: keep the Webview CSP compatible with VS Code resource hosts while
allowing the blob-backed PDF.js worker.

Required changes:

1. Keep the existing `webview.cspSource` allow-list and `blob:` in
   `worker-src`.
2. Do not add the literal `URL.origin` of a `file+...` resource URI to CSP;
   Chromium treats it as an invalid source.
3. Let `assets/main.mjs` fetch the worker through the existing local-resource
   policy and create the same-Webview blob Worker before `PDFViewerApplication.open()`.
4. Do not add `*`, arbitrary `https:`, or an unbounded remote origin.
5. Set PDF.js `useWorkerFetch: false` so CMaps, fonts, and WASM are fetched by
   the main Webview and transferred to the Worker; the `file+` Webview resource
   host cannot be used for Worker-side module/WASM fetches.

This avoids the cross-origin dynamic-import failure while preserving the
existing `default-src 'none'`, `base-uri 'none'`, and `form-action 'none'`
restrictions.

### 6.8 `package.json`

No dependency or VS Code engine change is planned.

- Keep `engines.vscode` compatible with company VS Code `1.133`.
- Keep the existing `test:comment-search` script if all pure tests remain in `tools/comment-search.test.mjs`.
- If a separate pure-helper test file is added, update the script to include it without adding a new test framework.

### 6.9 `patches/pdf.js.patch`

No PDF.js patch is planned for this enhancement.

The required native highlight colors can be overridden safely in `assets/main.css`, which is loaded after the generated PDF.js stylesheet. This is smaller and avoids modifying generated assets.

If CSS override order is later proven insufficient, stop and document the evidence before changing the patch workflow. Do not directly hand-edit `assets/pdf.js/web/viewer.css` as an unmanaged change.

## 7. Ordered construction steps

### Step 1 — Lock the baseline

Before editing:

1. record `git status --short`;
2. preserve all existing uncommitted user changes;
3. run the current focused comment-search tests;
4. verify the existing extension version, VS Code engine range, and PDF.js version;
5. confirm `blankcrf.pdf` is available for manual acceptance.

Do not reset or replace the current working tree.

### Step 2 — Extend the controller result model

Implement match ranges, snippets, and direct result selection in `assets/comment-search.mjs`. Complete and pass pure unit tests before adding DOM UI.

Acceptance for this step:

- query results remain in document/page annotation order;
- counts remain annotation counts;
- Match Case and wrapping are unchanged;
- no extra annotation read occurs per keystroke.

### Step 3 — Repair comment count rendering

Implement the `renderingCommentUI` source guard in `assets/main.mjs`.

Acceptance for this step:

- comment mode displays `1 / N` after the first match;
- Next and Previous update the count;
- no result displays `0 / 0` internally but leaves the native count label empty, matching PDF.js behavior;
- delayed native results cannot replace the comment count;
- disabling comment mode restores native count behavior.

This repair should be completed before the result panel, because the panel must use the same controller state and count semantics.

### Step 4 — Add bright-yellow native highlighting

Add the native `.textLayer .highlight` overrides to `assets/main.css` and verify normal PDF body search in light, dark, and high-contrast modes.

Do not change search matching or text extraction in this step.

### Step 5 — Add the comment-result panel

Create `assets/comment-search-ui.mjs`, inject the panel, render safe snippets, wire list selection, synchronize the active row, and implement keyboard accessibility.

The panel must initially be collapsible. It should automatically open for a non-empty comment query, while the user may collapse it without disabling search. Its right-side position is an overlay layout change only; it must not alter PDF.js page/sidebar sizing.

### Step 6 — Add current-annotation highlighting

Implement exact text-node marking when possible and the whole-annotation outline fallback. Test FreeText, sticky-note Text, Highlight-with-comment, Underline, and StrikeOut annotations where fixtures are available.

Do not block navigation if highlighting fails. Navigation and count are the required behavior; exact word decoration has a documented fallback.

### Step 7 — Add lifecycle cleanup

Verify cleanup on:

- query replacement;
- Next/Previous;
- list selection;
- mode disable;
- Find bar close;
- PDF replacement/reload;
- page rerender after zoom or rotation;
- Webview disposal.

No detached event listener, obsolete result panel, or stale highlight may remain.

### Step 8 — Add regression checks

Run:

```text
pnpm run test:comment-search
pnpm run check:pdfjs
pnpm run typecheck
pnpm run lint
```

Then run the repository's complete check and record any pre-existing unrelated failure separately. A targeted test pass is not sufficient to claim Webview acceptance.

### Step 9 — Manual Webview acceptance

Install the generated VSIX into a clean VS Code Extension Development Host or a test profile and exercise the real PDF Webview.

Required fixture:

```text
/Users/fk/Downloads/blankcrf.pdf
```

Required checks:

1. Open the PDF and confirm all pages render.
2. With `Comments only` unchecked, search a known document-body word:
   - normal PDF text is found;
   - matches are bright yellow;
   - the selected match is more prominent;
   - native `current / total` works;
   - Highlight All, Match Case, Match Diacritics, and Entire Word remain functional.
3. Enable `Comments only` and search `vstestcd`:
   - no native body-text search is run;
   - a nonzero `1 / N` count appears;
   - the comment-result panel contains the same number of logical results;
   - list rows include FreeText results and physical PDF page numbers;
   - clicking the page 23 result navigates to physical page 23;
   - the matching word is bright yellow when its DOM text is available;
   - otherwise the target annotation has a bright-yellow outline.
4. Press Next and Previous:
   - page, current count, active row, and visual highlight move together;
   - wrapping updates the PDF.js wrapped-state message correctly.
5. Test Match Case in comment mode.
6. Clear the query and confirm the list, count, and annotation highlight clear.
7. Disable `Comments only` and confirm native body search resumes with no comment result leakage.
8. Reload the PDF and open a different PDF; confirm no stale index or results remain.
9. Repeat the installation check on company VS Code `1.133` before release acceptance.

## 8. Error handling and fallback rules

- If one PDF page fails during annotation indexing, log a warning and continue with remaining pages, matching the existing controller behavior.
- If an annotation has no valid rectangle, navigate to its page.
- If an annotation has no usable DOM ID, retain navigation and result-row selection but skip exact DOM highlighting.
- If the annotation layer is not yet rendered, wait for the matching `annotationlayerrendered` event with a bounded attempt; do not poll indefinitely.
- If the page rerenders while highlighted, reapply only when the same result is still current.
- If the query changes while index construction or rendering is pending, discard work associated with the old request ID.
- Annotation text is untrusted content. Use `textContent`, never `innerHTML`.
- UI/highlight failures must not prevent search, counting, Previous/Next, or navigation.

## 9. Explicit construction boundaries

The following remain out of scope:

- a permanent sidebar;
- a new full-page search route;
- a general annotation browser or comment manager;
- annotation creation, editing, deletion, reply, or save changes;
- searching author, date, subject, subtype, or highlighted source text;
- merging comment text into PDF.js `_pageContents`;
- modifying `PDFFindController` matching internals;
- showing a body-text result-snippet list;
- regex search;
- cross-PDF search;
- persistence, SQLite, JSON cache, or file writes;
- custom PDF parsing;
- replacing PDF.js;
- changes to extension activation, unrelated Webview messages, external-link handling, printing, or PDF save behavior;
- new runtime dependencies;
- raising the VS Code engine requirement beyond the current company-compatible range.

The clickable result panel is limited to `Comments only` because the comment controller already owns complete annotation text and page/rectangle metadata. Building a reliable body-text result list would require a separate text-snippet/index integration with PDF.js and is not authorized by this addendum.

## 10. Files that must not be directly edited

Do not directly edit these generated PDF.js files for this work:

```text
assets/pdf.js/web/viewer.mjs
assets/pdf.js/web/viewer.html
assets/pdf.js/web/viewer.css
assets/pdf.js/build/pdf.mjs
```

Do not modify these unrelated extension areas unless an independently documented blocker is proven:

```text
src/extension.ts
PDF loading and save code
external link handling
printing behavior
```

`src/pdf-viewer-provider.ts` is the documented exception in Section 6.7: it
may contain only the exact PDF.js Webview CSP and binary-resource loading
options required for this viewer bootstrap.

Reading these files for compatibility checks is allowed. Any necessary generated-PDF.js change requires an explicit update to `patches/pdf.js.patch` and a documented reason before construction continues.

## 11. Definition of done

The enhancement is complete only when all of the following are true:

- native body-text matches use the approved bright-yellow presentation;
- comment matches show a working native-style `current / total` counter;
- the result panel lists every logical comment result and supports click navigation;
- Next, Previous, keyboard navigation, list selection, counter, page position, and active highlight stay synchronized;
- `vstestcd` can be selected from a page 23 FreeText result in `blankcrf.pdf`;
- normal document search behavior is unchanged except for approved highlight colors;
- all focused automated checks pass;
- real VS Code Webview testing passes;
- VSIX installation is validated on VS Code `1.133`;
- no generated PDF.js file has an unmanaged direct edit;
- the implementation report lists every changed file, test result, fallback used, and any remaining limitation.

## 12. Required implementation report

After construction, report:

1. files changed and the purpose of each change;
2. whether `patches/pdf.js.patch` changed and why;
3. the final result-count semantics;
4. how stale native counts are prevented from overwriting comment counts;
5. how result rows are generated and selected;
6. how exact annotation-word highlighting and fallback outlining work;
7. automated test commands and results;
8. real Webview test results with `blankcrf.pdf`;
9. VS Code `1.133` installation result;
10. limitations that remain inside the stated boundaries.

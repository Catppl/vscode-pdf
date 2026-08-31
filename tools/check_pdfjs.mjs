import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dirname);
const read = (path) => readFileSync(join(root, path), "utf8");

const viewerHtml = read("assets/pdf.js/web/viewer.html");
const viewerMjs = read("assets/pdf.js/web/viewer.mjs");
const pdfMjs = read("assets/pdf.js/build/pdf.mjs");
const pdfWorkerMjs = read("assets/pdf.js/build/pdf.worker.mjs");
const provider = read("src/pdf-viewer-provider.ts");
const main = read("assets/main.mjs");
const commentSearchUi = read("assets/comment-search-ui.mjs");
const freeTextPresets = read("assets/free-text-presets.mjs");
const freeTextPresetModel = read("assets/free-text-preset-model.mjs");
const pdfjsBridge = read("assets/pdfjs-bridge.mjs");
const annotationTransfer = read("assets/annotation-transfer.mjs");
const annotationTransferManager = read("src/annotation-transfer-manager.ts");
const mainCss = read("assets/main.css");
const patch = read("patches/pdf.js.patch");

assert.match(
  viewerMjs,
  /const FindState = \{\s+FOUND: 0,\s+NOT_FOUND: 1,\s+WRAPPED: 2,\s+PENDING: 3\s+\};/u,
  "Unexpected PDF.js FindState values; update the comment-search UI adapter",
);

assert.equal(viewerHtml.match(/Content-Security-Policy/gu)?.length ?? 0, 0);
assert.equal(provider.match(/Content-Security-Policy/gu)?.length ?? 0, 1);
for (const directive of ["'wasm-unsafe-eval'", "base-uri 'none'", "form-action 'none'"]) {
  assert.ok(provider.includes(directive), `Missing CSP directive: ${directive}`);
}
assert.ok(
  !provider.includes("pdfJsResourceOrigin"),
  "CSP must not contain an invalid PDF.js origin",
);

for (const tag of [
  '<link rel="resource" type="application/l10n" href="locale/locale.json" />',
  '<script src="../build/pdf.mjs" type="module"></script>',
  '<script src="viewer.mjs" type="module"></script>',
  '<link rel="stylesheet" href="viewer.css" />',
]) {
  assert.equal(viewerHtml.split(tag).length, 2, `Expected one PDF.js tag: ${tag}`);
}

const assets = new Map([
  ["workerSrc", "assets/pdf.js/build/pdf.worker.mjs"],
  ["sandboxBundleSrc", "assets/pdf.js/build/pdf.sandbox.mjs"],
  ["cMapUrl", "assets/pdf.js/web/cmaps/LICENSE"],
  ["iccUrl", "assets/pdf.js/web/iccs/CGATS001Compat-v2-micro.icc"],
  ["standardFontDataUrl", "assets/pdf.js/web/standard_fonts/LICENSE_FOXIT"],
  ["wasmUrl", "assets/pdf.js/web/wasm/openjpeg.wasm"],
  ["imageResourcesPath", "assets/pdf.js/web/images/annotation-note.svg"],
]);

for (const [option, path] of assets) {
  assert.ok(provider.includes(`${option}:`), `Missing provider option: ${option}`);
  assert.ok(main.includes(`set("${option}"`), `Missing viewer option: ${option}`);
  assert.ok(existsSync(join(root, path)), `Missing PDF.js asset: ${path}`);
}

for (const snippet of [
  "super.addLinkAttributes(link, url, newWindow)",
  "url.startsWith(this.#resourceRoot)",
  "event.preventDefault()",
  "postMessage(message)",
]) {
  assert.ok(patch.includes(snippet), `Missing link guard: ${snippet}`);
}
assert.ok(main.includes("event.origin !== window.origin"), "Missing message origin guard");
assert.ok(main.includes("./comment-search-ui.mjs"), "Missing comment-search UI module");
assert.ok(main.includes("./free-text-presets.mjs"), "Missing FreeText preset module");
assert.ok(main.includes("./pdfjs-bridge.mjs"), "Missing shared PDF.js bridge module");
assert.ok(main.includes("./annotation-transfer.mjs"), "Missing annotation transfer module");
assert.ok(
  main.includes('container: document.querySelector("#outerContainer")'),
  "Comment results must be mounted in the viewer shell",
);
for (const snippet of [
  "commentSearchResultsResizer",
  "aria-valuenow",
  "setPanelWidth",
  'scrollIntoView({ block: "nearest" })',
]) {
  assert.ok(commentSearchUi.includes(snippet), `Missing result-panel behavior: ${snippet}`);
}
assert.ok(main.includes("URL.createObjectURL"), "Missing blob PDF.js worker bootstrap");
assert.ok(
  main.includes('PDFViewerApplicationOptions.set("workerPort", pdfWorker)'),
  "Missing PDF.js worker port setup",
);
assert.ok(
  provider.includes("useWorkerFetch: false"),
  "PDF.js binary assets must be fetched by the Webview",
);
assert.ok(pdfMjs.includes("data-annotation-id"), "PDF.js annotation DOM IDs are unavailable");
assert.ok(
  viewerMjs.includes("annotationlayerrendered"),
  "PDF.js annotation render event is unavailable",
);
assert.ok(
  provider.indexOf('resolvePdfJsURI("web", "viewer.css")') <
    provider.indexOf('resolveAssetURI("main.css")'),
  "main.css must load after PDF.js viewer.css",
);
for (const token of [
  "--highlight-bg-color",
  "#findCommentResultsPanel",
  "commentSearchResultsResizer",
  "commentSearchResultsOpen",
  "commentSearchResultsResizing",
  "commentSearchResultsTitle",
  "commentSearchAnnotationTarget",
  "freeTextPresetButton",
  "freeTextPresetPreview",
  "freeTextPresetDialog",
  "annotationTransferModeButton",
  "annotationTransferAvailable",
  "annotationTransferHint",
]) {
  assert.ok(mainCss.includes(token), `Missing search UI style: ${token}`);
}
const initialOpen = main.indexOf("PDFViewerApplication.open(config)");
const pagesReady = main.indexOf("pdfViewer.pagesPromise");
const fragmentApplied = main.indexOf("pdfLinkService.setHash");
assert.ok(
  initialOpen !== -1 && initialOpen < pagesReady && pagesReady < fragmentApplied,
  "PDF fragment applied before pages are ready",
);
for (const snippet of ["targetUrl.origin", "resourceRootUrl.pathname", "Uri.joinPath"]) {
  assert.ok(provider.includes(snippet), `Missing message guard: ${snippet}`);
}
assert.ok(!`${provider}\n${patch}`.includes("vscode-cdn"), "Found a fixed webview CDN host");

for (const token of [
  "FREETEXT_BORDER_WIDTH",
  "FREETEXT_BORDER_COLOR",
  "FREETEXT_BACKGROUND_COLOR",
]) {
  assert.ok(pdfMjs.includes(token), `Missing FreeText editor token: ${token}`);
  assert.ok(
    patch.includes(token),
    `FreeText PDF.js change is absent from the managed patch: ${token}`,
  );
}
for (const token of ["borderWidth", "borderColor", "backgroundColor"]) {
  assert.ok(pdfMjs.includes(token), `Missing FreeText editor property: ${token}`);
  assert.ok(pdfWorkerMjs.includes(token), `Missing FreeText worker property: ${token}`);
  assert.ok(
    patch.includes(token),
    `FreeText PDF.js change is absent from the managed patch: ${token}`,
  );
}
for (const token of [
  'freetext.set("BS", borderStyle)',
  'freetext.setIfArray("C", getPdfColorArray(borderColor))',
  'freetext.setIfArray("IC", getPdfColorArray(backgroundColor))',
  'buffer.push(getPdfColor(backgroundColor, true), box, "f")',
  "buffer.push(getPdfColor(borderColor, false)",
]) {
  assert.ok(pdfWorkerMjs.includes(token), `Missing FreeText PDF persistence path: ${token}`);
}
for (const token of [
  "normalizeFreeTextPresets",
  'type: "updateFreeTextPreset"',
  "ConfigurationTarget.Global",
]) {
  assert.ok(
    provider.includes(token) || freeTextPresets.includes(token),
    `Missing preset bridge: ${token}`,
  );
}
for (const token of ["DEFAULT_PRESETS", "normalizePreset", "stylesEqual", "backgroundColor"]) {
  assert.ok(freeTextPresetModel.includes(token), `Missing preset model token: ${token}`);
}

for (const token of ["serializeSelectedEditorForExternalCopy", "pasteSerializedEditorAt"]) {
  assert.ok(pdfMjs.includes(token), `Missing external annotation adapter: ${token}`);
  assert.ok(patch.includes(token), `External annotation adapter is absent from patch: ${token}`);
  assert.ok(pdfjsBridge.includes(token), `Shared PDF.js bridge is missing adapter use: ${token}`);
}
assert.ok(pdfMjs.includes("applyExternalCopyStyle"), "Missing external annotation style adapter");
assert.ok(
  patch.includes("applyExternalCopyStyle"),
  "External annotation style adapter is absent from patch",
);
for (const token of [
  "annotationTransferModeSet",
  "annotationCopyStart",
  "annotationDropRequest",
  "annotationDropCommit",
  "annotationDropResult",
]) {
  assert.ok(
    `${provider}\n${annotationTransfer}\n${annotationTransferManager}`.includes(token),
    `Missing annotation transfer protocol token: ${token}`,
  );
}
for (const token of [
  "Continuous cross-PDF FreeText copy",
  "annotationTransferModeButton",
  "AnnotationTransferDocumentRole",
  "canUseDocumentAsTransferRole",
  "beginExternalCopyMode",
  "endExternalCopyMode",
  "serializeSelectedAnnotationForCopy",
  "insertSerializedAnnotationAt",
]) {
  assert.ok(annotationTransfer.includes(token), `Missing continuous-copy behavior: ${token}`);
}
assert.ok(
  !annotationTransfer.includes("dataTransfer"),
  "Continuous copy must not depend on cross-Webview HTML DataTransfer",
);

const localeRoot = join(root, "assets/pdf.js/web/locale");
const locales = Object.values(JSON.parse(read("assets/pdf.js/web/locale/locale.json")));
for (const locale of locales) {
  assert.ok(existsSync(join(localeRoot, locale)), `Missing locale: ${locale}`);
}

const cssRoot = join(root, "assets/pdf.js/web");
const css = read("assets/pdf.js/web/viewer.css");
const cssUrls = [...css.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/gu)].map((match) => match[1]);
for (const url of cssUrls) {
  if (url?.startsWith("data:") || url?.startsWith("#")) {
    continue;
  }
  assert.ok(existsSync(join(cssRoot, url)), `Missing CSS asset: ${url}`);
}

process.stdout.write(`PDF.js assets verified (${locales.length} locales).\n`);

import assert from "node:assert/strict";
import test from "node:test";

globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.Path2D ??= class Path2D {};

const { AnnotationEditorType, getDocument } = await import("../assets/pdf.js/build/pdf.mjs");

function createMinimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.7\n%PDFJS\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function openPdf(data) {
  return getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: new URL("../assets/pdf.js/web/standard_fonts/", import.meta.url).href,
    useWorkerFetch: false,
  }).promise;
}

test("writes and restores FreeText border and background properties", async () => {
  const document = await openPdf(createMinimalPdf());
  const cases = [
    {
      value: "Case A",
      rotation: 0,
      color: [0, 0, 0],
      borderWidth: 1,
      borderColor: [255, 0, 0],
      backgroundColor: [255, 255, 255],
    },
    {
      value: "Case B",
      rotation: 90,
      color: [255, 0, 0],
      borderWidth: 1,
      borderColor: [0, 102, 255],
      backgroundColor: [255, 255, 153],
    },
    {
      value: "Case C",
      rotation: 180,
      color: [0, 0, 255],
      borderWidth: 1,
      borderColor: [0, 0, 255],
      backgroundColor: [234, 243, 255],
    },
    {
      value: "Case D",
      rotation: 270,
      color: [0, 0, 0],
      borderWidth: 0,
      borderColor: [0, 0, 0],
      backgroundColor: null,
    },
    {
      value: "Case E",
      rotation: 0,
      color: [255, 0, 0],
      borderWidth: 0,
      borderColor: [0, 0, 0],
      backgroundColor: [255, 255, 153],
    },
    {
      value: "Case F",
      rotation: 0,
      color: [255, 0, 0],
      borderWidth: 1,
      borderColor: [0, 102, 255],
      backgroundColor: null,
    },
  ];
  for (let index = 0; index < cases.length; index++) {
    document.annotationStorage.setValue(`pdfjs_internal_editor_style_test_${index}`, {
      annotationType: AnnotationEditorType.FREETEXT,
      pageIndex: 0,
      rect: [72, 700 - index * 60, 260, 740 - index * 60],
      fontSize: 10,
      ...cases[index],
    });
  }

  const saved = await document.saveDocument();
  const savedText = new TextDecoder("latin1").decode(saved);
  assert.match(savedText, /\/Subtype \/FreeText/u);
  assert.match(savedText, /\/BS\s*<<[\s\S]*?\/W 1[\s\S]*?\/S \/S[\s\S]*?>>/u);
  assert.match(savedText, /\/C \[0 0\.4 1\]/u);
  assert.match(savedText, /\/IC \[1 1 0\.6\]/u);
  assert.match(savedText, /\/AP\s*<<[\s\S]*?\/N\s+\d+\s+0\s+R[\s\S]*?>>/u);
  assert.match(
    savedText,
    /1 1 0\.6 rg[\s\S]*?\bre[\s\S]*?\bf[\s\S]*?0 0\.4 1 RG[\s\S]*?1 w[\s\S]*?\bre[\s\S]*?\bS[\s\S]*?\bBT[\s\S]*?1 0 0 rg/u,
  );

  const reopened = await openPdf(saved);
  const annotations = await (await reopened.getPage(1)).getAnnotations({ intent: "display" });
  const freeTexts = annotations.filter(({ subtype }) => subtype === "FreeText");
  assert.equal(freeTexts.length, cases.length);
  for (const expected of cases) {
    const annotation = freeTexts.find(({ contentsObj }) => contentsObj.str === expected.value);
    assert.ok(annotation, expected.value);
    assert.equal(annotation.borderStyle.width, expected.borderWidth, expected.value);
    assert.equal(annotation.rotation, expected.rotation, expected.value);
    assert.deepEqual(Array.from(annotation.color), expected.borderColor, expected.value);
    assert.deepEqual(
      annotation.backgroundColor ? Array.from(annotation.backgroundColor) : null,
      expected.backgroundColor,
      expected.value,
    );
    assert.deepEqual(
      Array.from(annotation.defaultAppearanceData.fontColor),
      expected.color,
      expected.value,
    );
  }
});

function finiteRect(rect) {
  return (
    Array.isArray(rect) &&
    rect.length === 4 &&
    rect.every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeGrabOffset(value) {
  return {
    x: clamp(Number.isFinite(value?.x) ? value.x : 0.5, 0, 1),
    y: clamp(Number.isFinite(value?.y) ? value.y : 0.5, 0, 1),
  };
}

export function clampRectToPage(rect, pageBounds) {
  if (!finiteRect(rect) || !finiteRect(pageBounds)) {
    return null;
  }
  const [pageLeft, pageBottom, pageRight, pageTop] = pageBounds;
  let [left, bottom, right, top] = rect;
  const width = right - left;
  const height = top - bottom;

  if (width <= pageRight - pageLeft) {
    if (left < pageLeft) {
      right += pageLeft - left;
      left = pageLeft;
    } else if (right > pageRight) {
      left -= right - pageRight;
      right = pageRight;
    }
  }
  if (height <= pageTop - pageBottom) {
    if (bottom < pageBottom) {
      top += pageBottom - bottom;
      bottom = pageBottom;
    } else if (top > pageTop) {
      bottom -= top - pageTop;
      top = pageTop;
    }
  }
  return [left, bottom, right, top];
}

export function computeTargetRect({
  sourceRect,
  pageBounds,
  viewport,
  pageClientRect,
  clientX,
  clientY,
  grabOffset,
}) {
  if (
    !finiteRect(sourceRect) ||
    !finiteRect(pageBounds) ||
    !viewport ||
    typeof viewport.convertToViewportPoint !== "function" ||
    typeof viewport.convertToPdfPoint !== "function" ||
    !pageClientRect ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY)
  ) {
    return null;
  }

  const width = Math.abs(sourceRect[2] - sourceRect[0]);
  const height = Math.abs(sourceRect[3] - sourceRect[1]);
  if (width === 0 || height === 0) {
    return null;
  }

  const [pageLeft, pageBottom] = pageBounds;
  const viewportFirst = viewport.convertToViewportPoint(pageLeft, pageBottom);
  const viewportSecond = viewport.convertToViewportPoint(pageLeft + width, pageBottom + height);
  const displayWidth = Math.abs(viewportSecond[0] - viewportFirst[0]);
  const displayHeight = Math.abs(viewportSecond[1] - viewportFirst[1]);
  const offset = normalizeGrabOffset(grabOffset);
  const localX = clientX - pageClientRect.left;
  const localY = clientY - pageClientRect.top;
  const viewportLeft = localX - displayWidth * offset.x;
  const viewportTop = localY - displayHeight * offset.y;

  const first = viewport.convertToPdfPoint(viewportLeft, viewportTop);
  const second = viewport.convertToPdfPoint(
    viewportLeft + displayWidth,
    viewportTop + displayHeight,
  );
  const targetRect = [
    Math.min(first[0], second[0]),
    Math.min(first[1], second[1]),
    Math.max(first[0], second[0]),
    Math.max(first[1], second[1]),
  ];
  return clampRectToPage(targetRect, pageBounds);
}

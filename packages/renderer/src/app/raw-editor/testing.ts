/**
 * jsdom has no layout: `Range` lacks `getClientRects`/`getBoundingClientRect`, which CodeMirror's
 * measuring (run in an animation frame) calls. Specs that render the raw editor install empty
 * rectangles so that measuring finds nothing instead of throwing after the test.
 */
export function installJsdomLayoutStubs(): void {
  const proto = Range.prototype as Partial<Range>;
  if (typeof proto.getClientRects !== 'function') {
    proto.getClientRects = () => emptyRectList();
  }
  if (typeof proto.getBoundingClientRect !== 'function') {
    proto.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
}

function emptyRectList(): DOMRectList {
  const list: DOMRect[] = [];
  return Object.assign(list, { item: () => null }) as unknown as DOMRectList;
}

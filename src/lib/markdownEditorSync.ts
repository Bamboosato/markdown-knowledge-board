export type MinimalEditorChange = {
  from: number;
  to: number;
  insert: string;
};

export function findMinimalEditorChange(
  currentValue: string,
  nextValue: string,
): MinimalEditorChange | null {
  if (currentValue === nextValue) return null;

  let prefixLength = 0;
  const sharedLength = Math.min(currentValue.length, nextValue.length);
  while (
    prefixLength < sharedLength &&
    currentValue[prefixLength] === nextValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  if (
    prefixLength > 0 &&
    prefixLength < currentValue.length &&
    /[\uD800-\uDBFF]/u.test(currentValue[prefixLength - 1]) &&
    /[\uDC00-\uDFFF]/u.test(currentValue[prefixLength])
  ) {
    prefixLength -= 1;
  }

  let currentSuffix = currentValue.length;
  let nextSuffix = nextValue.length;
  while (
    currentSuffix > prefixLength &&
    nextSuffix > prefixLength &&
    currentValue[currentSuffix - 1] === nextValue[nextSuffix - 1]
  ) {
    currentSuffix -= 1;
    nextSuffix -= 1;
  }

  if (
    currentSuffix > 0 &&
    currentSuffix < currentValue.length &&
    /[\uD800-\uDBFF]/u.test(currentValue[currentSuffix - 1]) &&
    /[\uDC00-\uDFFF]/u.test(currentValue[currentSuffix])
  ) {
    currentSuffix += 1;
    nextSuffix += 1;
  }

  return {
    from: prefixLength,
    to: currentSuffix,
    insert: nextValue.slice(prefixLength, nextSuffix),
  };
}

export function clampEditorOffset(offset: number, documentLength: number) {
  return Math.max(0, Math.min(offset, documentLength));
}

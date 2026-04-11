export interface DiffLine {
  type: "add" | "remove" | "context";
  line: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Compute a simple line-by-line diff between old and new text.
 * Returns an array of diff lines marked as add/remove/context.
 * Uses a square-search lookahead to group block replacements and avoid interleaving.
 */
export function computeLineDiff(
  oldText: string | null | undefined,
  newText: string | null | undefined
): DiffLine[] {
  // Handle edge cases
  if (!oldText && !newText) {
    return [];
  }
  if (!oldText) {
    // New file - all lines are additions
    return newText!.split("\n").map((line, idx) => ({
      type: "add" as const,
      line,
      newLineNumber: idx + 1,
    }));
  }
  if (!newText) {
    // Deleted file - all lines are deletions
    return oldText!.split("\n").map((line, idx) => ({
      type: "remove" as const,
      line,
      oldLineNumber: idx + 1,
    }));
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  let i = 0,
    j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({
        type: "context",
        line: oldLines[i],
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
      i++;
      j++;
    } else {
      // Look ahead for a match
      let nextI = -1;
      let nextJ = -1;
      const lookahead = 50;
      let found = false;

      for (let k = 1; k < lookahead; k++) {
        for (let l = 0; l <= k; l++) {
          if (
            i + k < oldLines.length &&
            j + l < newLines.length &&
            oldLines[i + k] === newLines[j + l]
          ) {
            nextI = i + k;
            nextJ = j + l;
            found = true;
            break;
          }
          if (
            i + l < oldLines.length &&
            j + k < newLines.length &&
            oldLines[i + l] === newLines[j + k]
          ) {
            nextI = i + l;
            nextJ = j + k;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (found) {
        // Add all removals then all additions
        for (let k = i; k < nextI; k++) {
          result.push({
            type: "remove",
            line: oldLines[k],
            oldLineNumber: oldLineNum++,
          });
        }
        for (let k = j; k < nextJ; k++) {
          result.push({
            type: "add",
            line: newLines[k],
            newLineNumber: newLineNum++,
          });
        }
        i = nextI;
        j = nextJ;
      } else {
        // No match found in lookahead, treat everything until end as a block to avoid interleaving
        while (i < oldLines.length) {
          result.push({
            type: "remove",
            line: oldLines[i++],
            oldLineNumber: oldLineNum++,
          });
        }
        while (j < newLines.length) {
          result.push({
            type: "add",
            line: newLines[j++],
            newLineNumber: newLineNum++,
          });
        }
      }
    }
  }

  // Add remaining lines
  while (i < oldLines.length) {
    result.push({
      type: "remove",
      line: oldLines[i++],
      oldLineNumber: oldLineNum++,
    });
  }
  while (j < newLines.length) {
    result.push({
      type: "add",
      line: newLines[j++],
      newLineNumber: newLineNum++,
    });
  }

  return result;
}

export function buildInlineDiffPreview(
  relPath: string,
  oldContent: string,
  newContent: string,
  maxLines = 14
): string {
  if (!oldContent) {
    const lines = newContent.split("\n").slice(0, maxLines);
    const more = newContent.split("\n").length - lines.length;
    return (
      `New file: ${relPath}\n` +
      lines.map((l) => `+ ${l}`).join("\n") +
      (more > 0 ? `\n... (+${more} more lines)` : "")
    );
  }

  if (oldContent === newContent) return `No changes in ${relPath}`;

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const preview: string[] = [`Changes in ${relPath}:`];

  let shown = 0;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length) && shown < maxLines; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) continue;
    if (o !== undefined) {
      preview.push(`- ${o}`);
      shown++;
    }
    if (n !== undefined && shown < maxLines) {
      preview.push(`+ ${n}`);
      shown++;
    }
  }

  const changed = oldLines.length !== newLines.length || oldContent !== newContent;
  if (changed && shown >= maxLines) preview.push("... (diff truncated)");
  return preview.join("\n");
}

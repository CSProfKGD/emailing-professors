/** Quote selectors use UTF-16 offsets, matching DOM Range and JavaScript strings. */
export function makeAnchor(sectionId, text, start, end) {
  if (!sectionId || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) throw new Error('Select a passage first.');
  if (!text.slice(start, end).trim()) throw new Error('Select some text to annotate.');
  if (end - start > 2000) throw new Error('Please select a shorter passage (up to 2,000 characters).');
  return { sectionId, exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(end, end + 64), start, end };
}
export function resolveAnchor(text, anchor) {
  if (!text || !anchor?.exact) return null;
  const { exact, prefix = '', suffix = '' } = anchor;
  const contextMatches = (start) => (!prefix || text.slice(Math.max(0, start - prefix.length), start) === prefix) && (!suffix || text.slice(start + exact.length, start + exact.length + suffix.length) === suffix);
  // Verify context too: offsets can land on another copy of the same quote after edits.
  if (text.slice(anchor.start, anchor.end) === exact && contextMatches(anchor.start)) return { start: anchor.start, end: anchor.end };
  const candidates = [];
  for (let from = 0; from < text.length;) {
    const start = text.indexOf(exact, from);
    if (start < 0) break;
    if (contextMatches(start)) candidates.push({ start, end: start + exact.length });
    from = start + 1;
  }
  // Conservative by design: changed context and ambiguous matches require author review.
  return candidates.length === 1 ? candidates[0] : null;
}
export function fromStored(anchor) {
  return { sectionId: anchor.section_id, exact: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix, start: anchor.start_offset, end: anchor.end_offset };
}

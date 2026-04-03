/**
 * @file Mention Serializer/Deserializer
 *
 * Provides structured, reversible serialization of mention references
 * (files, selections, terminal output, images) into text format.
 *
 * ## Format Design
 *
 * Uses XML-like structured tags for easy parsing and readability.
 * Supports full round-trip: mention objects -> text -> mention objects.
 * Handles nested content with proper escaping using CDATA sections.
 *
 * ## Format Examples
 *
 * ```xml
 * <!-- File reference (self-closing) -->
 * <mention type="file" name="example.ts" path="/path/example.ts" />
 *
 * <!-- Code selection with content -->
 * <mention type="selection" name="example.ts:1-5" path="/path/example.ts" range="1-5">
 *   <![CDATA[const x = 1;]]>
 * </mention>
 *
 * <!-- Terminal output -->
 * <mention type="terminal" name="Terminal: bash">
 *   <![CDATA[command output]]>
 * </mention>
 *
 * <!-- Image reference -->
 * <mention type="image" name="screenshot.png" dataUrl="data:image/png;base64,..." />
 * ```
 *
 * ## Architecture
 *
 * The serializer follows a clean separation of concerns:
 * - **serializeMention**: Single mention -> structured string
 * - **parseMention**: Structured string -> mention object
 * - **serializeMentionsWithContext**: Batch serialization with message text
 * - **parseMentionsFromText**: Extract mentions from mixed text
 * - **stripMentionMarkup**: Clean display text (removes all markup)
 *
 * @module utils/mention-serializer
 */

export interface Mention {
  name: string;
  path?: string;
  type?: "file" | "selection" | "terminal" | "image";
  content?: string;
  range?: { startLine: number; endLine: number };
  dataUrl?: string;
}

/**
 * Escape special characters for XML attribute values
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Unescape XML attribute values
 */
function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Serialize a single mention to structured text format
 * @param mention - The mention object to serialize
 * @returns Serialized string representation
 */
export function serializeMention(mention: Mention): string {
  const type = mention.type || "file";
  const name = escapeAttr(mention.name);
  const parts: string[] = [`<mention type="${type}" name="${name}"`];

  if (mention.path) {
    parts.push(` path="${escapeAttr(mention.path)}"`);
  }

  if (mention.range) {
    parts.push(` range="${mention.range.startLine}-${mention.range.endLine}"`);
  }

  if (mention.dataUrl) {
    parts.push(` dataUrl="${escapeAttr(mention.dataUrl)}"`);
  }

  // For mentions with content (selection, terminal), use CDATA wrapper
  if (mention.content && (type === "selection" || type === "terminal")) {
    // Escape CDATA end markers in content
    const safeContent = mention.content.replace(/\]\]>/g, "]]]]><![CDATA[>");
    parts.push(`><![CDATA[${safeContent}]]></mention>`);
    return parts.join("");
  }

  // Self-closing for simple mentions (file, image)
  parts.push(" />");
  return parts.join("");
}

/**
 * Parse a serialized mention string back to a Mention object
 * @param serialized - The serialized mention string
 * @returns Parsed Mention object, or null if parsing fails
 */
export function parseMention(serialized: string): Mention | null {
  try {
    const mentionRegex = /<mention\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/mention>)/;
    const match = serialized.match(mentionRegex);
    if (!match) return null;

    const attrs = match[1];
    const content = match[2];

    const mention: Mention = {
      name: "",
      type: "file",
    };

    // Parse attributes
    const typeMatch = attrs.match(/type="([^"]*)"/);
    if (typeMatch) mention.type = typeMatch[1] as Mention["type"];

    const nameMatch = attrs.match(/name="([^"]*)"/);
    if (nameMatch) mention.name = unescapeAttr(nameMatch[1]);

    const pathMatch = attrs.match(/path="([^"]*)"/);
    if (pathMatch) mention.path = unescapeAttr(pathMatch[1]);

    const rangeMatch = attrs.match(/range="(\d+)-(\d+)"/);
    if (rangeMatch) {
      mention.range = {
        startLine: parseInt(rangeMatch[1], 10),
        endLine: parseInt(rangeMatch[2], 10),
      };
    }

    const dataUrlMatch = attrs.match(/dataUrl="([^"]*)"/);
    if (dataUrlMatch) mention.dataUrl = unescapeAttr(dataUrlMatch[1]);

    // Parse content for non-self-closing mentions
    if (content) {
      // Remove CDATA wrapper if present
      const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      mention.content = cdataMatch ? cdataMatch[1] : content.trim();
    }

    return mention;
  } catch {
    return null;
  }
}

/**
 * Serialize multiple mentions and embed them into message text
 *
 * Strategy:
 * 1. Replace mention placeholder positions with structured mention tags
 * 2. Group mentions by type for better organization
 *
 * @param text - The message text (may contain __MENTION_N__ placeholders)
 * @param mentions - Array of mention objects
 * @returns Object containing clean text and serialized context
 */
export function serializeMentionsWithContext(
  text: string,
  mentions: Mention[]
): { cleanText: string; contextText: string } {
  // Replace placeholders with actual mention names in the main text
  const cleanText = text.replace(
    /__MENTION_(\d+)__/g,
    (_match, idx: string) => {
      const i = parseInt(idx, 10);
      return mentions[i]?.name ?? _match;
    }
  );

  // Build structured context with serialized mentions
  if (mentions.length === 0) {
    return { cleanText, contextText: "" };
  }

  const fileMentions = mentions.filter((m) => !m.type || m.type === "file");
  const selectionMentions = mentions.filter((m) => m.type === "selection");
  const terminalMentions = mentions.filter((m) => m.type === "terminal");
  const imageMentions = mentions.filter((m) => m.type === "image");

  const sections: string[] = [];

  // File references
  if (fileMentions.length > 0) {
    const files = fileMentions.map((m) => serializeMention(m)).join("\n");
    sections.push(files);
  }

  // Code selections
  if (selectionMentions.length > 0) {
    const selections = selectionMentions
      .map((m) => serializeMention(m))
      .join("\n\n");
    sections.push(selections);
  }

  // Terminal output
  if (terminalMentions.length > 0) {
    const terminals = terminalMentions
      .map((m) => serializeMention(m))
      .join("\n\n");
    sections.push(terminals);
  }

  // Image references
  if (imageMentions.length > 0) {
    const images = imageMentions.map((m) => serializeMention(m)).join("\n");
    sections.push(images);
  }

  const contextText =
    sections.length > 0
      ? `\n\n<referenced-items>\n${sections.join("\n\n")}\n</referenced-items>`
      : "";

  return { cleanText, contextText };
}

/**
 * Parse serialized mentions from message text
 * Extracts mention objects from structured mention tags in text
 *
 * @param text - Text that may contain serialized mention tags
 * @returns Array of parsed Mention objects
 */
export function parseMentionsFromText(text: string): Mention[] {
  const mentions: Mention[] = [];

  // Match all mention tags (both self-closing and with content)
  const mentionRegex = /<mention\s[^>]*?(?:\/>|>[\s\S]*?<\/mention>)/g;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    const mention = parseMention(match[0]);
    if (mention) {
      mentions.push(mention);
    }
  }

  return mentions;
}

/**
 * Clean mention tags from text for plain display
 * Replaces mention tags with just the mention name
 *
 * @param text - Text that may contain serialized mention tags
 * @returns Cleaned text with mention names
 */
export function cleanMentionTags(text: string): string {
  // Replace self-closing tags
  let result = text.replace(
    /<mention\s+[^>]*?name="([^"]*?)"[^>]*?\/>/g,
    (_, name) => unescapeAttr(name)
  );

  // Replace tags with content
  result = result.replace(
    /<mention\s+[^>]*?name="([^"]*?)"[^>]*?>[\s\S]*?<\/mention>/g,
    (_, name) => unescapeAttr(name)
  );

  return result;
}

/**
 * Strip all mention tags and context wrapper from text
 * Used for copying message content without mention markup
 *
 * @param text - Text with mention markup
 * @returns Text with all mention markup removed
 */
export function stripMentionMarkup(text: string): string {
  // Remove referenced-items wrapper
  let result = text.replace(/<\/?referenced-items>/g, "");

  // Remove all mention tags
  result = result.replace(/<mention\s[^>]*?(?:\/>|>[\s\S]*?<\/mention>)/g, "");

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

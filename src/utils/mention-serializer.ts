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
  type?: "file" | "folder" | "selection" | "terminal" | "image";
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

  // Skip dataUrl for images - the image content is already sent as a separate prompt item
  // {type: "image", data, mimeType}. Including dataUrl here would waste tokens
  // by sending the base64 data twice (once as image, once as text attribute)
  if (mention.dataUrl && type !== "image") {
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
    // Unescape XML entities if present (in case the ACP agent escaped them)
    // Only decode structural tags, do not decode &quot; here to avoid breaking attribute regexes.
    const decoded = serialized.replace(/&lt;/g, "<").replace(/&gt;/g, ">");

    const mentionRegex =
      /<mention\s+([\s\S]*?)(?:\/>|>([\s\S]*?)<\/mention\s*>)/i;
    const match = decoded.match(mentionRegex);
    if (!match) return null;

    const attrs = match[1];
    const content = match[2];

    const mention: Mention = {
      name: "",
      type: "file",
    };

    // Parse attributes allowing both single and double quotes
    const typeMatch = attrs.match(/type=(["'])(.*?)\1/i);
    if (typeMatch) mention.type = typeMatch[2] as Mention["type"];

    const nameMatch = attrs.match(/name=(["'])(.*?)\1/i);
    if (nameMatch) mention.name = unescapeAttr(nameMatch[2]);

    const pathMatch = attrs.match(/path=(["'])(.*?)\1/i);
    if (pathMatch) mention.path = unescapeAttr(pathMatch[2]);

    const rangeMatch = attrs.match(/range=(["'])(\d+)-(\d+)\1/i);
    if (rangeMatch) {
      mention.range = {
        startLine: parseInt(rangeMatch[2], 10),
        endLine: parseInt(rangeMatch[3], 10),
      };
    }

    const dataUrlMatch = attrs.match(/dataUrl=(["'])(.*?)\1/i);
    if (dataUrlMatch) mention.dataUrl = unescapeAttr(dataUrlMatch[2]);

    // Parse content for non-self-closing mentions
    if (content) {
      // Remove CDATA wrapper if present
      const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
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

  const fileMentions = mentions.filter(
    (m) => !m.type || m.type === "file" || m.type === "folder"
  );
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
 * Extract mentions from text and replace their tags with placeholders
 *
 * @param text - Text containing structured mention tags
 * @returns Object with processed text and extracted mentions
 */
export function extractMentions(text: string): {
  text: string;
  mentions: Mention[];
} {
  const mentions: Mention[] = [];
  const mentionRegex =
    /(?:<|&lt;)mention\s+[\s\S]*?(?:\/&gt;|\/>|&gt;[\s\S]*?&lt;\/mention\s*&gt;|>[\s\S]*?<\/mention\s*>)/gi;

  // 1. First extract all structured mentions from tags
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const mention = parseMention(match[0]);
    if (mention) {
      mentions.push(mention);
    }
  }

  // 2. Remove all mention tags and referenced-items wrappers to get the "clean" text
  let processedText = text.replace(mentionRegex, "");
  processedText = processedText.replace(
    /(?:<|&lt;)\/?referenced-items\s*(?:>|&gt;)/gi,
    ""
  );

  // Clean up extra whitespace
  processedText = processedText.replace(/\n{3,}/g, "\n\n").trim();

  // 3. For each extracted mention, try to find its name in the text and replace it with a placeholder.
  // This handles mentions that were originally typed as @name.
  // If not found in text, we append it to the end (it was a context-only mention).
  for (let i = 0; i < mentions.length; i++) {
    const mentionName = mentions[i].name;
    const placeholder = `__MENTION_${i}__`;

    const nameIndex = processedText.indexOf(mentionName);
    if (nameIndex !== -1) {
      processedText =
        processedText.slice(0, nameIndex) +
        placeholder +
        processedText.slice(nameIndex + mentionName.length);
    } else {
      // If not found in text, append to the end
      processedText = processedText + "\n\n" + placeholder;
    }
  }

  return { text: processedText, mentions };
}

/**
 * Parse serialized mentions from message text
 * Extracts mention objects from structured mention tags in text
 *
 * @param text - Text that may contain serialized mention tags
 * @returns Array of parsed Mention objects
 */
export function parseMentionsFromText(text: string): Mention[] {
  console.log(
    "[MentionSerializer Debug] parseMentionsFromText called. Text length:",
    text.length
  );
  const mentions: Mention[] = [];

  // Match all mention tags (both self-closing and with content), handling potential HTML escaping
  const mentionRegex =
    /(?:<|&lt;)mention\s+[\s\S]*?(?:\/&gt;|\/>|&gt;[\s\S]*?&lt;\/mention\s*&gt;|>[\s\S]*?<\/mention\s*>)/gi;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    console.log("[MentionSerializer Debug] Found match:\n", match[0]);
    const mention = parseMention(match[0]);
    if (mention) {
      console.log(
        "[MentionSerializer Debug] Parsed mention object:",
        JSON.stringify(mention)
      );
      mentions.push(mention);
    } else {
      console.log(
        "[MentionSerializer Debug] parseMention returned null for the match."
      );
    }
  }

  console.log(
    `[MentionSerializer Debug] parseMentionsFromText returning ${mentions.length} mentions`
  );
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
  // Decode first to ensure regex matches
  let decoded = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  // Replace self-closing tags
  let result = decoded.replace(
    /<mention\s+[^>]*?name=(["'])(.*?)\1[^>]*?\/>/gi,
    (_, quote, name) => unescapeAttr(name)
  );

  // Replace tags with content
  result = result.replace(
    /<mention\s+[^>]*?name=(["'])(.*?)\1[^>]*?>[\s\S]*?<\/mention\s*>/gi,
    (_, quote, name) => unescapeAttr(name)
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
  // Remove referenced-items wrapper (handling escaped ones too)
  let result = text.replace(/(?:<|&lt;)\/?referenced-items\s*(?:>|&gt;)/gi, "");

  // Remove all mention tags
  result = result.replace(
    /(?:<|&lt;)mention\s+[\s\S]*?(?:\/&gt;|\/>|&gt;[\s\S]*?&lt;\/mention\s*&gt;|>[\s\S]*?<\/mention\s*>)/gi,
    ""
  );

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

import * as assert from "assert";
import {
  serializeMention,
  parseMention,
  serializeMentionsWithContext,
  parseMentionsFromText,
  cleanMentionTags,
  stripMentionMarkup,
  type Mention,
} from "../utils/mention-serializer";

suite("Mention Serializer", () => {
  suite("serializeMention", () => {
    test("should serialize a file mention", () => {
      const mention: Mention = {
        name: "example.ts",
        path: "/path/example.ts",
        type: "file",
      };
      const result = serializeMention(mention);
      assert.strictEqual(
        result,
        '<mention type="file" name="example.ts" path="/path/example.ts" />'
      );
    });

    test("should serialize a selection mention with content", () => {
      const mention: Mention = {
        name: "example.ts:1-5",
        path: "/path/example.ts",
        type: "selection",
        content: "const x = 1;",
        range: { startLine: 1, endLine: 5 },
      };
      const result = serializeMention(mention);
      assert.ok(result.includes('type="selection"'));
      assert.ok(result.includes('name="example.ts:1-5"'));
      assert.ok(result.includes('path="/path/example.ts"'));
      assert.ok(result.includes('range="1-5"'));
      assert.ok(result.includes("<![CDATA[const x = 1;]]>"));
    });

    test("should serialize a terminal mention with content", () => {
      const mention: Mention = {
        name: "Terminal: bash",
        type: "terminal",
        content: "Done in 8.4s using pnpm v10.33.0",
      };
      const result = serializeMention(mention);
      assert.ok(result.includes('type="terminal"'));
      assert.ok(result.includes('name="Terminal: bash"'));
      assert.ok(
        result.includes("<![CDATA[Done in 8.4s using pnpm v10.33.0]]>")
      );
    });

    test("should serialize an image mention without dataUrl", () => {
      // Image mentions should NOT include dataUrl to avoid sending image data twice
      // (once as {type: "image"} prompt item, once as text attribute)
      const mention: Mention = {
        name: "screenshot.png",
        type: "image",
        dataUrl: "data:image/png;base64,abc123",
      };
      const result = serializeMention(mention);
      assert.ok(result.includes('type="image"'));
      assert.ok(result.includes('name="screenshot.png"'));
      assert.ok(
        !result.includes("dataUrl="),
        "Image should not include dataUrl to avoid duplication"
      );
    });

    test("should escape special characters in attributes", () => {
      const mention: Mention = {
        name: 'file "test".ts',
        path: "/path/file <test>.ts",
        type: "file",
      };
      const result = serializeMention(mention);
      assert.ok(result.includes('name="file &quot;test&quot;.ts"'));
      assert.ok(result.includes('path="/path/file &lt;test&gt;.ts"'));
    });
  });

  suite("parseMention", () => {
    test("should parse a file mention", () => {
      const serialized =
        '<mention type="file" name="example.ts" path="/path/example.ts" />';
      const result = parseMention(serialized);
      assert.ok(result);
      assert.strictEqual(result?.type, "file");
      assert.strictEqual(result?.name, "example.ts");
      assert.strictEqual(result?.path, "/path/example.ts");
    });

    test("should parse a selection mention with content", () => {
      const serialized =
        '<mention type="selection" name="example.ts:1-5" path="/path/example.ts" range="1-5"><![CDATA[const x = 1;]]></mention>';
      const result = parseMention(serialized);
      assert.ok(result);
      assert.strictEqual(result?.type, "selection");
      assert.strictEqual(result?.name, "example.ts:1-5");
      assert.strictEqual(result?.path, "/path/example.ts");
      assert.deepStrictEqual(result?.range, { startLine: 1, endLine: 5 });
      assert.strictEqual(result?.content, "const x = 1;");
    });

    test("should parse a terminal mention with content", () => {
      const serialized =
        '<mention type="terminal" name="Terminal: bash"><![CDATA[Done in 8.4s]]></mention>';
      const result = parseMention(serialized);
      assert.ok(result);
      assert.strictEqual(result?.type, "terminal");
      assert.strictEqual(result?.name, "Terminal: bash");
      assert.strictEqual(result?.content, "Done in 8.4s");
    });

    test("should parse an image mention with dataUrl", () => {
      // Note: serializeMention no longer includes dataUrl for images (to avoid sending twice)
      // but parseMention can still parse it if agent includes it in history
      const serialized =
        '<mention type="image" name="screenshot.png" dataUrl="data:image/png;base64,abc123" />';
      const result = parseMention(serialized);
      assert.ok(result);
      assert.strictEqual(result?.type, "image");
      assert.strictEqual(result?.name, "screenshot.png");
      assert.strictEqual(result?.dataUrl, "data:image/png;base64,abc123");
    });

    test("should not include dataUrl when serializing image mentions", () => {
      // Images should not include dataUrl in serialization - the image data
      // is already sent as a separate prompt item {type: "image"}
      const mention: Mention = {
        name: "screenshot.png",
        type: "image",
        dataUrl: "data:image/png;base64,abc123",
      };
      const result = serializeMention(mention);
      assert.ok(result.includes('type="image"'));
      assert.ok(result.includes('name="screenshot.png"'));
      assert.ok(
        !result.includes("dataUrl="),
        "Image should not include dataUrl attribute"
      );
    });

    test("should unescape special characters in attributes", () => {
      const serialized =
        '<mention type="file" name="file &quot;test&quot;.ts" path="/path/file &lt;test&gt;.ts" />';
      const result = parseMention(serialized);
      assert.ok(result);
      assert.strictEqual(result?.name, 'file "test".ts');
      assert.strictEqual(result?.path, "/path/file <test>.ts");
    });

    test("should return null for invalid input", () => {
      assert.strictEqual(parseMention("invalid"), null);
      assert.strictEqual(parseMention(""), null);
    });
  });

  suite("serializeMentionsWithContext", () => {
    test("should replace placeholders with names and add structured context", () => {
      const text = "Check __MENTION_0__ and __MENTION_1__";
      const mentions: Mention[] = [
        { name: "file.ts", path: "/path/file.ts", type: "file" },
        {
          name: "file.ts:1-5",
          path: "/path/file.ts",
          type: "selection",
          content: "const x = 1;",
          range: { startLine: 1, endLine: 5 },
        },
      ];

      const result = serializeMentionsWithContext(text, mentions);
      assert.strictEqual(result.cleanText, "Check file.ts and file.ts:1-5");
      assert.ok(result.contextText.includes("<referenced-items>"));
      assert.ok(result.contextText.includes('type="file"'));
      assert.ok(result.contextText.includes('type="selection"'));
    });

    test("should handle empty mentions", () => {
      const text = "Just a plain message";
      const result = serializeMentionsWithContext(text, []);
      assert.strictEqual(result.cleanText, "Just a plain message");
      assert.strictEqual(result.contextText, "");
    });

    test("should group mentions by type", () => {
      const text = "__MENTION_0__ __MENTION_1__ __MENTION_2__";
      const mentions: Mention[] = [
        { name: "file1.ts", type: "file" },
        { name: "Terminal", type: "terminal", content: "output" },
        { name: "file2.ts", type: "file" },
      ];

      const result = serializeMentionsWithContext(text, mentions);
      assert.ok(result.cleanText.includes("file1.ts"));
      assert.ok(result.cleanText.includes("Terminal"));
      assert.ok(result.cleanText.includes("file2.ts"));
      assert.ok(result.contextText.includes("<referenced-items>"));
    });

    test("should handle missing placeholder gracefully", () => {
      const text = "Check __MENTION_99__";
      const mentions: Mention[] = [];
      const result = serializeMentionsWithContext(text, mentions);
      assert.strictEqual(result.cleanText, "Check __MENTION_99__");
    });
  });

  suite("parseMentionsFromText", () => {
    test("should parse multiple mentions from text", () => {
      const text = `Some text
<mention type="file" name="file.ts" path="/path/file.ts" />
More text
<mention type="terminal" name="Terminal"><![CDATA[output]]></mention>`;

      const mentions = parseMentionsFromText(text);
      assert.strictEqual(mentions.length, 2);
      assert.strictEqual(mentions[0].type, "file");
      assert.strictEqual(mentions[0].name, "file.ts");
      assert.strictEqual(mentions[1].type, "terminal");
      assert.strictEqual(mentions[1].content, "output");
    });

    test("should return empty array for text without mentions", () => {
      const mentions = parseMentionsFromText("Just plain text");
      assert.deepStrictEqual(mentions, []);
    });
  });

  suite("cleanMentionTags", () => {
    test("should replace mention tags with names", () => {
      const text = `Check
<mention type="file" name="file.ts" path="/path/file.ts" />
and
<mention type="selection" name="file.ts:1-5"><![CDATA[code]]></mention>`;

      const result = cleanMentionTags(text);
      assert.ok(result.includes("file.ts"));
      assert.ok(result.includes("file.ts:1-5"));
      assert.ok(!result.includes("<mention"));
    });
  });

  suite("stripMentionMarkup", () => {
    test("should remove all mention tags and context wrapper", () => {
      const text = `Message text
<referenced-items>
<mention type="file" name="file.ts" path="/path/file.ts" />
<mention type="terminal" name="Terminal"><![CDATA[output]]></mention>
</referenced-items>`;

      const result = stripMentionMarkup(text);
      assert.strictEqual(result.trim(), "Message text");
      assert.ok(!result.includes("<mention"));
      assert.ok(!result.includes("<referenced-items>"));
    });

    test("should clean up extra whitespace", () => {
      const text = `Before


<referenced-items>
<mention type="file" name="file.ts" />
</referenced-items>


After`;

      const result = stripMentionMarkup(text);
      // Should have at most 2 consecutive newlines
      assert.ok(!result.includes("\n\n\n"));
    });
  });

  suite("Round-trip serialization", () => {
    test("should preserve file mention through serialize -> parse cycle", () => {
      const original: Mention = {
        name: "example.ts",
        path: "/path/example.ts",
        type: "file",
      };
      const serialized = serializeMention(original);
      const parsed = parseMention(serialized);
      assert.deepStrictEqual(parsed, original);
    });

    test("should preserve selection mention through serialize -> parse cycle", () => {
      const original: Mention = {
        name: "example.ts:1-5",
        path: "/path/example.ts",
        type: "selection",
        content: "const x = 1;\nconst y = 2;",
        range: { startLine: 1, endLine: 5 },
      };
      const serialized = serializeMention(original);
      const parsed = parseMention(serialized);
      assert.deepStrictEqual(parsed, original);
    });

    test("should preserve terminal mention through serialize -> parse cycle", () => {
      const original: Mention = {
        name: "Terminal: bash",
        type: "terminal",
        content:
          "Done in 8.4s using pnpm v10.33.0\n[fiyqkrc@fiyqkrc-msi vscode-acp-chat]$",
      };
      const serialized = serializeMention(original);
      const parsed = parseMention(serialized);
      assert.deepStrictEqual(parsed, original);
    });

    test("should preserve image mention through serialize -> parse cycle", () => {
      // Note: serializeMention no longer includes dataUrl for images
      // The image content is sent as separate prompt item, so we only verify
      // that name and type are preserved
      const original: Mention = {
        name: "screenshot.png",
        type: "image",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      };
      const serialized = serializeMention(original);
      const parsed = parseMention(serialized);
      assert.ok(parsed);
      assert.strictEqual(parsed?.name, original.name);
      assert.strictEqual(parsed?.type, original.type);
      // dataUrl is intentionally not included in serialization to avoid sending twice
      assert.strictEqual(parsed?.dataUrl, undefined);
    });

    test("should handle complex message with multiple mentions", () => {
      const text = "Check __MENTION_0__ and __MENTION_1__ please";
      const mentions: Mention[] = [
        { name: "CHANGELOG.md", path: "/project/CHANGELOG.md", type: "file" },
        {
          name: "Terminal: bash",
          type: "terminal",
          content: "Done in 8.4s",
        },
      ];

      const { cleanText, contextText } = serializeMentionsWithContext(
        text,
        mentions
      );
      assert.strictEqual(
        cleanText,
        "Check CHANGELOG.md and Terminal: bash please"
      );
      assert.ok(contextText.includes("<referenced-items>"));

      // Parse back
      const fullText = cleanText + contextText;
      const parsedMentions = parseMentionsFromText(fullText);
      assert.strictEqual(parsedMentions.length, 2);
      assert.strictEqual(parsedMentions[0].name, "CHANGELOG.md");
      assert.strictEqual(parsedMentions[1].name, "Terminal: bash");
      assert.strictEqual(parsedMentions[1].content, "Done in 8.4s");
    });
  });
});

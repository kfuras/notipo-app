"use client";

import { useEffect, useMemo, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createCodeBlockSpec } from "@blocknote/core/blocks";
import "@blocknote/core/style.css";
import "@blocknote/shadcn/style.css";

const codeBlock = createCodeBlockSpec({
  supportedLanguages: {
    text: { name: "Plain Text" },
    javascript: { name: "JavaScript", aliases: ["js"] },
    typescript: { name: "TypeScript", aliases: ["ts"] },
    jsx: { name: "JSX" },
    tsx: { name: "TSX" },
    html: { name: "HTML" },
    css: { name: "CSS" },
    json: { name: "JSON" },
    python: { name: "Python", aliases: ["py"] },
    bash: { name: "Bash", aliases: ["sh", "shell"] },
    sql: { name: "SQL" },
    php: { name: "PHP" },
    ruby: { name: "Ruby", aliases: ["rb"] },
    go: { name: "Go" },
    rust: { name: "Rust", aliases: ["rs"] },
    java: { name: "Java" },
    csharp: { name: "C#", aliases: ["cs"] },
    yaml: { name: "YAML", aliases: ["yml"] },
    markdown: { name: "Markdown", aliases: ["md"] },
    xml: { name: "XML" },
  },
  defaultLanguage: "text",
});

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock,
  },
});

interface BlockEditorProps {
  initialMarkdown?: string;
  onChange: (markdown: string) => void;
  uploadFile?: (file: File) => Promise<string>;
}

export function BlockEditor({ initialMarkdown, onChange, uploadFile }: BlockEditorProps) {
  const initialized = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useCreateBlockNote({
    schema,
    uploadFile: uploadFile
      ? async (file: File) => {
          const url = await uploadFile(file);
          return url;
        }
      : undefined,
  });

  // Load initial markdown content once
  useEffect(() => {
    if (initialized.current || !initialMarkdown) return;
    initialized.current = true;

    (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
      editor.replaceBlocks(editor.document, blocks);
    })();
  }, [editor, initialMarkdown]);

  // Notify parent of changes
  const handleChange = useMemo(
    () => async () => {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      onChangeRef.current(markdown);
    },
    [editor],
  );

  return (
    <div className="bn-container [&_.bn-editor]:min-h-[400px] [&_.bn-editor]:text-[15px] [&_.bn-editor]:leading-relaxed">
      <BlockNoteView
        editor={editor}
        theme="dark"
        onChange={handleChange}
      />
    </div>
  );
}

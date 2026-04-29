"use client";

import { useEffect, useMemo, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/style.css";
import "@blocknote/shadcn/style.css";

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

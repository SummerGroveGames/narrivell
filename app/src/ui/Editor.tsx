import { type Editor as TiptapEditor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useEffect, useRef } from 'react';
import type { DocNode } from '../project/doc';

interface Props {
  initial: DocNode;
  onChange: (doc: DocNode) => void;
  typewriter: boolean;
  /** Extra toolbar buttons at the right end. */
  tools?: ReactNode;
  /** Gives the parent the editor, e.g. to split at the cursor or scroll to a paragraph. */
  onReady?: (editor: TiptapEditor | null) => void;
  /** Splits the unit at the cursor. */
  onSplit?: () => void;
}

/**
 * The manuscript editor for one unit. Remounted (via a React key) for each
 * unit, so undo history never leaks from one unit into another.
 */
export function Editor({ initial, onChange, typewriter, tools, onReady, onSplit }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Links could navigate the app window away from the manuscript; not needed for prose.
        link: false,
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
    ],
    content: initial,
    // TipTap normally injects a <style> tag, which our strict Content-Security-Policy blocks;
    // the equivalent rules are in app.css instead.
    injectCSS: false,
    editorProps: {
      attributes: {
        class: 'manuscript',
        spellcheck: 'true',
        lang: 'en',
        'aria-label': 'Manuscript text',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as DocNode),
  });

  useEffect(() => {
    onReady?.(editor ?? null);
    return () => onReady?.(null);
  }, [editor]);

  // Typewriter scrolling: keep the line being typed a little above the middle of the page.
  const typewriterOn = useRef(typewriter);
  typewriterOn.current = typewriter;
  useEffect(() => {
    if (!editor) return;
    const centre = () => {
      if (!typewriterOn.current || !editor.isFocused) return;
      const scroller = editor.view.dom.closest('.page');
      if (!scroller) return;
      const caret = editor.view.coordsAtPos(editor.state.selection.head);
      const box = scroller.getBoundingClientRect();
      scroller.scrollBy({ top: caret.top - (box.top + box.height * 0.45) });
    };
    editor.on('selectionUpdate', centre);
    editor.on('update', centre);
    return () => {
      editor.off('selectionUpdate', centre);
      editor.off('update', centre);
    };
  }, [editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
      heading: editor?.isActive('heading', { level: 2 }) ?? false,
      canUndo: editor?.can().undo() ?? false,
      canRedo: editor?.can().redo() ?? false,
    }),
  });

  if (!editor) return null;
  const tool = (label: ReactNode, title: string, on: boolean, action: () => void, disabled = false) => (
    <button
      type="button"
      className={`tool ${on ? 'tool--on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {label}
    </button>
  );

  return (
    <div className={`editor ${typewriter ? 'editor--typewriter' : ''}`}>
      <div className="toolbar" role="toolbar" aria-label="Formatting">
        {tool(<b>B</b>, 'Bold (Ctrl+B)', state?.bold ?? false, () => editor.chain().focus().toggleBold().run())}
        {tool(<i>I</i>, 'Italic (Ctrl+I)', state?.italic ?? false, () => editor.chain().focus().toggleItalic().run())}
        {tool('H', 'Heading', state?.heading ?? false, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {tool('⁂', 'Scene break', false, () => editor.chain().focus().setHorizontalRule().run())}
        <span className="toolbar__sep" />
        {tool('↶', 'Undo (Ctrl+Z)', false, () => editor.chain().focus().undo().run(), !state?.canUndo)}
        {tool('↷', 'Redo (Ctrl+Y)', false, () => editor.chain().focus().redo().run(), !state?.canRedo)}
        <span className="toolbar__gap" />
        {onSplit && (
          <button
            type="button"
            className="tool tool--text"
            title="Split here: everything after the cursor becomes a new microchapter"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSplit}
          >
            ✂ Split here
          </button>
        )}
        {tools}
      </div>
      <EditorContent editor={editor} className="page" />
    </div>
  );
}

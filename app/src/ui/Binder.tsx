import { type DragEvent, useEffect, useState } from 'react';
import type { Book, TreeNode } from '../core/structure';
import { numberTree } from '../core/structure';
import type { DropPosition } from '../project/tree';

interface Props {
  book: Book;
  selectedId: string | null;
  words: Map<string, number>;
  collapsed: Set<string>;
  target: { min: number; max: number } | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, targetId: string, position: DropPosition) => void;
  onAddAfter: (id: string) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
  onTrash: (id: string) => void;
  onMerge: (id: string) => void;
}

const DRAG_TYPE = 'application/x-narrivell-node';

export function Binder(props: Props) {
  const { book, selectedId, words, collapsed, target, onToggle, onSelect, onRename, onMove } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const numbers = numberTree(book);
  const levelIndex = (n: TreeNode) =>
    n.kind === 'unit' ? book.structure.levels.length - 1 : book.structure.levels.findIndex((l) => l.id === n.levelId);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const wordsIn = (node: TreeNode): number =>
    node.kind === 'unit' ? (words.get(node.id) ?? 0) : node.children.reduce((sum, c) => sum + wordsIn(c), 0);

  const positionFor = (e: DragEvent, node: TreeNode): DropPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (node.kind === 'container') return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    return y < 0.5 ? 'before' : 'after';
  };

  const render = (nodes: TreeNode[], depth: number) => (
    <ul className={depth === 0 ? 'binder' : 'binder__children'} role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        const selected = node.id === selectedId;
        const isCollapsed = node.kind === 'container' && collapsed.has(node.id);
        const num = numbers.get(node.id)?.label ?? '';
        const count = wordsIn(node);
        const hint = drop?.id === node.id ? drop.position : null;
        const offTarget = node.kind === 'unit' && target && count > 0 && (count < target.min || count > target.max);
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={node.kind === 'container' ? !isCollapsed : undefined}
            className={`binder__node binder__node--l${Math.min(levelIndex(node), 3)}`}
          >
            <div
              className={`binder__row ${hint ? `binder__row--drop-${hint}` : ''}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                const position = positionFor(e, node);
                if (drop?.id !== node.id || drop.position !== position) setDrop({ id: node.id, position });
              }}
              onDragLeave={() => setDrop((d) => (d?.id === node.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData(DRAG_TYPE);
                setDrop(null);
                if (id && id !== node.id) onMove(id, node.id, positionFor(e, node));
              }}
            >
              {node.kind === 'container' ? (
                <button
                  type="button"
                  className="binder__twisty"
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  onClick={() => onToggle(node.id)}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="binder__twisty" aria-hidden="true" />
              )}
              {editing === node.id ? (
                <input
                  className="binder__rename"
                  defaultValue={node.title}
                  aria-label="Title"
                  autoFocus
                  maxLength={500}
                  onBlur={(e) => {
                    onRename(node.id, e.target.value.trim());
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  draggable
                  className={`binder__item binder__item--${node.kind} ${selected ? 'binder__item--on' : ''}`}
                  onClick={() => onSelect(node.id)}
                  onDoubleClick={() => setEditing(node.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onSelect(node.id);
                    setMenu({ id: node.id, x: e.clientX, y: e.clientY });
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, node.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDrop(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') setEditing(node.id);
                    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                      e.preventDefault();
                      props.onNudge(node.id, e.key === 'ArrowUp' ? -1 : 1);
                    }
                    if (node.kind === 'container' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                      if ((e.key === 'ArrowLeft') !== isCollapsed) onToggle(node.id);
                    }
                  }}
                  title="Drag to move · double-click or F2 to rename · right-click for more"
                >
                  <span className="binder__label">
                    {num && <span className="binder__num">{num}</span>}
                    <span className={node.title ? 'binder__title' : 'binder__title muted'}>
                      {node.title || (num ? '' : 'Untitled')}
                    </span>
                  </span>
                  <span className={`binder__words ${offTarget ? 'binder__words--off' : ''}`}>{count.toLocaleString()}</span>
                </button>
              )}
            </div>
            {node.kind === 'container' && !isCollapsed && node.children.length > 0 && render(node.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  const menuNode = menu ? findIn(book.children, menu.id) : null;
  const item = (label: string, action: () => void) => (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          setMenu(null);
          action();
        }}
      >
        {label}
      </button>
    </li>
  );

  return (
    <nav aria-label="Manuscript">
      {render(book.children, 0)}
      {menu && menuNode && (
        <ul className="menu__list context-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 260) }}>
          {item('Rename', () => setEditing(menu.id))}
          {item(`Add ${book.structure.levels[book.structure.levels.length - 1].name.toLowerCase()}`, () => props.onAddAfter(menu.id))}
          {item('Move up', () => props.onNudge(menu.id, -1))}
          {item('Move down', () => props.onNudge(menu.id, 1))}
          {menuNode.kind === 'unit' && item('Merge with next', () => props.onMerge(menu.id))}
          {menuNode.kind === 'container' && item(collapsed.has(menu.id) ? 'Expand' : 'Collapse', () => onToggle(menu.id))}
          <li role="none" className="menu__divider" />
          {item('Move to trash…', () => props.onTrash(menu.id))}
        </ul>
      )}
    </nav>
  );
}

function findIn(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === 'container') {
      const f = findIn(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

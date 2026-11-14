import { Fragment, type ReactNode } from "react";
import { parseNotes, type Block, type InlineNode } from "@/lib/igreja/notes-markup";

/** Marcação do caderno como elementos React (texto sempre escapado pelo React; nunca HTML bruto). */
function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === "text") return <Fragment key={i}>{n.v}</Fragment>;
    const kids = <Inline nodes={n.c} />;
    if (n.t === "b") return <strong key={i}>{kids}</strong>;
    if (n.t === "i") return <em key={i}>{kids}</em>;
    if (n.t === "u") return <u key={i}>{kids}</u>;
    return (
      <mark key={i} className="rounded-[4px] bg-[color-mix(in_srgb,#facc15_45%,transparent)] px-0.5 text-inherit">
        {kids}
      </mark>
    );
  });
}

export function NotesView({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseNotes(text);
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b: Block = blocks[i];
    if (b.t === "li") {
      const items: { key: number; c: InlineNode[] }[] = [];
      for (let nb: Block | undefined = blocks[i]; nb && nb.t === "li"; nb = blocks[i]) {
        items.push({ key: i, c: nb.c });
        i++;
      }
      i--;
      out.push(
        <ul key={`ul${items[0].key}`} className="list-disc pl-5">
          {items.map((it) => (
            <li key={it.key} className="whitespace-pre-wrap break-words">
              <Inline nodes={it.c} />
            </li>
          ))}
        </ul>,
      );
    } else if (b.t === "h") {
      out.push(
        <h4 key={i} className="break-words pt-1 text-[17px] font-semibold tracking-tight">
          <Inline nodes={b.c} />
        </h4>,
      );
    } else if (b.t === "blank") {
      out.push(<div key={i} aria-hidden className="h-2.5" />);
    } else {
      out.push(
        <p key={i} className="whitespace-pre-wrap break-words">
          <Inline nodes={b.c} />
        </p>,
      );
    }
  }
  return (
    <div data-testid="notas-render" className={`flex flex-col ${className}`}>
      {out}
    </div>
  );
}

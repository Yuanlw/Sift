import type { ReactNode } from "react";

export function FormattedAnswer({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className="formatted-answer">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <h3 key={index}>{renderInline(block.text)}</h3>;
        }

        if (block.type === "ordered") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === "unordered") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

type AnswerBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ordered"; items: string[] }
  | { type: "unordered"; items: string[] };

function parseBlocks(text: string): AnswerBlock[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: AnswerBlock[] = [];

  for (const line of lines) {
    const heading = line.match(/^\*\*(.+?)\*\*[:：]?$/);
    const ordered = line.match(/^\d+[.)、]\s*(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);

    if (heading) {
      blocks.push({ type: "heading", text: heading[1] });
      continue;
    }

    if (ordered) {
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "ordered") {
        previous.items.push(ordered[1]);
      } else {
        blocks.push({ type: "ordered", items: [ordered[1]] });
      }
      continue;
    }

    if (unordered) {
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "unordered") {
        previous.items.push(unordered[1]);
      } else {
        blocks.push({ type: "unordered", items: [unordered[1]] });
      }
      continue;
    }

    blocks.push({ type: "paragraph", text: line });
  }

  return blocks;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[KS]\d+\])/g);
  const nodes: ReactNode[] = [];

  for (const [index, part] of parts.entries()) {
    if (!part) {
      continue;
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={index}>{part.slice(2, -2)}</strong>);
      continue;
    }

    if (/^\[[KS]\d+\]$/.test(part)) {
      nodes.push(
        <span className="inline-citation" key={index}>
          {part}
        </span>,
      );
      continue;
    }

    nodes.push(part);
  }

  return nodes;
}

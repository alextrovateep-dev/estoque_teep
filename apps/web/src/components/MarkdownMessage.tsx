import React, { ReactNode } from "react";

type TableAlignment = "left" | "center" | "right";

function parseTableAlignment(separatorCell: string): TableAlignment {
  const trimmed = separatorCell.trim();
  const startsWithColon = trimmed.startsWith(":");
  const endsWithColon = trimmed.endsWith(":");
  if (startsWithColon && endsWithColon) return "center";
  if (endsWithColon) return "right";
  return "left";
}

function splitTableRow(rowStr: string): string[] {
  let s = rowStr.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|");
}

function renderInline(text: string): ReactNode[] {
  // Regex para tokens: `code`, **bold**, *italic*
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded border border-slate-200/80 bg-slate-100 px-1 py-0.5 font-mono text-[11px] font-semibold text-slate-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {renderInline(part.slice(2, -2))}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={idx} className="italic text-slate-700">
          {renderInline(part.slice(1, -1))}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

type Block =
  | { type: "heading"; level: number; text: string }
  | {
      type: "table";
      headers: string[];
      alignments: TableAlignment[];
      rows: string[][];
    }
  | {
      type: "list";
      ordered: boolean;
      items: Array<{ text: string; indent: number }>;
    }
  | { type: "paragraph"; text: string };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Tabela: pelo menos 2 linhas (cabeçalho + separador)
    if (
      isTableLine(rawLine) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(rawLine);
      const sepLine = lines[i + 1];
      const alignments = splitTableRow(sepLine).map(parseTableAlignment);
      const rows: string[][] = [];
      i += 2;

      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }

      blocks.push({
        type: "table",
        headers,
        alignments,
        rows,
      });
      continue;
    }

    // Cabeçalhos (###, ##, #)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Listas: itens com "-", "*", ou "1."
    const listMatch = rawLine.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const isOrdered = /^\d+\./.test(listMatch[2]);
      const items: Array<{ text: string; indent: number }> = [];

      while (i < lines.length) {
        const itemLine = lines[i];
        const match = itemLine.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
        if (!match) break;
        const indentLevel = Math.floor(match[1].length / 2);
        items.push({ text: match[3], indent: indentLevel });
        i++;
      }

      blocks.push({
        type: "list",
        ordered: isOrdered,
        items,
      });
      continue;
    }

    // Parágrafos regulares: acumula linhas até linha em branco ou outro bloco
    const pLines: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) break;
      if (
        (isTableLine(line) &&
          i + 1 < lines.length &&
          isTableSeparator(lines[i + 1])) ||
        t.match(/^#{1,4}\s+/) ||
        line.match(/^(\s*)([-*]|\d+\.)\s+/)
      ) {
        break;
      }
      pLines.push(t);
      i++;
    }

    if (pLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: pLines.join(" "),
      });
    }
  }

  return blocks;
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2 text-sm text-slate-700">
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          const Tag =
            block.level === 1
              ? "h3"
              : block.level === 2
                ? "h4"
                : "h5";
          return (
            <Tag
              key={idx}
              className={`font-semibold text-slate-800 ${
                block.level === 1
                  ? "mt-3 text-base"
                  : block.level === 2
                    ? "mt-2.5 text-sm"
                    : "mt-2 text-xs uppercase tracking-wide text-slate-600"
              }`}
            >
              {renderInline(block.text)}
            </Tag>
          );
        }

        if (block.type === "table") {
          return (
            <div
              key={idx}
              className="my-2.5 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs"
            >
              <table className="w-full min-w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/90 font-semibold text-slate-700">
                    {block.headers.map((h, hIdx) => {
                      const align = block.alignments[hIdx] || "left";
                      const alignClass =
                        align === "center"
                          ? "text-center"
                          : align === "right"
                            ? "text-right"
                            : "text-left";
                      return (
                        <th
                          key={hIdx}
                          className={`whitespace-nowrap px-3 py-2 ${alignClass}`}
                        >
                          {renderInline(h)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {block.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="transition-colors hover:bg-slate-50/70"
                    >
                      {row.map((cell, cIdx) => {
                        const align = block.alignments[cIdx] || "left";
                        const alignClass =
                          align === "center"
                            ? "text-center"
                            : align === "right"
                              ? "text-right"
                              : "text-left";
                        return (
                          <td
                            key={cIdx}
                            className={`px-3 py-1.5 text-slate-700 ${alignClass} ${
                              cIdx <= 1 ? "whitespace-nowrap" : ""
                            }`}
                          >
                            {renderInline(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag
              key={idx}
              className={`my-1.5 space-y-1 text-sm text-slate-700 ${
                block.ordered ? "list-decimal pl-5" : "list-disc pl-5"
              }`}
            >
              {block.items.map((item, itemIdx) => (
                <li
                  key={itemIdx}
                  className={`leading-relaxed ${
                    item.indent > 0 ? "ml-4 list-[circle]" : ""
                  }`}
                >
                  {renderInline(item.text)}
                </li>
              ))}
            </Tag>
          );
        }

        return (
          <p key={idx} className="leading-relaxed">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

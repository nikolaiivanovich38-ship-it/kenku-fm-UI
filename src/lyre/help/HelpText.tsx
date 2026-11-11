import React from "react";
import { Kbd } from "../kit/Pills";
import { blocksOf, type HelpSpan } from "./articles";

/** An article's text (articles.ts format): paragraphs, steps and lists; labels in bold, keys as keys. */
export function HelpText({ body }: { body: string }) {
  return (
    <>
      {blocksOf(body).map((block, b) => {
        if (block.kind === "p") return <p key={b}>{spans(block.lines[0])}</p>;
        const List = block.kind;
        return (
          <List key={b}>
            {block.lines.map((line, i) => (
              <li key={i}>{spans(line)}</li>
            ))}
          </List>
        );
      })}
    </>
  );
}

function spans(line: HelpSpan[]) {
  return line.map((span, i) =>
    span.mark === "label" ? <b key={i}>{span.text}</b> : span.mark === "key" ? <Kbd key={i}>{span.text}</Kbd> : <React.Fragment key={i}>{span.text}</React.Fragment>,
  );
}

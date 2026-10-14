import { useEffect, useState } from "react";
import { Braces, LoaderCircle } from "lucide-react";
import { loadBookSections } from "./lib/book";
import { findRelevantBookCodeBlocks, type BookCodeBlock } from "./lib/bookSections";

type Props = {
  sectionId: string;
  previousSectionIds: string[];
  pageStart: number;
};

export function BookCodeContext({ sectionId, previousSectionIds, pageStart }: Props) {
  const [currentBlocks, setCurrentBlocks] = useState<BookCodeBlock[]>([]);
  const [earlierBlocks, setEarlierBlocks] = useState<BookCodeBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const previousIdsKey = previousSectionIds.join("\n");

  useEffect(() => {
    let active = true;
    setCurrentBlocks([]);
    setEarlierBlocks([]);
    setLoading(true);
    const ids = previousIdsKey ? previousIdsKey.split("\n") : [];
    void loadBookSections([sectionId, ...ids]).then((sections) => {
      if (!active) return;
      const current = sections.find((section) => section.id === sectionId);
      const previous = sections.filter((section) => section.id !== sectionId);
      const codeBlocks = current?.codeBlocks ?? [];
      setCurrentBlocks(codeBlocks);
      setEarlierBlocks(findRelevantBookCodeBlocks(current?.text ?? "", codeBlocks, previous, pageStart, 3));
    }).catch(() => {
      if (active) {
        setCurrentBlocks([]);
        setEarlierBlocks([]);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [sectionId, previousIdsKey, pageStart]);

  if (!loading && !currentBlocks.length && !earlierBlocks.length) return null;

  return (
    <section className="book-code-context" aria-label="Code snippets from this book">
      <header>
        <div><Braces size={19} /><div><span className="eyebrow">Code from the book</span><h3>Keep the example connected</h3></div></div>
        {loading && <span className="book-code-loading"><LoaderCircle size={15} className="spin" /> Finding related snippets…</span>}
      </header>
      {currentBlocks.length > 0 && <div className="book-code-group">
        <h4>On these pages</h4>
        {currentBlocks.map((block) => <CodeSnippet key={block.id} block={block} />)}
      </div>}
      {earlierBlocks.length > 0 && <div className="book-code-group earlier">
        <h4>Earlier code this section may build on</h4>
        {earlierBlocks.map((block) => <CodeSnippet key={block.id} block={block} continuationIntoCurrent={currentBlocks.some((current) => current.page === block.page + 1) && block.endsNearBottom} />)}
      </div>}
    </section>
  );
}

function CodeSnippet({ block, continuationIntoCurrent = false }: { block: BookCodeBlock; continuationIntoCurrent?: boolean }) {
  return (
    <details className="book-code-snippet">
      <summary><span>PDF page {block.page} · {block.language}{continuationIntoCurrent ? " · may continue below" : ""}</span>{block.definedSymbols.length > 0 && <small>Defines {block.definedSymbols.slice(0, 3).join(", ")}</small>}</summary>
      <pre><code>{block.code}</code></pre>
    </details>
  );
}

import { useEffect, useState } from "react";
import { BookImage, LoaderCircle } from "lucide-react";
import { loadBookPageImages, type BookPageImage } from "./lib/book";

type Props = { bookId: string; pageStart: number; pageEnd: number };

export function BookSourcePages({ bookId, pageStart, pageEnd }: Props) {
  const [images, setImages] = useState<BookPageImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setImages([]);
    setLoading(true);
    setError("");
    void loadBookPageImages(bookId, pageStart, pageEnd).then((pages) => {
      if (current) setImages(pages);
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "Could not load the original PDF pages.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [bookId, pageStart, pageEnd]);

  return (
    <section className="book-source-pages" aria-label="Original pages from the book">
      <header>
        <div><BookImage size={19} /><div><span className="eyebrow">From your PDF</span><h3>Original pages</h3></div></div>
        {loading && <span className="book-source-loading"><LoaderCircle size={15} className="spin" /> Loading pages…</span>}
      </header>
      {error ? <p className="book-source-error" role="status">{error}</p> : (
        <div className="book-source-grid">
          {images.map((image) => (
            <figure key={image.page}>
              <a href={image.dataUrl} target="_blank" rel="noreferrer" aria-label={`Open original PDF page ${image.page} full size`}>
                <img src={image.dataUrl} alt={`Original book page ${image.page}`} loading="lazy" />
              </a>
              <figcaption>PDF page {image.page}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

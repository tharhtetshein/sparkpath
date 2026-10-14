import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { extractPageCodeBlocks } from "./bookCode";
import { BookCodeBlock, BookSection } from "./bookSections";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DB_NAME = "sparkpath-books-v1";
const STORE_NAME = "sections";
const PDF_STORE_NAME = "source-pdfs";
const MAX_CACHED_BOOK_SECTIONS = 2000;
const bookSectionCache = new Map<string, BookSection>();
const IMAGE_OPERATOR_NAMES = [
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintImageMaskXObjectGroup",
  "paintImageXObjectRepeat",
];

export type ExtractedBookPages = { pages: string[]; imagePages: number[]; codeBlocks: BookCodeBlock[] };

export async function extractBookPages(file: File): Promise<ExtractedBookPages> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a PDF book.");
  }
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  const imagePages: number[] = [];
  const codeBlocks: BookCodeBlock[] = [];
  const imageOperatorCodes = new Set(IMAGE_OPERATOR_NAMES
    .map((name) => (pdfjs.OPS as unknown as Record<string, number>)[name])
    .filter((code): code is number => typeof code === "number"));
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim());
    codeBlocks.push(...extractPageCodeBlocks(number, content.items, content.styles, page.getViewport({ scale: 1 }).height));
    try {
      const operatorList = await page.getOperatorList();
      if (operatorList.fnArray.some((operator) => imageOperatorCodes.has(operator))) imagePages.push(number);
    } catch {
      imagePages.push(number);
    }
  }
  await loadingTask.destroy();
  if (pages.join("").length < 200) {
    throw new Error("This PDF has too little selectable text. Please use a text-based or OCR-processed PDF.");
  }
  return { pages, imagePages, codeBlocks };
}

function openBookDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(PDF_STORE_NAME)) db.createObjectStore(PDF_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Book storage is unavailable."));
  });
}

export async function saveBookPdf(bookId: string, file: File): Promise<void> {
  const db = await openBookDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PDF_STORE_NAME, "readwrite");
      transaction.objectStore(PDF_STORE_NAME).put(file, bookId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the original PDF."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the original PDF."));
    });
  } finally {
    db.close();
  }
}

export type BookPageImage = { page: number; dataUrl: string };

export async function loadBookPageImages(bookId: string, pageStart: number, pageEnd: number): Promise<BookPageImage[]> {
  const db = await openBookDb();
  let file: Blob | undefined;
  try {
    file = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(PDF_STORE_NAME, "readonly").objectStore(PDF_STORE_NAME).get(bookId);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not load the original PDF."));
    });
  } finally {
    db.close();
  }
  if (!file) throw new Error("The original PDF is not saved in this browser. Reimport the book to view its page images.");

  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  try {
    const images: BookPageImage[] = [];
    for (let pageNumber = Math.max(1, pageStart); pageNumber <= Math.min(pageEnd, pdf.numPages); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 1200 / baseViewport.width, 1600 / baseViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not render PDF pages as images.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      images.push({ page: pageNumber, dataUrl: canvas.toDataURL("image/jpeg", 0.84) });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return images;
  } finally {
    await loadingTask.destroy();
  }
}

export async function saveBookSections(sections: BookSection[]): Promise<void> {
  if (bookSectionCache.size + sections.length > MAX_CACHED_BOOK_SECTIONS) bookSectionCache.clear();
  const db = await openBookDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      sections.forEach((section) => store.put(section, section.id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the book."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the book."));
    });
    sections.forEach((section) => bookSectionCache.set(section.id, section));
  } finally {
    db.close();
  }
}

export async function loadBookSection(id: string): Promise<BookSection> {
  const cached = bookSectionCache.get(id);
  if (cached) return cached;
  const loaded = (await loadBookSections([id]))[0];
  if (!loaded) throw new Error("Book text is missing from this browser. Reimport the PDF to continue.");
  return loaded;
}

export async function loadBookSections(ids: string[]): Promise<BookSection[]> {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  const cached = new Map<string, BookSection>();
  uniqueIds.forEach((id) => {
    const section = bookSectionCache.get(id);
    if (section) cached.set(id, section);
  });
  const missingIds = uniqueIds.filter((id) => !cached.has(id));
  if (missingIds.length) {
    const db = await openBookDb();
    try {
      const loaded = await new Promise<Map<string, BookSection>>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const results = new Map<string, BookSection>();
        missingIds.forEach((id) => {
          const request = store.get(id);
          request.onsuccess = () => {
            if (request.result) results.set(id, request.result as BookSection);
          };
        });
        transaction.oncomplete = () => resolve(results);
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not load the book sections."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Could not load the book sections."));
      });
      if (bookSectionCache.size + loaded.size > MAX_CACHED_BOOK_SECTIONS) bookSectionCache.clear();
      loaded.forEach((section, id) => {
        cached.set(id, section);
        bookSectionCache.set(id, section);
      });
    } finally {
      db.close();
    }
  }
  return uniqueIds.flatMap((id) => {
    const section = cached.get(id) ?? bookSectionCache.get(id);
    return section ? [section] : [];
  });
}

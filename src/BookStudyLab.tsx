import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import type { BookStudio } from "./lib/bookStudio";

export function BookStudyLab({ studio, pageStart, pageEnd, onRetry, retryBusy = false }: { studio: BookStudio; pageStart: number; pageEnd: number; onRetry?: () => void; retryBusy?: boolean }) {
  const [activeConcept, setActiveConcept] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);

  useEffect(() => {
    setActiveConcept(0);
    setActiveStep(0);
    setSelectedChoice(null);
  }, [studio.generatedAt]);

  const pageLabel = pageStart === pageEnd ? `PDF page ${pageStart}` : `PDF pages ${pageStart}–${pageEnd}`;
  const concept = studio.concepts[activeConcept];
  const step = studio.steps[activeStep];
  const check = studio.check[0];
  const pageCoverage = studio.pageCoverage ?? [];
  const coverageComplete = studio.coverageComplete === true;
  const hasActivity = studio.concepts.length || studio.steps.length || check;

  return (
    <section className="book-studio" aria-label="Interactive book study">
      <header className="book-studio-head">
        <div>
          <span className="eyebrow"><Sparkles size={15} /> Study studio</span>
          <h3>Make the ideas click.</h3>
          <p>Trace the idea, try an example, then check what stuck.</p>
        </div>
        <span className="book-studio-pages">{pageLabel}</span>
      </header>

      {!hasActivity && (
        <div className="book-studio-sparse">
          <BookOpen size={26} />
          <div>
            <strong>{studio.emptyReason === "source_check" ? "This activity could not be verified against the PDF." : studio.emptyReason === "visual_content" ? "This section contains pages the text reader could not inspect." : "This section is mainly front matter or a short transition."}</strong>
            <p>{studio.emptyReason === "source_check" ? "The full lesson is below. You can try building the study tools again." : studio.emptyReason === "visual_content" ? "Scanned pages or embedded figures are listed in the page coverage notes. OCR processing is needed to include their contents." : "Read the notes below, or move on to the next section."}</p>
            {studio.emptyReason === "source_check" && onRetry && <button type="button" disabled={retryBusy} onClick={onRetry}>{retryBusy ? "Checking again..." : "Try again"}</button>}
          </div>
        </div>
      )}

      {!!studio.concepts.length && (
        <div className="book-concept-area">
          <div className="book-studio-section-head"><span>01 / See it</span><h4>{studio.diagramTitle}</h4></div>
          <div className="book-concept-track" aria-label="Concept flow">
            {studio.concepts.map((item, index) => (
              <button key={`${item.label}-${index}`} type="button" aria-pressed={index === activeConcept} className={index === activeConcept ? "active" : ""} onClick={() => setActiveConcept(index)}>
                <small>{String(index + 1).padStart(2, "0")}</small>
                <strong>{item.label}</strong>
                {index < studio.concepts.length - 1 && <ArrowRight size={16} aria-hidden="true" />}
              </button>
            ))}
          </div>
          {concept && (
            <div className="book-concept-detail" aria-live="polite">
              <span>Focus {String(activeConcept + 1).padStart(2, "0")}</span>
              <h5>{concept.label}</h5>
              <p>{concept.explanation}</p>
              <blockquote>From the PDF: “{concept.sourcePhrase}”</blockquote>
            </div>
          )}
        </div>
      )}

      {!!studio.steps.length && step && (
        <div className="book-walkthrough">
          <div className="book-studio-section-head"><span>02 / Try it</span><h4>A guided example</h4></div>
          <div className="book-step-stage">
            <div className="book-step-count"><strong>{String(activeStep + 1).padStart(2, "0")}</strong><span>of {String(studio.steps.length).padStart(2, "0")}</span></div>
            <div className="book-step-copy" key={`${studio.generatedAt}-${activeStep}`}>
              <h5>{step.title}</h5>
              <p>{step.action}</p>
              <div><Check size={17} aria-hidden="true" /><span>{step.outcome}</span></div>
            </div>
          </div>
          <div className="book-step-controls">
            <div className="book-step-dots" aria-label="Example progress">{studio.steps.map((item, index) => <button key={`${item.title}-${index}`} type="button" aria-label={`Show step ${index + 1}`} aria-current={index === activeStep ? "step" : undefined} className={index === activeStep ? "active" : ""} onClick={() => setActiveStep(index)} />)}</div>
            <div>
              <button type="button" aria-label="Previous example step" disabled={activeStep === 0} onClick={() => setActiveStep((current) => current - 1)}><ChevronLeft size={18} /></button>
              <button type="button" aria-label="Next example step" disabled={activeStep === studio.steps.length - 1} onClick={() => setActiveStep((current) => current + 1)}><ChevronRight size={18} /></button>
            </div>
          </div>
        </div>
      )}

      {check && (
        <div className="book-quick-check">
          <div className="book-studio-section-head"><span>03 / Check it</span><h4>One-minute challenge</h4></div>
          <p className="book-check-question">{check.question}</p>
          <div className="book-check-options">
            {check.choices.map((choice, index) => (
              <button key={`${choice}-${index}`} type="button" aria-pressed={selectedChoice === index} className={selectedChoice === index ? index === check.correctIndex ? "correct" : "incorrect" : ""} onClick={() => setSelectedChoice(index)}>
                <span>{String.fromCharCode(65 + index)}</span>{choice}
              </button>
            ))}
          </div>
          {selectedChoice !== null && (
            <div className={`book-check-feedback ${selectedChoice === check.correctIndex ? "correct" : "incorrect"}`} role="status">
              <strong>{selectedChoice === check.correctIndex ? "Exactly." : "Not quite. Look at the book clue below."}</strong>
              <p>{check.explanation}</p>
              <blockquote>Book clue: “{check.sourcePhrase}”</blockquote>
              {selectedChoice !== check.correctIndex && <button type="button" onClick={() => setSelectedChoice(null)}><RotateCcw size={15} /> Try again</button>}
            </div>
          )}
        </div>
      )}

      {!!pageCoverage.length && (
        <aside className={`book-coverage ${coverageComplete ? "complete" : "incomplete"}`} aria-live="polite">
          <div><strong>{coverageComplete ? "Page coverage checked" : "Some page content needs review"}</strong><span>{pageCoverage.filter((page) => page.complete).length}/{pageCoverage.length} PDF pages covered</span></div>
          {!coverageComplete && (
            <ul>
              {pageCoverage.filter((page) => !page.complete).slice(0, 6).map((page) => (
                <li key={page.page}><strong>PDF page {page.page}</strong> {page.missing.join(" ") || "Coverage was not confirmed."}</li>
              ))}
              {pageCoverage.filter((page) => !page.complete).length > 6 && <li>More pages need review in this section.</li>}
            </ul>
          )}
        </aside>
      )}
    </section>
  );
}

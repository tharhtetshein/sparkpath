import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { AgentResult, RankedJob, StudentInput } from "./agent";

export async function buildApplicationDocx(input: StudentInput, result: AgentResult, job: RankedJob) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: `${input.name || "Student"} - Application Portfolio`,
            heading: HeadingLevel.TITLE,
          }),
          line(`${job.title} at ${job.company}`),
          line(`${job.location} | Source: ${job.source}`),
          linkLine(job.url),
          spacer(),
          heading("Tailored Summary"),
          line(
            `${input.name || "This candidate"} is targeting ${input.targetRole || job.title}. ${input.headline || "The profile is built from uploaded evidence, GitHub work, and project notes."}`,
          ),
          line(`Match: ${job.matchLabel}. ${job.missingSignal}`),
          spacer(),
          heading("Why This Job Fits"),
          ...bulletList(job.reasons.length ? job.reasons : ["Add more evidence to strengthen job-specific reasons."]),
          spacer(),
          heading("Proof-of-Work Evidence"),
          ...result.skills.slice(0, 5).flatMap((skill) => [
            new Paragraph({
              children: [new TextRun({ text: skill.name, bold: true })],
            }),
            ...bulletList(skill.evidence.map((entry) => `${entry.quote} (${entry.sourceTitle})`).slice(0, 3)),
          ]),
          spacer(),
          heading("Links"),
          ...bulletList((input.links || "Add LinkedIn, GitHub, portfolio, and deployed project links.").split(/\n|,\s*/).filter(Boolean)),
          spacer(),
          heading("Job Description Snapshot"),
          line(job.description.slice(0, 1800) || "Open the job listing for the full description."),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

function heading(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function line(text: string) {
  return new Paragraph({ text, spacing: { after: 160 } });
}

function linkLine(url: string) {
  return new Paragraph({
    children: [new TextRun({ text: url, color: "315f7e", underline: {} })],
    spacing: { after: 160 },
  });
}

function spacer() {
  return new Paragraph({ text: "", spacing: { after: 120 } });
}

function bulletList(items: string[]) {
  return items.map((item) => new Paragraph({
    text: item,
    bullet: { level: 0 },
    spacing: { after: 100 },
  }));
}

"use client";

/* eslint-disable @next/next/no-img-element -- print layout needs plain <img> */

import { Fragment } from "react";

/*
 * Printable OJT narrative report following the school's pattern: cover, title
 * page, table of contents, then one page (or more, if the content overflows)
 * per template section. `data` is the payload of
 * /api/intern/portfolio/narrative-report (also served to coordinators).
 *
 * Each sheet is a one-column table whose <thead> holds the letterhead, so the
 * browser repeats it on every printed page of that sheet (long journals and
 * ledgers included). A fixed-position header was tried first but Chrome drops
 * it on the final page.
 */

const CHED_ADDRESS = "Higher Education Development Center (HEC Bldg.) C.P Garcia Avenue, Diliman, Quezon City";

const css = `
.nr-root { font-family: "Arial Narrow", Arial, sans-serif; font-size: 12pt; line-height: 1.35; color: #000; }
.nr-root * { box-sizing: border-box; }
.nr-scroll { overflow-x: auto; padding: 24px 0; background: #cbd5e1; }
.nr-sheet { position: relative; width: 8.5in; min-height: 13in; margin: 0 auto 24px; padding: 0.4in 1.25in 1in; background: #fff; box-shadow: 0 2px 12px rgba(15, 23, 42, 0.25); }
.nr-wrap { width: 100%; border-collapse: collapse; }
.nr-wrap > thead, .nr-wrap > tbody { display: table-row-group; }
.nr-wrap > thead { display: table-header-group; }
.nr-wrap > thead > tr > td, .nr-wrap > tbody > tr > td { padding: 0; border: 0; text-align: left; vertical-align: top; }
.nr-gap { height: 16px; }
.nr-letterhead { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #000; padding-bottom: 8px; text-align: center; }
.nr-letterhead img { height: 0.95in; width: auto; max-width: 1.1in; object-fit: contain; flex-shrink: 0; }
.nr-letterhead-text { flex: 1; }
.nr-letterhead-name { font-size: 14pt; font-weight: 700; text-transform: uppercase; line-height: 1.15; }
.nr-letterhead-line { font-size: 10pt; }
.nr-title { font-size: 14pt; font-weight: 700; text-align: center; text-transform: uppercase; margin: 0 0 16px; }
.nr-c { text-align: center; }
.nr-b { font-weight: 700; }
.nr-14 { font-size: 14pt; }
.nr-p { margin: 0 0 10px; text-align: justify; white-space: pre-line; }
.nr-cover { height: 9.4in; display: flex; flex-direction: column; justify-content: space-between; text-align: center; }
.nr-note { margin-top: 16px; text-align: center; font-size: 10pt; color: #94a3b8; font-family: Arial, sans-serif; }
.nr-attached { border: 1px solid #000; padding: 28px 16px; text-align: center; margin-top: 24px; word-break: break-all; }
.nr-table { width: 100%; border-collapse: collapse; font-size: 11pt; }
.nr-table th, .nr-table td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
.nr-table th { text-align: center; font-weight: 700; }
.nr-table thead { display: table-header-group; }
.nr-table tr { break-inside: avoid; page-break-inside: avoid; }
.nr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.nr-fig { break-inside: avoid; page-break-inside: avoid; text-align: center; font-size: 10pt; }
.nr-fig img { width: 100%; height: 1.9in; object-fit: cover; border: 1px solid #000; }
.nr-toc-row { display: flex; align-items: baseline; font-weight: 700; margin-bottom: 6px; }
.nr-toc-fill { flex: 1; border-bottom: 2px dotted #000; margin: 0 6px; transform: translateY(-3px); }
.nr-sign { margin-top: 36px; }
.nr-sign-line { border-top: 1px solid #000; margin-top: 36px; padding-top: 2px; }
.nr-two { display: flex; gap: 48px; margin-top: 12px; }
.nr-two > div { flex: 1; text-align: center; font-weight: 700; }
@media print {
  @page { size: 8.5in 13in; margin: 0.5in 1.25in 1in 1.25in; }
  html, body { background: #fff !important; }
  .nr-scroll { overflow: visible; padding: 0; background: #fff; }
  .nr-sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; break-before: page; page-break-before: always; }
  .nr-sheet:first-child { break-before: auto; page-break-before: auto; }
  .nr-screen-only { display: none !important; }
}
`;

function Letterhead({ template }) {
  const { letterhead, logo_url } = template;
  return (
    <div className="nr-letterhead">
      {logo_url && <img src={logo_url} alt="" />}
      <div className="nr-letterhead-text">
        <div className="nr-letterhead-name">{letterhead.school_name}</div>
        {letterhead.address && <div className="nr-letterhead-line">{letterhead.address}</div>}
        {letterhead.contact && <div className="nr-letterhead-line">{letterhead.contact}</div>}
        {letterhead.website && <div className="nr-letterhead-line">{letterhead.website}</div>}
      </div>
    </div>
  );
}

function Sheet({ template, children, className = "" }) {
  return (
    <section className={`nr-sheet ${className}`}>
      <table className="nr-wrap">
        <thead>
          <tr><td><Letterhead template={template} /></td></tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="nr-gap" />
              {children}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function bachelorOf(course) {
  const c = (course || "").trim();
  if (!c) return "BACHELOR OF ______________________";
  if (/^(bachelor|b\.?\s?s\.?\s|b\.?\s?s\.?$|a\.?\s?b\.?\s)/i.test(c)) return c.toUpperCase();
  return `BACHELOR OF ${c.toUpperCase()}`;
}

function CoverPage({ data, template }) {
  const { cover } = template;
  return (
    <Sheet template={template}>
      <div className="nr-cover">
        <div>
          {cover.department && <p className="nr-b nr-14" style={{ margin: 0 }}>{cover.department}</p>}
          <p style={{ margin: "4px 0 0" }}>{cover.program_text}</p>
        </div>
        <div>
          <p style={{ margin: 0 }}>Submitted to:</p>
          <p className="nr-b nr-14" style={{ margin: "2px 0 0" }}>{cover.submitted_to_name || "______________________"}</p>
          {cover.submitted_to_title && <p style={{ margin: 0 }}>{cover.submitted_to_title}</p>}
        </div>
        <div>
          <p style={{ margin: 0 }}>Submitted By:</p>
          <p className="nr-b" style={{ margin: "2px 0 0" }}>{data.student.name || "______________________"}</p>
        </div>
        <p className="nr-b" style={{ margin: 0 }}>{cover.school_year ? `S.Y. ${cover.school_year}` : ""}</p>
      </div>
    </Sheet>
  );
}

function TitlePage({ data, template }) {
  const place = [data.department, data.company.name].filter(Boolean).join(" AT ");
  return (
    <Sheet template={template}>
      <div className="nr-cover">
        <div>
          <p className="nr-b" style={{ margin: 0 }}>A NARRATIVE REPORT ON ON-THE-JOB TRAINING UNDERTAKEN AT {(place || "____________").toUpperCase()}</p>
          <p className="nr-b" style={{ margin: "8px 0 0" }}>{(data.company.name || "").toUpperCase()}</p>
          {data.company.address && <p className="nr-b" style={{ margin: 0 }}>{data.company.address.toUpperCase()}</p>}
          {(data.deployment?.previous ?? []).map((p, k) => (
            <p key={k} style={{ margin: "6px 0 0", fontStyle: "italic", fontSize: "0.9em" }}>{p.label}</p>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <img src="/ched-logo.png" alt="Commission on Higher Education" style={{ height: "1.6in", width: "auto" }} />
        </div>
        <div>
          <p className="nr-b" style={{ margin: 0 }}>{bachelorOf(data.student.course)}</p>
          <p className="nr-b" style={{ margin: "4px 0 0" }}>COMMISSION ON HIGHER EDUCATION</p>
          <p style={{ margin: 0 }}>{CHED_ADDRESS}</p>
        </div>
        <div>
          <p style={{ margin: 0 }}>{data.student.name}</p>
          <p className="nr-b" style={{ margin: 0 }}>{template.cover.school_year ? `S.Y. ${template.cover.school_year}` : ""}</p>
        </div>
      </div>
    </Sheet>
  );
}

function TocPage({ template }) {
  return (
    <Sheet template={template}>
      <h2 className="nr-title">TABLE OF CONTENTS</h2>
      <div style={{ marginTop: 20 }}>
        {template.sections.map((s, i) => (
          <div key={s.key} className="nr-toc-row">
            <span>{s.title}</span>
            <span className="nr-toc-fill" />
            <span>{i + 1}</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function Note({ children }) {
  return <p className="nr-note nr-screen-only">{children}</p>;
}

function Paragraphs({ text }) {
  return (text || "").split(/\n+/).filter(Boolean).map((line, i) => (
    <p key={i} className="nr-p">{line}</p>
  ));
}

function DocumentBody({ section, doc }) {
  const type = section.document_type || section.title;
  if (!doc) return <Note>No {type} uploaded yet</Note>;
  if (doc.is_image) {
    return <img src={doc.file_url} alt={section.title} style={{ width: "100%", height: "auto" }} />;
  }
  // PDF/DOC files can't be embedded in the printout without extra tooling.
  return (
    <div className="nr-attached">
      <p style={{ margin: 0 }}>Attached separately: <strong>{doc.file_name}</strong></p>
    </div>
  );
}

// Daily Time Record: one line per day. Companies that record morning and afternoon
// separately get the four-column layout; a single time in/out gets the short one.
function LedgerBody({ ledger }) {
  if (ledger.rows.length === 0) return <Note>No approved attendance yet</Note>;
  const split = !!ledger.split;
  return (
    <>
      <table className="nr-table">
        <thead>
          {split ? (
            <tr><th>DATE</th><th>AM IN</th><th>AM OUT</th><th>PM IN</th><th>PM OUT</th><th>HOURS</th><th>TOTAL HOURS</th>{ledger.multi_company && <th>COMPANY</th>}</tr>
          ) : (
            <tr><th>DATE</th><th>TIME IN</th><th>TIME OUT</th><th>HOURS</th><th>TOTAL HOURS</th>{ledger.multi_company && <th>COMPANY</th>}</tr>
          )}
        </thead>
        <tbody>
          {ledger.rows.map((r, i) => (
            <tr key={i} style={{ textAlign: "center" }}>
              <td>{r.date}</td>
              {split ? (
                <><td>{r.am_in}</td><td>{r.am_out}</td><td>{r.pm_in}</td><td>{r.pm_out}</td></>
              ) : (
                <><td>{r.time_in}</td><td>{r.time_out}</td></>
              )}
              <td>{r.hours}</td><td>{r.running_total}</td>{ledger.multi_company && <td style={{ textAlign: "left" }}>{r.company}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nr-b" style={{ marginTop: 12 }}>
        Total hours rendered: {ledger.total_hours}{ledger.required_hours ? ` of ${ledger.required_hours} required hours` : ""}
      </p>
    </>
  );
}

function DutiesBody({ duties, company }) {
  return (
    <>
      <p className="nr-p">{duties.intro}</p>
      <p style={{ margin: "14px 0 6px" }}>As trainee at {company.name || "the company"}, I was assigned to:</p>
      {duties.tasks.length === 0 ? (
        <Note>No tasks assigned yet</Note>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 24, listStyle: "disc" }}>
          {duties.tasks.map((t) => (
            <li key={t.id} style={{ marginBottom: 6 }}>
              <strong>{t.title}</strong>
              {t.description ? ` — ${t.description}` : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Work photos (task proofs). Attendance selfies are not part of the report.
function PhotosBody({ data }) {
  const photos = data.task_photos.map((p) => ({ url: p.url, caption: p.caption }));
  if (photos.length === 0) return <Note>No photos yet</Note>;
  return (
    <div className="nr-grid">
      {photos.map((p, i) => (
        <div key={i} className="nr-fig">
          <img src={p.url} alt="" />
          <div>{p.caption}</div>
        </div>
      ))}
    </div>
  );
}

function WorkSamplesBody({ items }) {
  if (items.length === 0) return <Note>No work samples added yet</Note>;
  return (
    <div>
      {items.map((item) => (
        <div key={item.id} className="nr-fig" style={{ textAlign: "left", marginBottom: 18, fontSize: "12pt" }}>
          <p className="nr-b" style={{ margin: "0 0 4px" }}>{item.title}</p>
          {item.image_url && (
            <img src={item.image_url} alt="" style={{ width: "100%", height: "auto", maxHeight: "4in", objectFit: "contain", border: "1px solid #000" }} />
          )}
          {item.description && <p style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{item.description}</p>}
          {item.project_url && <p style={{ margin: "2px 0 0", fontSize: "10pt", wordBreak: "break-all" }}>{item.project_url}</p>}
        </div>
      ))}
    </div>
  );
}

function JournalBody({ data }) {
  const { student, company, department, journal } = data;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span>Name: <u>{student.name}</u></span>
        <span>Name of Company: <u>{company.name}</u></span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 4 }}>
        <span>Degree Program: <u>{student.course}</u></span>
        <span>Department: <u>{department || ""}</u></span>
      </div>
      <p className="nr-b" style={{ margin: "14px 0" }}>
        Instruction: Describe briefly task performed during the day. State the nature of the work performed, lessons learned, challenges hurdles and other insights.
      </p>
      <table className="nr-table">
        <thead>
          <tr><th>DATE</th><th>DAY</th><th>AM</th><th>PM</th><th>DAILY SCHEDULE</th></tr>
        </thead>
        <tbody>
          {journal.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: "center", height: "1in" }}>&nbsp;</td></tr>
          )}
          {journal.map((r, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
              <td>{r.day}</td>
              <td style={{ whiteSpace: "nowrap" }}>{r.am}</td>
              <td style={{ whiteSpace: "nowrap" }}>{r.pm}</td>
              <td style={{ whiteSpace: "pre-line" }}>{r.company && <span style={{ display: "block", fontSize: "0.8em", fontStyle: "italic" }}>At {r.company}</span>}{r.schedule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function EvaluationBody({ evaluation }) {
  if (!evaluation) return <Note>No evaluation recorded yet</Note>;
  const groups = [];
  evaluation.scores.forEach((s) => {
    const cat = s.category || "";
    let g = groups.find((x) => x.cat === cat);
    if (!g) {
      g = { cat, rows: [] };
      groups.push(g);
    }
    g.rows.push(s);
  });
  return (
    <>
      {groups.length > 0 && (
        <table className="nr-table">
          <thead>
            <tr><th>CRITERIA</th><th style={{ width: "1in" }}>SCORE</th><th style={{ width: "1in" }}>MAX</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.cat}>
                {g.cat && (
                  <tr><td colSpan={3} className="nr-b">{g.cat}</td></tr>
                )}
                {g.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.criterion_name}</td>
                    <td style={{ textAlign: "center" }}>{r.score}</td>
                    <td style={{ textAlign: "center" }}>{r.max_score}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <p className="nr-b" style={{ marginTop: 14 }}>Total / Rating: {evaluation.overall_score != null ? `${evaluation.overall_score}%` : "—"}</p>
      {evaluation.remarks && <p className="nr-p">Remarks: {evaluation.remarks}</p>}
      <p style={{ margin: "10px 0 0" }}>
        Evaluated by: {evaluation.evaluator_name || "—"}{evaluation.evaluation_date ? ` · ${evaluation.evaluation_date}` : ""}
      </p>
    </>
  );
}

function FixedTextBody({ section, data, template }) {
  const coordinator = data.coordinator.name || "______________________";
  return (
    <>
      <Paragraphs text={section.body} />
      {section.signatures && (
        <div className="nr-sign nr-c" style={{ breakInside: "avoid" }}>
          <p style={{ margin: 0 }}>{template.letterhead.school_name}</p>
          <div style={{ width: "3in", margin: "0 auto" }}>
            <div className="nr-sign-line" />
          </div>
          <p className="nr-b" style={{ margin: 0 }}>{coordinator.toUpperCase()}</p>
          <p className="nr-b" style={{ margin: 0 }}>{data.coordinator.title || "OJT Coordinator"}</p>
          <p className="nr-b" style={{ margin: 0 }}>Date: ____________</p>
          <div className="nr-two">
            <div><div className="nr-sign-line" />Student<br />Date: __________</div>
            <div><div className="nr-sign-line" />Parent/Guardian<br />Date: __________</div>
          </div>
        </div>
      )}
      {section.remarks && (
        <div style={{ marginTop: 28, breakInside: "avoid" }}>
          <p style={{ margin: 0 }}>REMARKS</p>
          <p className="nr-p" style={{ textIndent: "0.5in" }}>{section.remarks}</p>
        </div>
      )}
    </>
  );
}

function SectionBody({ section, data, template }) {
  switch (section.source) {
    case "intern_text": {
      const text = data.texts?.[section.key];
      return text ? <Paragraphs text={text} /> : <Note>The intern hasn&apos;t written this section yet</Note>;
    }
    case "document":
      return <DocumentBody section={section} doc={data.documents?.[section.key]} />;
    case "auto_ledger":
      return <LedgerBody ledger={data.ledger} />;
    case "auto_attendance":
      return null; // attendance selfies were removed from the report; the DTR table covers attendance
    case "auto_duties":
      return <DutiesBody duties={data.duties} company={data.company} />;
    case "auto_photos":
      return <PhotosBody data={data} />;
    case "auto_work_samples":
      return <WorkSamplesBody items={data.work_samples} />;
    case "auto_journal":
      return <JournalBody data={data} />;
    case "auto_evaluation":
      return <EvaluationBody evaluation={data.evaluation} />;
    case "fixed_text":
      return <FixedTextBody section={section} data={data} template={template} />;
    default:
      return null;
  }
}

export default function NarrativeReport({ data }) {
  const template = data.template;
  return (
    <div className="nr-root">
      <style>{css}</style>
      <div className="nr-scroll">
        <CoverPage data={data} template={template} />
        <TitlePage data={data} template={template} />
        <TocPage template={template} />
        {template.sections.map((section) => (
          <Sheet key={section.key} template={template}>
            <h2 className="nr-title">{section.title}</h2>
            <SectionBody section={section} data={data} template={template} />
          </Sheet>
        ))}
      </div>
    </div>
  );
}

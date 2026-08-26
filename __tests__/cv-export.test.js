/**
 * The printed CV must carry the same structure as the Word file.
 *
 * The model returns plain text with no markup, so both exporters infer shape
 * from the same conventions. If they drift apart, the PDF and the .docx stop
 * looking like the same document.
 */
jest.mock("expo-print", () => ({ printToFileAsync: jest.fn() }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "/cache" } }));
jest.mock("@/services/cvApi", () => ({ exportCVAsDocx: jest.fn() }));

const { __testing } = require("../services/cvExport");
const { toPrintHtml } = __testing;

const CV = `RASHID MOSTAFA
Dhaka, Bangladesh | rashid@example.com

PROFESSIONAL SUMMARY
Backend Engineer with 2 years of experience.

EXPERIENCE
Software Engineer, Acme Ltd (2024 - 2026)
- Built a REST API serving 10,000 requests per day
- Raised Jest coverage from 12% to 68%

SKILLS
JavaScript, Node.js, MongoDB`;

describe("print HTML", () => {
  const html = toPrintHtml(CV);

  it("treats the first line as the name", () => {
    expect(html).toMatch(/<h1>RASHID MOSTAFA<\/h1>/);
  });

  it("turns all-caps lines into section headings", () => {
    expect(html).toMatch(/<h2>PROFESSIONAL SUMMARY<\/h2>/);
    expect(html).toMatch(/<h2>EXPERIENCE<\/h2>/);
    expect(html).toMatch(/<h2>SKILLS<\/h2>/);
  });

  it("turns dashes into real list items, grouped in one list", () => {
    expect(html).toMatch(/<ul>\s*<li>Built a REST API serving 10,000 requests per day<\/li>/);
    expect((html.match(/<ul>/g) || []).length).toBe(1);
    expect((html.match(/<li>/g) || []).length).toBe(2);
  });

  it("keeps ordinary lines as paragraphs", () => {
    expect(html).toMatch(/<p>Software Engineer, Acme Ltd \(2024 - 2026\)<\/p>/);
  });

  it("does not mistake a long sentence in capitals for a heading", () => {
    const long = "X\nTHIS IS A VERY LONG LINE IN CAPITALS THAT IS CLEARLY NOT A SECTION HEADING AT ALL";
    expect(toPrintHtml(long)).not.toMatch(/<h2>THIS IS A VERY LONG/);
  });

  it("escapes text so a CV cannot inject markup", () => {
    const out = toPrintHtml("Name\n\nBODY\nWorked with <script>alert(1)</script> & co");
    expect(out).not.toMatch(/<script>/);
    expect(out).toMatch(/&lt;script&gt;/);
    expect(out).toMatch(/&amp; co/);
  });
});

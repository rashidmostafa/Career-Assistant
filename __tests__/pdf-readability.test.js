const { readabilityScore } = require("../utils/pdfExtract");

const REAL_CV = "RASHID MOSTAFA\nDhaka, Bangladesh | rashid@example.com | +880 1700 000000\nSUMMARY\nFull-stack developer with 3 years of experience building React Native and Node.js\napplications. Delivered a career assistant app used by 500 students.\nEXPERIENCE\nSoftware Engineer, Acme Ltd (2023 - 2026)\n- Built a REST API in Node.js and MongoDB serving 10k requests per day\n- Reduced app cold start time by 40 percent";
const MOJIBAKE = "\u00c0\u00c1\u00c2\u00c3\u00c4 \u00c5\u00c6\u00c7\u00c8\u00c9 \u00ca\u00cb\u00cc\u00cd\u00ce \u00cf\u00d0\u00d1\u00d2\u00d3 \u00d4\u00d5\u00d6\u00d7\u00d8 \u00d9\u00da\u00db\u00dc\u00dd \u00de\u00df\u00e0\u00e1\u00e2 \u00e3\u00e4\u00e5\u00e6\u00e7 \u00e8\u00e9\u00ea\u00eb\u00ec \u00ed\u00ee\u00ef\u00f0\u00f1 \u00f2\u00f3\u00f4\u00f5\u00f6 \u00f7\u00f8\u00f9\u00fa\u00fb";
const SYMBOLS = "!!!!!! ###### $$$$$$ %%%%%% ^^^^^^ &&&&&& ****** (((((( )))))) ______ ++++++ ======";

test("accepts a real CV", () => {
  const r = readabilityScore(REAL_CV);
  console.log("  real CV      ", JSON.stringify(r));
  expect(r.ok).toBe(true);
});

test("rejects mojibake from a broken font decode", () => {
  const r = readabilityScore(MOJIBAKE);
  console.log("  mojibake     ", JSON.stringify(r));
  expect(r.ok).toBe(false);
});

test("rejects valid characters that form no words", () => {
  const r = readabilityScore(SYMBOLS);
  console.log("  symbols only ", JSON.stringify(r));
  expect(r.ok).toBe(false);
});

test("rejects text too short to judge", () => {
  expect(readabilityScore("Hi").ok).toBe(false);
});

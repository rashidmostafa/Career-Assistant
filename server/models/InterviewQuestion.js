/**
 * InterviewQuestion — the shared question bank.
 *
 * This is the first collection with a real schema rather than a UserData blob,
 * for the reason that file anticipates: the server has to query *inside* the
 * payload. A session asks for "Mid-level questions about System Design for a
 * Backend Engineer, excluding the twelve this user has already seen", and none
 * of that is answerable against an opaque document.
 *
 * Questions are not owned by a user. One bank serves everyone, so a question
 * generated for the first person to ask for "Electrical Engineering Intern" is
 * already there for the next — which is what keeps a free-text target role from
 * costing an AI call per session forever.
 */
const mongoose = require("mongoose");

/**
 * Roles are free text the user typed, so "Backend Engineer", "backend engineer"
 * and "Backend  Engineer" have to reach the same bank. Every lookup and every
 * write goes through this, and the result is what the index is built on.
 */
function roleKeyOf(role) {
  return String(role ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const InterviewQuestionSchema = new mongoose.Schema({
  // Normalised for lookup; `role` keeps whatever the first asker actually typed.
  roleKey:    { type: String, required: true, index: true, maxlength: 120 },
  role:       { type: String, required: true, trim: true, maxlength: 120 },

  // What the question tests — "Data Structures", "System Design", "Stakeholder
  // Management". Drives the mastery radar, so it is a required tag, not a note.
  competency: { type: String, required: true, trim: true, maxlength: 80 },

  difficulty: { type: String, required: true, enum: ["Junior", "Mid", "Senior"] },
  type:       { type: String, required: true, enum: ["Technical", "Behavioral", "System Design"] },

  question:    { type: String, required: true, trim: true, maxlength: 1000 },
  idealAnswer: { type: String, required: true, trim: true, maxlength: 4000 },

  /**
   * The terms an answer is expected to contain.
   *
   * These do double duty: they are the score (what fraction did the user
   * cover?) and the Keyword Detective's green/red colouring. Stored explicitly
   * rather than derived at read time so both always agree, and so a curated
   * question can name the exact terms that matter.
   */
  keywords:   { type: [String], default: [], validate: (v) => v.length <= 24 },

  // "seed" was written by hand, "ai" was generated to fill a gap in the bank.
  // Kept so a curated question can be preferred, and so generated ones can be
  // reviewed or purged without touching the curated set.
  source:     { type: String, required: true, enum: ["seed", "ai"], default: "seed" },
}, { timestamps: true });

// The query every session runs: this role, at or below this difficulty.
InterviewQuestionSchema.index({ roleKey: 1, difficulty: 1 });

// The same question must not be seeded twice, nor regenerated on a later run.
// Text is part of the key because one role legitimately has many questions per
// competency, and only the wording distinguishes them.
InterviewQuestionSchema.index({ roleKey: 1, question: 1 }, { unique: true });

InterviewQuestionSchema.statics.roleKeyOf = roleKeyOf;

module.exports = mongoose.model("InterviewQuestion", InterviewQuestionSchema);
module.exports.roleKeyOf = roleKeyOf;

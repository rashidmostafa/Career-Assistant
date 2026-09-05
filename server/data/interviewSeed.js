/**
 * The curated half of the question bank.
 *
 * These cover the roles already present in this deployment's data plus the
 * common software ones. Anything else is filled by AI on first request and
 * written into the same collection, so this file is a quality floor rather than
 * the whole bank — it is what a user gets when the AI is unreachable, rate
 * limited, or simply slower than they are willing to wait.
 *
 * `keywords` are the terms an answer is expected to contain. They are the score
 * and the Keyword Detective colouring, so they are chosen to be things a
 * correct answer would actually say, not jargon that merely sounds right.
 */

const q = (competency, difficulty, type, question, idealAnswer, keywords) =>
  ({ competency, difficulty, type, question, idealAnswer, keywords });

const ROLES = {
  "Backend Engineer": [
    q("APIs", "Junior", "Technical",
      "What is the difference between PUT and PATCH in a REST API?",
      "PUT replaces the entire resource with the body you send, so omitting a field clears it. PATCH applies a partial update, changing only the fields present. PUT is idempotent — sending it twice leaves the same state — and PATCH can be, but only if written that way.",
      ["put", "patch", "replace", "partial", "idempotent", "resource"]),
    q("Databases", "Junior", "Technical",
      "When would you add an index to a database table, and what does it cost?",
      "Add an index when a column is frequently filtered, joined, or sorted on and the table is large enough that a full scan hurts. The cost is slower writes, since every insert and update must maintain the index, plus disk space. Indexes that are never used are pure overhead.",
      ["index", "query", "scan", "write", "slower", "disk", "cardinality"]),
    q("Concurrency", "Mid", "Technical",
      "Two requests try to book the last seat at the same time. How do you stop both succeeding?",
      "This is a race condition and it has to be resolved where the data lives, not in application code. Use a transaction with row-level locking (SELECT FOR UPDATE), an atomic conditional update that only succeeds if seats remain, or optimistic concurrency with a version column that makes the second write fail. Checking availability then writing in two separate steps will always be racy.",
      ["race condition", "transaction", "lock", "atomic", "optimistic", "version", "constraint"]),
    q("System Design", "Mid", "System Design",
      "Design a URL shortener. What are the main decisions?",
      "You need an ID generation strategy (counter with base62 encoding, or a hash with collision handling), a key-value store for the mapping since reads dominate writes heavily, and a cache in front for hot links. Redirects should be 301 or 302 depending on whether you want analytics. Consider the read/write ratio, expiry policy, and custom aliases.",
      ["base62", "hash", "collision", "key-value", "cache", "redirect", "read heavy"]),
    q("Reliability", "Mid", "Technical",
      "A downstream service you call is intermittently slow. How do you keep your own service healthy?",
      "Set aggressive timeouts so a slow dependency cannot exhaust your thread or connection pool. Add retries with exponential backoff and jitter, but only for idempotent calls. Use a circuit breaker so repeated failures stop the calls entirely and fail fast, and degrade gracefully with a fallback or cached response rather than propagating the failure.",
      ["timeout", "retry", "backoff", "jitter", "circuit breaker", "fail fast", "degrade"]),
    q("Scalability", "Senior", "System Design",
      "Your primary database is at capacity for writes. What are your options, in order?",
      "First exhaust the cheap options: check for missing indexes, N+1 queries, and writes that could be batched. Then vertical scaling, which buys time with no architectural change. Then move reads to replicas to free the primary. Only then shard, choosing a key with even distribution and few cross-shard queries — sharding is the last resort because it makes transactions and joins much harder.",
      ["index", "batch", "vertical", "read replica", "shard", "partition key", "hot spot"]),
    q("Security", "Senior", "Technical",
      "How do you store user passwords, and why not just hash them?",
      "Use a slow, salted hash designed for passwords — bcrypt, scrypt or Argon2 — with a per-user salt and a work factor tuned so hashing takes a meaningful fraction of a second. A plain fast hash like SHA-256 is wrong because GPUs compute billions per second, making brute force cheap. The salt stops precomputed rainbow tables, and the work factor is raised as hardware improves.",
      ["bcrypt", "argon2", "salt", "work factor", "rainbow table", "brute force", "slow"]),
    q("Communication", "Mid", "Behavioral",
      "Tell me about a production incident you were responsible for. What happened?",
      "A strong answer owns the mistake without drama, states the user-visible impact and its duration, explains how it was detected and mitigated, then focuses on what changed afterwards — a test, an alert, a guard rail — so the same class of failure cannot recur. Blaming other people or the tooling is what makes this answer fail.",
      ["impact", "detection", "mitigation", "root cause", "prevention", "ownership", "postmortem"]),
  ],

  "Frontend Developer": [
    q("JavaScript", "Junior", "Technical",
      "What is the difference between == and === in JavaScript?",
      "=== compares value and type with no conversion. == performs type coercion first, which produces surprising results like '' == 0 and null == undefined both being true. Use === by default; == is only defensible for an explicit null-or-undefined check.",
      ["strict", "coercion", "type", "equality", "null", "undefined"]),
    q("React", "Junior", "Technical",
      "Why does React need a key prop on list items?",
      "Keys let React match elements between renders so it can tell what moved, what was added and what was removed, instead of re-creating the whole list. Without stable keys, component state attaches to the wrong row. Using the array index as a key breaks as soon as the list is reordered, filtered, or has items inserted.",
      ["reconciliation", "identity", "stable", "index", "reorder", "state"]),
    q("Performance", "Mid", "Technical",
      "A page feels sluggish while typing in a search box. How do you diagnose and fix it?",
      "Profile first — the React DevTools profiler or a performance recording will show whether the cost is re-rendering, a synchronous layout, or work on every keystroke. Common fixes are debouncing the input, memoising expensive children, virtualising long result lists, and moving filtering off the render path. Guessing before measuring usually optimises the wrong thing.",
      ["profile", "debounce", "memo", "virtualise", "re-render", "measure"]),
    q("State", "Mid", "Technical",
      "When should state live in a component, and when should it be lifted or moved to context?",
      "Keep state as local as possible — in the component that owns it. Lift it only when two siblings genuinely need the same value. Reach for context when a value is needed by many components at different depths and changes rarely, like theme or the signed-in user. Putting frequently-changing state in context re-renders every consumer.",
      ["local", "lift", "context", "prop drilling", "re-render", "colocate"]),
    q("Accessibility", "Mid", "Technical",
      "What makes a custom dropdown accessible?",
      "It needs keyboard operation — arrow keys to move, Enter to select, Escape to close — visible focus, and correct roles and ARIA attributes so a screen reader announces it as a listbox with a selected option. Focus must be managed on open and returned to the trigger on close. A div with a click handler is the failure case.",
      ["keyboard", "focus", "aria", "role", "screen reader", "escape", "semantics"]),
    q("Architecture", "Senior", "System Design",
      "How would you structure a large frontend so several teams can work in it without colliding?",
      "Organise by feature rather than by file type, so a change lives in one folder. Define clear public interfaces between features and forbid deep imports across them. Share a design system for UI primitives. Keep routing and data-fetching conventions consistent so code is readable across teams, and use codeowners plus automated checks rather than relying on review discipline.",
      ["feature", "boundary", "design system", "shared", "convention", "ownership", "modular"]),
    q("Rendering", "Senior", "Technical",
      "Explain the trade-offs between client-side and server-side rendering.",
      "Server rendering gives faster first paint and content that crawlers see reliably, at the cost of server load and a hydration step that can feel janky. Client rendering shifts work to the browser, making navigation fast after load but the first view slow, and requires care for SEO. The right answer depends on whether the page is content or an application, and on the audience's devices and network.",
      ["first paint", "hydration", "seo", "server load", "time to interactive", "trade-off"]),
    q("Communication", "Mid", "Behavioral",
      "Describe a time you disagreed with a designer. How did it end?",
      "A good answer shows the disagreement was about the user's outcome rather than taste, that the candidate brought evidence — a constraint, a measurement, an accessibility requirement — and that they proposed an alternative rather than simply refusing. It ends with a decision and a working relationship intact, and ideally admits when the designer turned out to be right.",
      ["evidence", "user", "constraint", "alternative", "compromise", "outcome"]),
  ],

  "Software Engineer": [
    q("Fundamentals", "Junior", "Technical",
      "What is the difference between an array and a linked list?",
      "An array stores elements contiguously, so indexing is constant time but inserting in the middle requires shifting. A linked list stores nodes with pointers, so inserting or removing at a known position is constant time but reaching position n takes linear time and there is memory overhead per node. Arrays also have far better cache locality, which usually matters more in practice than the big-O suggests.",
      ["contiguous", "index", "pointer", "insert", "o(1)", "o(n)", "cache"]),
    q("Testing", "Junior", "Technical",
      "What makes a good unit test?",
      "It tests one behaviour, has a name that states that behaviour, and fails for exactly one reason. It should not depend on other tests, on wall-clock time, or on the network. A good test is readable enough that a failure tells you what broke without opening the implementation, and it tests the contract rather than the internals so refactoring does not break it.",
      ["one behaviour", "isolated", "deterministic", "readable", "contract", "fails"]),
    q("Debugging", "Mid", "Technical",
      "You have a bug that only reproduces in production. How do you approach it?",
      "Start by making it observable — logs, metrics, traces around the suspect path — rather than guessing. Narrow down what differs from your environment: data, scale, concurrency, configuration, timing. Try to reproduce it locally with production-like data. Form one hypothesis at a time and test it. Adding a fix you cannot verify is how these bugs come back.",
      ["observability", "logs", "reproduce", "hypothesis", "narrow", "differs", "verify"]),
    q("Code Quality", "Mid", "Technical",
      "How do you decide when to refactor versus leave code alone?",
      "Refactor when you are already changing that code and its shape is making the change harder, or when the same fault keeps recurring there. Leave it alone when it is stable, understood, and nobody touches it — ugly code that works and is never modified costs nothing. Refactoring needs test coverage first, otherwise it is rewriting with extra steps.",
      ["boy scout", "already changing", "tests", "risk", "stable", "cost"]),
    q("System Design", "Senior", "System Design",
      "Design a rate limiter for an API. What algorithm and where does it live?",
      "A token bucket allows bursts up to a limit while capping the average rate, which usually suits APIs better than a fixed window that lets a client send double the limit across a boundary. A sliding window log is accurate but stores more. State has to be shared across instances, so it lives in something like Redis with atomic increments. Decide what happens on limit — 429 with Retry-After — and whether limits are per key, per IP, or per endpoint.",
      ["token bucket", "sliding window", "fixed window", "redis", "atomic", "429", "retry-after"]),
    q("Trade-offs", "Senior", "Behavioral",
      "Tell me about a technical decision you made that turned out to be wrong.",
      "The answer should name the decision, the reasoning at the time — which should be defensible given what was known — the signal that showed it was wrong, and what it cost to change. What separates a strong answer is what the candidate now checks earlier because of it. Claiming never to have been wrong is the weakest possible response.",
      ["decision", "reasoning", "signal", "cost", "reversed", "learned"]),
    q("Communication", "Mid", "Behavioral",
      "How do you explain a technical trade-off to someone non-technical?",
      "Lead with the decision and its consequence for them — cost, time, risk, or what the user will notice — not the mechanism. Offer two or three options with plain-language trade-offs rather than a single recommendation dressed as inevitability. Check understanding by asking what they would choose, and avoid analogies that quietly mislead.",
      ["consequence", "options", "plain", "cost", "risk", "check understanding"]),
  ],

  "Data Scientist": [
    q("Statistics", "Junior", "Technical",
      "What is the difference between correlation and causation, and how do you establish causation?",
      "Correlation means two variables move together; causation means changing one changes the other. Correlation can arise from a confounder, reverse causality, or selection bias. Establishing causation needs a randomised experiment, or a quasi-experimental design — difference-in-differences, instrumental variables, regression discontinuity — that makes the untestable assumption explicit.",
      ["confounder", "reverse causality", "randomised", "experiment", "a/b test", "selection bias"]),
    q("Modelling", "Junior", "Technical",
      "What is overfitting and how do you detect it?",
      "Overfitting is when a model learns noise specific to the training data, so it performs well there and badly on unseen data. You detect it by holding out data — a validation set or cross-validation — and watching the gap between training and validation error grow. Remedies include more data, fewer parameters, regularisation, and early stopping.",
      ["training", "validation", "generalise", "cross-validation", "regularisation", "gap", "noise"]),
    q("Evaluation", "Mid", "Technical",
      "Your fraud model is 99% accurate. Why might that be worthless?",
      "If fraud is 1% of cases, predicting 'not fraud' every time scores 99% and catches nothing. Accuracy is the wrong metric on imbalanced data. Use precision and recall, the PR curve, or a metric weighted by the real cost of a false negative versus a false positive — missing fraud and blocking a legitimate customer are not equally expensive.",
      ["imbalanced", "baseline", "precision", "recall", "false negative", "cost", "accuracy"]),
    q("Experimentation", "Mid", "Technical",
      "How do you design an A/B test for a new recommendation algorithm?",
      "Define one primary metric tied to the decision before starting, plus guardrail metrics. Compute the sample size needed for the effect size worth detecting, and fix the duration in advance to avoid peeking. Randomise at the right unit — usually user, not session — and check the groups are balanced. Decide up front what result would make you ship, and account for novelty effects.",
      ["primary metric", "sample size", "power", "randomise", "guardrail", "peeking", "duration"]),
    q("Communication", "Senior", "Behavioral",
      "How do you present a result that contradicts what a stakeholder expected?",
      "Show the result plainly with its uncertainty rather than softening it, explain what would have to be true for their expectation to hold, and state what you checked to rule out an error in your own analysis. Bring the decision the result implies. Being right is not sufficient — the goal is a stakeholder who trusts the number enough to act on it.",
      ["uncertainty", "assumptions", "validate", "decision", "trust", "evidence"]),
    q("Production", "Senior", "System Design",
      "A model performed well offline but is degrading in production. What do you check?",
      "Check for training-serving skew first — features computed differently in the two paths is the most common cause. Then data drift in the inputs and concept drift in the relationship, a leaked feature that was unavailable at prediction time offline, and feedback loops where the model's own outputs change the data. Monitoring input distributions and prediction distributions catches most of this early.",
      ["training-serving skew", "drift", "leakage", "feedback loop", "monitoring", "distribution"]),
  ],

  "Product Manager": [
    q("Prioritisation", "Junior", "Behavioral",
      "How do you decide what to build next when everything is urgent?",
      "Tie each candidate to the outcome it moves and estimate impact against effort and confidence, so the comparison is explicit rather than political. Separate genuine deadlines from manufactured urgency. Say what you are not doing and why, out loud, so the trade-off is visible. A framework matters less than being consistent and transparent about it.",
      ["impact", "effort", "confidence", "outcome", "trade-off", "explicit", "not doing"]),
    q("Discovery", "Mid", "Behavioral",
      "How do you validate a problem is worth solving before building anything?",
      "Talk to users about what they currently do, not what they say they want — existing workarounds are the strongest evidence a problem is real. Look for how often it occurs and what it costs them. Quantify with the data you already have. Then test the cheapest possible artefact: a prototype, a fake door, a manual version. Building is the most expensive way to learn.",
      ["user interview", "workaround", "frequency", "data", "prototype", "cheapest", "evidence"]),
    q("Metrics", "Mid", "Technical",
      "You ship a feature and engagement goes up but retention falls. What do you do?",
      "Do not ship wider yet. Engagement rising while retention falls suggests the feature is attracting attention without delivering value, or is cannibalising something that did. Segment to find who is churning, check whether the engagement is genuine or accidental, and look at qualitative feedback. Decide which metric actually represents the goal — retention almost always outranks engagement.",
      ["segment", "cohort", "retention", "cannibalise", "qualitative", "goal metric"]),
    q("Stakeholders", "Senior", "Behavioral",
      "An executive wants a feature your data says users don't need. How do you handle it?",
      "Understand what outcome they are actually chasing — the feature is usually a proposed solution to a real concern. Show the evidence without making it a contest, and offer a cheaper test that would settle it. If they still decide to proceed, disagree clearly once, then commit and define what success looks like so the decision can be evaluated later.",
      ["outcome", "evidence", "cheaper test", "disagree and commit", "success criteria"]),
    q("Strategy", "Senior", "System Design",
      "How do you decide whether to build, buy, or partner?",
      "Build what is core to your differentiation and where you need control of the roadmap. Buy commodity capability where a vendor is cheaper than your engineers' time and the switching cost is acceptable. Partner where you need reach or credibility you cannot build quickly. Factor in total cost including integration and maintenance, not just licence price.",
      ["core", "differentiation", "commodity", "switching cost", "total cost", "control"]),
  ],
};

/** Flattened into documents, with the role carried onto every row. */
function seedDocuments() {
  const out = [];
  for (const [role, questions] of Object.entries(ROLES)) {
    for (const item of questions) out.push({ ...item, role, source: "seed" });
  }
  return out;
}

module.exports = { ROLES, seedDocuments };

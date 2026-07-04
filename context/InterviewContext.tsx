import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

export interface InterviewQuestion {
  id: string;
  question: string;
  category: string;
  type: "Technical" | "Behavioral" | "System Design";
  level: "Junior" | "Mid" | "Senior";
  roles: string[];
  source?: string;
  correctAnswer: string;
}

export interface InterviewAnswer {
  questionId: string;
  transcript: string;
  score: number;
  feedback: string;
  correctAnswer: string;
}

export interface InterviewSession {
  id: string;
  userId: string;
  jobRole: string;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  overallScore: number | null;
  feedback: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface InterviewContextType {
  sessions: InterviewSession[];
  currentSession: InterviewSession | null;
  isGenerating: boolean;
  startSession: (jobRole: string) => Promise<void>;
  submitAnswer: (questionId: string, transcript: string) => Promise<InterviewAnswer>;
  finishSession: () => Promise<void>;
}

const QUESTION_BANK: InterviewQuestion[] = [
  // ─── BEHAVIORAL ───────────────────────────────────────────────────────
  { id: "b1", question: "Tell me about a time you handled a disagreement with a colleague. How did you resolve it?", category: "Conflict Resolution", type: "Behavioral", level: "Mid", roles: ["all"], source: "Google, 2025", correctAnswer: "A strong answer uses the STAR method (Situation, Task, Action, Result). Describe a real disagreement, explain you sought first to understand their perspective, used active listening, found common ground, and came to a mutually agreed solution. Emphasize a positive outcome and what you learned." },
  { id: "b2", question: "Describe a project where you had to learn a new technology quickly. What was your approach?", category: "Adaptability", type: "Behavioral", level: "Junior", roles: ["all"], source: "Meta, 2025", correctAnswer: "Ideal answer: identify a specific project, describe your systematic learning approach (documentation, tutorials, side projects), mention how you timeboxed learning, asked for help when stuck, and successfully delivered. Show you can learn fast and independently." },
  { id: "b3", question: "Tell me about your greatest professional achievement and the impact it had.", category: "Achievement", type: "Behavioral", level: "Mid", roles: ["all"], source: "Amazon, 2026", correctAnswer: "Use STAR. Pick an achievement with measurable impact (%, $, time saved). Explain the challenge, your specific actions, and the quantified result. The answer should show initiative, ownership, and business impact beyond just technical completion." },
  { id: "b4", question: "Describe a situation where you had to meet a tight deadline. How did you manage it?", category: "Time Management", type: "Behavioral", level: "Junior", roles: ["all"], source: "Microsoft, 2025", correctAnswer: "Strong answer: break down the situation, explain how you prioritized ruthlessly (MoSCoW or impact/effort matrix), communicated risks early to stakeholders, may have negotiated scope, and ultimately delivered. Show proactive communication and systematic time management." },
  { id: "b5", question: "Tell me about a time you failed. What did you learn from it?", category: "Self-Awareness", type: "Behavioral", level: "Mid", roles: ["all"], source: "Apple, 2026", correctAnswer: "Be honest about a real failure. Do not blame others. Show self-awareness about what went wrong, take ownership, describe concrete lessons learned, and explain how you applied those lessons to avoid the same mistake in the future. Shows growth mindset." },
  { id: "b6", question: "How do you prioritize when you have multiple competing deadlines?", category: "Prioritization", type: "Behavioral", level: "Mid", roles: ["all"], source: "Stripe, 2026", correctAnswer: "Best answer: describe a framework (urgency vs importance matrix, impact vs effort), explain how you communicate with stakeholders to align on priority, how you break large tasks into milestones, and give a concrete example. Show you are systematic, not reactive." },
  { id: "b7", question: "Tell me about a time you mentored a junior team member. What was the outcome?", category: "Leadership", type: "Behavioral", level: "Senior", roles: ["all"], source: "Uber, 2025", correctAnswer: "Describe a specific mentoring relationship: how you assessed their gaps, created a tailored learning plan, gave structured feedback, and tracked progress. The outcome should show the junior grew measurably (promotion, skills, confidence). Shows leadership and empathy." },
  { id: "b8", question: "Describe a situation where you identified a problem before it became critical.", category: "Proactivity", type: "Behavioral", level: "Mid", roles: ["all"], source: "Airbnb, 2026", correctAnswer: "Strong answer: describe early warning signs you noticed (from monitoring, code review, user feedback), the proactive steps you took to investigate and mitigate the risk, and the avoided impact. Shows initiative, attention to detail, and systemic thinking." },

  // ─── FRONTEND ─────────────────────────────────────────────────────────
  { id: "fe1", question: "Explain the difference between null and undefined in JavaScript.", category: "JavaScript", type: "Technical", level: "Junior", roles: ["Frontend", "Full Stack"], source: "Shopify, 2026", correctAnswer: "'undefined' means a variable has been declared but not yet assigned a value. 'null' is an intentional assignment representing 'no value'. typeof undefined === 'undefined', typeof null === 'object' (a historical JS bug). Use null intentionally; undefined typically signals an uninitialized state." },
  { id: "fe2", question: "What is the virtual DOM and how does React use it to optimize rendering?", category: "React", type: "Technical", level: "Junior", roles: ["Frontend", "Full Stack"], source: "Meta, 2025", correctAnswer: "The virtual DOM is a lightweight JavaScript representation of the real DOM. React maintains this in memory and when state/props change, it creates a new virtual DOM tree, diffs it against the previous one (reconciliation), and applies only the minimal necessary real DOM changes. This batching minimizes expensive DOM operations." },
  { id: "fe4", question: "What are React hooks? Explain useCallback vs useMemo.", category: "React", type: "Technical", level: "Mid", roles: ["Frontend", "Full Stack"], source: "Vercel, 2026", correctAnswer: "Hooks let functional components use state and side effects. useCallback memoizes a function reference so it doesn't recreate on every render — useful when passing callbacks to child components that are wrapped in React.memo. useMemo memoizes a computed value — useful for expensive calculations. Both take a dependency array." },
  { id: "fe5", question: "How would you optimize a React application that is re-rendering too often?", category: "Performance", type: "Technical", level: "Mid", roles: ["Frontend", "Full Stack"], source: "Airbnb, 2025", correctAnswer: "Diagnose with React DevTools Profiler. Solutions: React.memo for pure components, useCallback/useMemo to stabilize references, split context providers to limit blast radius, use state colocation (move state closer to where it's used), consider external state management (Zustand/Jotai) for global state, lazy load heavy components." },
  { id: "fe10", question: "Explain the event loop in JavaScript and how it relates to async/await.", category: "JavaScript", type: "Technical", level: "Mid", roles: ["Frontend", "Full Stack"], source: "Cloudflare, 2026", correctAnswer: "The event loop allows JS to be non-blocking despite being single-threaded. The call stack executes synchronous code. When async operations complete, callbacks are queued in the task/microtask queue. Microtasks (Promises, async/await) are processed before tasks. async/await is syntax sugar over Promises, allowing synchronous-looking asynchronous code." },
  { id: "fe15", question: "How do you debug a performance bottleneck in a production React app?", category: "Debugging", type: "Technical", level: "Senior", roles: ["Frontend"], source: "Stripe, 2026", correctAnswer: "Start with Lighthouse for overall metrics. Use Chrome DevTools Performance tab to identify long tasks. React DevTools Profiler for component render times. Check bundle size with webpack-bundle-analyzer. Common fixes: code splitting, lazy loading, memoization, virtualizing long lists, optimizing images, reducing main-thread work." },

  // ─── BACKEND ──────────────────────────────────────────────────────────
  { id: "be1", question: "What is the difference between SQL and NoSQL databases? When would you choose each?", category: "Databases", type: "Technical", level: "Junior", roles: ["Backend", "Full Stack", "Data Engineer"], source: "MongoDB, 2025", correctAnswer: "SQL (relational): structured data, ACID transactions, complex queries with JOINs — use for financial systems, e-commerce, any domain requiring strong consistency. NoSQL: flexible schema, horizontal scaling, document/key-value/graph models — use for unstructured data, high write throughput, real-time analytics, when data shape evolves rapidly." },
  { id: "be2", question: "Explain REST vs GraphQL. What are the tradeoffs?", category: "APIs", type: "Technical", level: "Mid", roles: ["Backend", "Full Stack"], source: "GitHub, 2025", correctAnswer: "REST: resource-based URLs, multiple round trips for related data, easy caching, well-understood. GraphQL: single endpoint, client specifies exact data shape (eliminates over/under-fetching), great for complex UIs and mobile clients. REST tradeoffs: over-fetching, multiple requests. GraphQL tradeoffs: complex caching, N+1 query problem, steeper backend learning curve." },
  { id: "be3", question: "What is database indexing and when would you avoid adding an index?", category: "Databases", type: "Technical", level: "Mid", roles: ["Backend", "Full Stack"], source: "Postgres, 2026", correctAnswer: "Indexes speed up read queries by creating sorted data structures (B-tree by default in Postgres). Avoid indexes when: the table is small (full scan is faster), the column has low cardinality (e.g. boolean), the table has very high write load (indexes slow down inserts/updates), or you have too many unused indexes consuming storage and maintenance overhead." },
  { id: "be4", question: "Explain how you would design a rate limiter.", category: "System Design", type: "Technical", level: "Senior", roles: ["Backend", "Full Stack"], source: "Cloudflare, 2026", correctAnswer: "Common algorithms: token bucket (tokens refill at fixed rate, burst allowed), sliding window log (track each request timestamp, precise but memory-heavy), fixed/sliding window counter. Implementation: use Redis for distributed state (INCR + EXPIRE or sorted sets). Return 429 Too Many Requests with Retry-After header. Consider per-user vs per-IP vs per-endpoint limits." },
  { id: "be5", question: "How does HTTPS work? Explain the TLS handshake.", category: "Security", type: "Technical", level: "Mid", roles: ["Backend", "Full Stack", "DevOps"], source: "Stripe, 2025", correctAnswer: "TLS handshake: 1) Client Hello (supported cipher suites, TLS version). 2) Server Hello (chosen cipher, certificate). 3) Client verifies certificate with CA. 4) Key exchange (client sends pre-master secret encrypted with server's public key, or Diffie-Hellman). 5) Both derive session keys. 6) Finished messages encrypted with session keys. All subsequent traffic uses symmetric encryption." },

  // ─── SYSTEM DESIGN ────────────────────────────────────────────────────
  { id: "sd1", question: "How would you design a URL shortener like bit.ly?", category: "System Design", type: "System Design", level: "Mid", roles: ["Backend", "Full Stack"], source: "Amazon, 2026", correctAnswer: "Key components: API gateway, URL service (generate short code via base62 encoding of auto-increment ID or random hash with collision check), database (store short→long mapping), cache (Redis for hot URLs, 80/20 rule). Handle redirects with 301 (cacheable) vs 302 (trackable). Scale with read replicas, CDN for redirects, analytics pipeline for click tracking. Consider expiry, custom slugs." },
  { id: "sd2", question: "How would you design a notification system for 10 million users?", category: "System Design", type: "System Design", level: "Senior", roles: ["Backend", "Full Stack"], source: "Meta, 2026", correctAnswer: "Components: notification service, message queue (Kafka/SQS for fan-out), delivery workers per channel (push/email/SMS), user preference service, rate limiter. For fan-out: use async queues, partition by user ID, handle failures with DLQ and retry. Store notification history in time-series DB. Prioritize critical notifications (security alerts) over promotional. Use WebSockets for real-time in-app." },

  // ─── DATA SCIENCE ─────────────────────────────────────────────────────
  { id: "ds1", question: "Explain the bias-variance tradeoff in machine learning.", category: "ML Theory", type: "Technical", level: "Mid", roles: ["Data Scientist", "ML Engineer"], source: "Google, 2026", correctAnswer: "Bias: error from wrong assumptions — high bias = underfitting (model too simple, misses patterns). Variance: sensitivity to training data fluctuations — high variance = overfitting (model too complex, memorizes noise). Tradeoff: reducing bias often increases variance and vice versa. Goal: find sweet spot. Tools: cross-validation, regularization (L1/L2 reduce variance), ensemble methods (bagging reduces variance, boosting reduces bias)." },
  { id: "ds2", question: "What is the difference between precision and recall? When do you optimize for each?", category: "ML Metrics", type: "Technical", level: "Junior", roles: ["Data Scientist", "ML Engineer", "Data Analyst"], source: "Netflix, 2025", correctAnswer: "Precision = TP/(TP+FP) — of all positives predicted, how many are actually positive. Recall = TP/(TP+FN) — of all actual positives, how many did we find. Optimize precision when false positives are costly (spam filter — don't miss legitimate emails). Optimize recall when false negatives are costly (cancer detection — never miss a case). F1 score balances both." },

  // ─── DEVOPS ───────────────────────────────────────────────────────────
  { id: "do1", question: "Explain the difference between containers and virtual machines.", category: "Infrastructure", type: "Technical", level: "Junior", roles: ["DevOps", "Cloud Engineer", "Backend"], source: "AWS, 2025", correctAnswer: "VMs: full OS emulation via hypervisor, strong isolation, GBs in size, minutes to boot. Containers: share host OS kernel, isolated via namespaces/cgroups, MBs in size, seconds to start. Containers are more lightweight and portable but share the kernel (less isolation). Docker packages app + dependencies; Kubernetes orchestrates containers at scale. Use VMs for strong isolation; containers for microservices and CI/CD." },
  { id: "do2", question: "What is a CI/CD pipeline and what does each stage do?", category: "DevOps Practices", type: "Technical", level: "Junior", roles: ["DevOps", "Backend", "Full Stack"], source: "GitHub, 2026", correctAnswer: "CI (Continuous Integration): automated build + test on every commit. Stages: source (git trigger) → build (compile/bundle) → test (unit/integration/lint) → static analysis (SAST/coverage). CD (Continuous Delivery/Deployment): deploy artifacts automatically. Stages: staging deploy → smoke tests → approval gate (Delivery) or auto-deploy to production (Deployment) → monitoring/rollback. Goal: fast, safe, repeatable releases." },

  // ─── PM / BUSINESS ────────────────────────────────────────────────────
  { id: "pm1", question: "How do you prioritize features for a product roadmap?", category: "Product Strategy", type: "Technical", level: "Mid", roles: ["Product Manager", "Business Analyst"], source: "Atlassian, 2026", correctAnswer: "Frameworks: RICE (Reach × Impact × Confidence / Effort), MoSCoW (Must/Should/Could/Won't), Value vs Effort matrix. Process: gather input from customer feedback, sales, support tickets, market data; align with OKRs; validate impact assumptions; consider dependencies and technical debt. Communicate tradeoffs transparently. Avoid the HiPPO effect (highest-paid person's opinion)." },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function selectQuestions(jobRole: string, count = 5): InterviewQuestion[] {
  const role = jobRole.toLowerCase();
  const isFrontend = role.includes("frontend") || role.includes("react") || role.includes("ui");
  const isBackend = role.includes("backend") || role.includes("node") || role.includes("python") || role.includes("java") || role.includes("api");
  const isFullStack = role.includes("full") || role.includes("fullstack");
  const isDevOps = role.includes("devops") || role.includes("cloud") || role.includes("infrastructure") || role.includes("sre");
  const isData = role.includes("data") || role.includes("ml") || role.includes("machine");
  const isPM = role.includes("product") || role.includes("manager") || role.includes("business");

  const matchRole = (q: InterviewQuestion) => {
    if (q.roles.includes("all")) return true;
    if (isFrontend && q.roles.some((r) => r.toLowerCase().includes("frontend") || r.toLowerCase().includes("full"))) return true;
    if (isBackend && q.roles.some((r) => r.toLowerCase().includes("backend") || r.toLowerCase().includes("full"))) return true;
    if (isFullStack && q.roles.some((r) => r.toLowerCase().includes("full") || r.toLowerCase().includes("backend") || r.toLowerCase().includes("frontend"))) return true;
    if (isDevOps && q.roles.some((r) => r.toLowerCase().includes("devops") || r.toLowerCase().includes("cloud"))) return true;
    if (isData && q.roles.some((r) => r.toLowerCase().includes("data") || r.toLowerCase().includes("ml"))) return true;
    if (isPM && q.roles.some((r) => r.toLowerCase().includes("product") || r.toLowerCase().includes("business"))) return true;
    return false;
  };

  const behavioral = shuffle(QUESTION_BANK.filter((q) => q.type === "Behavioral")).slice(0, 2);
  const roleSpecific = shuffle(QUESTION_BANK.filter((q) => q.type !== "Behavioral" && matchRole(q))).slice(0, 3);
  const remaining = shuffle(QUESTION_BANK.filter((q) => q.type !== "Behavioral" && !roleSpecific.includes(q)));
  const combined = shuffle([...behavioral, ...roleSpecific, ...remaining].slice(0, count));
  return combined.slice(0, count);
}

const InterviewContext = createContext<InterviewContextType | null>(null);

export function InterviewProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [currentSession, setCurrentSession] = useState<InterviewSession | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const KEY = useCallback(() => user ? `interview_${user.id}` : null, [user]);

  const load = useCallback(async () => {
    const k = KEY();
    if (!k) { setSessions([]); return; }
    const raw = await AsyncStorage.getItem(k);
    if (raw) setSessions(JSON.parse(raw));
    else setSessions([]);
  }, [KEY]);

  useEffect(() => { load(); }, [load]);

  const saveSessions = async (s: InterviewSession[]) => {
    const k = KEY();
    if (!k) return;
    await AsyncStorage.setItem(k, JSON.stringify(s));
    setSessions(s);
  };

  const startSession = async (jobRole: string) => {
    if (!user) return;
    setIsGenerating(true);
    try {
      const questions = selectQuestions(jobRole, 5);
      const session: InterviewSession = {
        id: Date.now().toString(),
        userId: user.id,
        jobRole,
        questions,
        answers: [],
        overallScore: null,
        feedback: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      setCurrentSession(session);
    } finally {
      setIsGenerating(false);
    }
  };

  const submitAnswer = async (questionId: string, transcript: string): Promise<InterviewAnswer> => {
    if (!currentSession) throw new Error("No active session");
    const q = currentSession.questions.find((x) => x.id === questionId);
    if (!q) throw new Error("Question not found");

    const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

    // Scoring criteria: relevance 40%, accuracy 30%, completeness 20%, grammar 10%
    let score = 0;
    let feedback = "";
    let correctAnswer = q.correctAnswer;

    // Detect garbage input
    const isGarbage = !transcript.trim() ||
      transcript.trim().length < 5 ||
      /^[^a-zA-Z]{5,}$/.test(transcript) ||
      /^(abcd|1234|test|asdf|qwerty|lorem)/i.test(transcript.trim()) ||
      (transcript.split(" ").length < 3 && transcript.length < 20);

    if (isGarbage) {
      score = 0;
      feedback = "Answer appears to be empty or random text. Please provide a genuine, relevant answer to receive a score.";
    } else if (apiKey) {
      try {
        const prompt = `You are a precise interview evaluator. Score this interview answer using EXACTLY these criteria weights:
- Relevance to the question (40%): Does the answer actually address what was asked?
- Accuracy/correctness (30%): Is the information technically correct?
- Completeness (20%): Does it cover key points?
- Language/grammar (10%): Is it clear and coherent?

Question: ${q.question}
Question Type: ${q.type}
Candidate's Answer: ${transcript}

IMPORTANT SCORING RULES:
- Garbage/random text (e.g. "abcd", "1234", "hello world") = 0
- Empty or off-topic answer = 0-10
- Partially relevant but incomplete = 20-50
- Good answer with some gaps = 55-75
- Strong, complete, accurate answer = 76-90
- Exceptional, expert-level answer = 91-100

Return JSON with:
- score: integer 0-100 (must follow the criteria and rules above precisely)
- feedback: 2-3 sentences of specific, actionable feedback referencing the actual answer content
- correctAnswer: ideal model answer for this question (3-5 sentences covering key points)`;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
        });
        const json = await res.json();
        const parsed = JSON.parse(json.choices[0].message.content);
        score = typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : score;
        feedback = parsed.feedback || feedback;
        if (parsed.correctAnswer) correctAnswer = parsed.correctAnswer;
      } catch { /* use fallback scoring */ }
    } else {
      // Heuristic scoring without API
      const wordCount = transcript.trim().split(/\s+/).length;
      const questionWords = q.question.toLowerCase().split(" ");
      const answerLower = transcript.toLowerCase();
      const relevanceHits = questionWords.filter((w) => w.length > 4 && answerLower.includes(w)).length;

      let base = 30;
      if (wordCount >= 30) base += 10;
      if (wordCount >= 80) base += 10;
      if (relevanceHits >= 2) base += 15;
      if (relevanceHits >= 4) base += 10;
      if (/because|therefore|however|specifically|for example|for instance/i.test(transcript)) base += 10;
      if (/\d+%|\$\d+|\d+ (months|years|weeks)/i.test(transcript)) base += 5;
      score = Math.min(78, base);
      feedback = `Score based on content analysis (no AI key). Your answer has ${wordCount} words and addresses ${relevanceHits} key question concepts. For a higher score: use the STAR method (Situation, Task, Action, Result), include specific examples, and quantify your impact where possible.`;
    }

    const answer: InterviewAnswer = { questionId, transcript, score, feedback, correctAnswer };
    const updated: InterviewSession = {
      ...currentSession,
      answers: [...currentSession!.answers.filter((a) => a.questionId !== questionId), answer],
    };
    setCurrentSession(updated);
    return answer;
  };

  const finishSession = async () => {
    if (!currentSession || !user) return;
    const answers = currentSession.answers;
    const overallScore = answers.length > 0
      ? Math.round(answers.reduce((a, b) => a + b.score, 0) / answers.length)
      : 0;
    const feedback =
      overallScore >= 85 ? "Outstanding performance! Your answers demonstrated strong technical depth, clear structure, and confident delivery. You're ready to ace real interviews."
      : overallScore >= 70 ? "Good effort! Focus on using the STAR method consistently, quantifying your impact with numbers, and covering edge cases in technical answers."
      : overallScore >= 50 ? "Keep practising. Aim for more specific examples and technical precision. Review the model answers carefully and practise out loud."
      : "Significant improvement needed. Study the correct answers provided, practise with real examples from your experience, and focus on one question type at a time.";

    const completed: InterviewSession = { ...currentSession, overallScore, feedback, completedAt: new Date().toISOString() };
    const updatedSessions = [...sessions.filter((s) => s.id !== completed.id), completed];
    await saveSessions(updatedSessions);
    setCurrentSession(null);
  };

  return (
    <InterviewContext.Provider value={{ sessions, currentSession, isGenerating, startSession, submitAnswer, finishSession }}>
      {children}
    </InterviewContext.Provider>
  );
}

export function useInterview() {
  const ctx = useContext(InterviewContext);
  if (!ctx) throw new Error("useInterview must be used within InterviewProvider");
  return ctx;
}

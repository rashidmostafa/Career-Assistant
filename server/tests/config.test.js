/**
 * Startup configuration checks — see config/validateEnv.js for why these
 * particular values are worth failing loudly on.
 */
const { validateEnv } = require("../config/validateEnv");

const ENV_KEYS = [
  "NODE_ENV", "MONGODB_URI", "JWT_SECRET", "SERVER_BASE_URL",
  "RENDER_EXTERNAL_URL", "HAWK_URL", "HAWK_SECRET", "AI_API_KEY",
];

let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  jest.restoreAllMocks();
});

const validProd = () => {
  process.env.NODE_ENV        = "production";
  process.env.MONGODB_URI     = "mongodb+srv://u:p@cluster.mongodb.net/career-assistant";
  process.env.JWT_SECRET      = "a".repeat(64);
  process.env.SERVER_BASE_URL = "https://career-assistant-api.onrender.com";
};

describe("validateEnv", () => {
  it("accepts a correct production configuration", () => {
    validProd();
    expect(() => validateEnv()).not.toThrow();
    expect(validateEnv().errors).toHaveLength(0);
  });

  it("refuses to start when the database is local", () => {
    validProd();
    process.env.MONGODB_URI = "mongodb://localhost:27017/career-assistant";
    // On Render this resolves to the container, so accounts would disappear on
    // every deploy — a silent failure worth refusing to boot over.
    expect(() => validateEnv()).toThrow(/configuration error/);
  });

  it("refuses to start with no database or no signing secret", () => {
    validProd();
    delete process.env.MONGODB_URI;
    expect(() => validateEnv()).toThrow();

    validProd();
    delete process.env.JWT_SECRET;
    expect(() => validateEnv()).toThrow();
  });

  it("treats a localhost Hawk URL as a warning, not a failure", () => {
    validProd();
    process.env.HAWK_URL = "http://localhost:8000";
    // Wrong on Render, but Hawk is optional and every caller falls back, so it
    // must not stop the API from serving everything else.
    expect(() => validateEnv()).not.toThrow();
    expect(validateEnv().warnings.join(" ")).toMatch(/HAWK_URL points at localhost/);
  });

  it("warns when Hawk is exposed without a shared secret", () => {
    validProd();
    process.env.HAWK_URL = "https://tunnel.example.com";
    expect(validateEnv().warnings.join(" ")).toMatch(/HAWK_SECRET/);
  });

  it("accepts a blank Hawk URL as a deliberate off switch", () => {
    validProd();
    process.env.HAWK_URL = "";
    expect(validateEnv().warnings.join(" ")).not.toMatch(/HAWK_URL/);
  });

  it("accepts Render's own external URL in place of SERVER_BASE_URL", () => {
    validProd();
    delete process.env.SERVER_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = "https://career-assistant-api.onrender.com";
    expect(validateEnv().warnings.join(" ")).not.toMatch(/SERVER_BASE_URL/);
  });

  it("reports problems without throwing outside production", () => {
    process.env.NODE_ENV = "development";
    expect(() => validateEnv()).not.toThrow();
    expect(validateEnv().errors.length).toBeGreaterThan(0);
  });
});

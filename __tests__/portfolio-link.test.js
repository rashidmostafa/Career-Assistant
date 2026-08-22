/**
 * The metrics sync must not destroy the link that triggered it.
 *
 * syncGithub built its next portfolio from the value in its closure, which was
 * captured before the link was added — so it saved `links: []` over the top and
 * the card disappeared moments after appearing.
 */
const React = require("react");
const renderer = require("react-test-renderer");

const mockStore = new Map();
jest.mock("@/services/syncedStorage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
    setItem: jest.fn(async (k, v) => { mockStore.set(k, v); }),
    removeItem: jest.fn(async (k) => { mockStore.delete(k); }),
  },
}));
// Stable identity: PortfolioContext's load() is useCallback([user]), so a fresh
// object each render would re-run the effect forever.
const mockUser = { id: "user123", name: "Rashid" };
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const { PortfolioProvider, usePortfolio } = require("../context/PortfolioContext");

let api;
function Probe() { api = usePortfolio(); return null; }

test("a GitHub link survives the metrics sync it triggers", async () => {
  mockStore.clear();
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("/repos")
        ? [{ stargazers_count: 3, language: "TypeScript" }]
        : { login: "rashidmostafa", public_repos: 7 },
  }));

  await renderer.act(async () => {
    renderer.create(React.createElement(PortfolioProvider, null, React.createElement(Probe)));
  });

  await renderer.act(async () => {
    await api.addLink("github.com/rashidmostafa", "");
    // Let the detached syncGithub run to completion and save.
    await new Promise((r) => setTimeout(r, 50));
  });

  const saved = JSON.parse(mockStore.get("portfolio_user123"));
  console.log("  links in state  :", api.portfolio?.links?.length);
  console.log("  links in storage:", saved.links.length);
  console.log("  github metrics  :", JSON.stringify(saved.github));

  expect(api.portfolio.links).toHaveLength(1);
  expect(api.portfolio.links[0].platformId).toBe("github");
  expect(saved.links).toHaveLength(1);          // survived the sync's save
  expect(saved.github.repos).toBe(7);           // and the metrics still landed
}, 20000);

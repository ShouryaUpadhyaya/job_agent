import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WellfoundAutoApplyManager from "./WellfoundAutoApplyManager";

// ---------------------------------------------------------------- fixtures

const run = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  mode: "DRY_RUN",
  visible: true,
  maxApplications: 1,
  status: "SUCCEEDED",
  startedAt: "2026-10-15T05:00:00.000Z",
  endedAt: "2026-10-15T05:03:00.000Z",
  exitCode: 0,
  logPath: "logs/wellfound/run-1.log",
  diagnosticsDir: "diagnostics/wellfound/run-1",
  submittedCount: 1,
  skippedCount: 0,
  errorCount: 0,
  error: null,
  diagnosticsCount: 1,
  ...over,
});

const overview = (over: Record<string, unknown> = {}) => ({
  stats: { todayKey: "2026-10-15", today: 3, dailyCap: 25, remainingToday: 22, totalApplications: 31, csvPath: "x" },
  executor: "agent",
  geminiConfigured: true,
  activeRun: null,
  lastRun: null,
  ...over,
});

const preflight = {
  ok: false,
  executor: "agent",
  checks: [
    { id: "agent", label: "Host agent reachable", ok: true, required: true, detail: "http://host.docker.internal:3002", fix: "" },
    { id: "session", label: "Saved Wellfound session", ok: false, required: true, detail: "missing", fix: "Run: npm run wellfound:login" },
  ],
};

const config = {
  profile: {
    name: "Shourya Upadhyaya", email: "s@example.org", phone: "", location: "Vellore", school: "VIT", currentRole: "student",
    company: "VIT", education: "B.Tech CSE", yearsOfExperience: "1 year", skills: "Node.js, React", highlights: ["Built OpenPumTa"],
    noticePeriod: "", currentCTC: "", expectedCTC: "", dob: "", gender: "", workAuth: "", github: "", linkedin: "", portfolio: "", x: "",
  },
  sources: new Proxy({}, { get: () => "profile" }),
  rules: { dailyCap: 25, autoTickTerms: true, maxRuntimeMinutes: 100 },
  geminiConfigured: true,
  envWritable: true,
};

// ---------------------------------------------------------------- fetch + EventSource mocks

type Handler = (url: URL, init: RequestInit | undefined) => unknown;
let routes: Record<string, Handler>;
const calls: { method: string; url: URL; body: unknown }[] = [];

const respond = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)) });

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, ((e: { data: string }) => void)[]> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type: string, data: unknown) {
    act(() => {
      for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(data) });
    });
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  calls.length = 0;
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  routes = {
    "GET /api/wellfound/overview": () => overview(),
    "GET /api/wellfound/preflight": () => preflight,
    "GET /api/wellfound/config": () => config,
    "GET /api/wellfound/runs": () => ({ runs: [run(), run({ id: "run-0", status: "FAILED", error: "logged out", mode: "LIVE" })] }),
    "GET /api/wellfound/runs/run-1/diagnostics": () => ({
      runId: "run-1",
      artifacts: [{ id: "01-logged-out", reason: "logged-out", screenshot: "01-logged-out.png", html: "01-logged-out.html", json: "01-logged-out.json", context: { url: "https://wellfound.com/login" } }],
      files: [{ name: "01-logged-out.png", size: 10 }, { name: "trace.zip", size: 20 }],
    }),
    "GET /api/wellfound/applications": () => ({
      today: 1,
      applications: [
        { date: "2026-10-15T04:00:00.000Z", role: "SDE Intern", company: "Acme", salary: "₹20k", link: "https://wellfound.com/jobs/1-a", submittedAt: "2026-10-15T04:00:00.000Z", istDate: "2026-10-15", isToday: true, stage: "APPLIED" },
        { date: "10/13/2026, 11:13:08 AM", role: "Backend Intern", company: "", link: "", submittedAt: "2026-10-13T05:43:08.000Z", istDate: "2026-10-13", isToday: false, stage: null },
      ],
    }),
    "POST /api/wellfound/sync-database": () => ({ success: true, result: { totalRows: 4, uniqueJobs: 3, newImported: 2, alreadyTracked: 1, advanced: 0, errors: [] } }),
    "POST /api/wellfound/runs": () => ({ run: run({ id: "run-new", status: "RUNNING", endedAt: null }) }),
    "PUT /api/wellfound/config": () => ({ ...config, message: "Saved." }),
    "GET /api/wellfound/script": () => "// Generated now — DRY RUN (never presses Apply)\nwindow.__APPLY_CONFIG = {};",
  };
  global.fetch = vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return respond({ error: `no mock for ${method} ${url.pathname}` }, 404);
    const out = handler(url, init);
    return out instanceof Promise ? out : respond(out);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------- tests

describe("WellfoundAutoApplyManager", () => {
  it("shows today's count from the server and an actionable preflight checklist", async () => {
    render(<WellfoundAutoApplyManager />);
    await waitFor(() => expect(screen.getByTestId("today-count").textContent).toBe("3"));
    expect(screen.getByText("/ 25 daily cap")).toBeDefined();
    expect(await screen.findByText("Saved Wellfound session")).toBeDefined();
    expect(screen.getByText("Fix: Run: npm run wellfound:login")).toBeDefined();
    expect(screen.getByText(/Not ready/)).toBeDefined();
  });

  it("starts a dry run and streams logs that stay after the run ends", async () => {
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByText("Start dry run"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/wellfound/runs")).toBe(true));
    const post = calls.find((c) => c.method === "POST" && c.url.pathname === "/api/wellfound/runs")!;
    expect(post.body).toMatchObject({ mode: "DRY_RUN", max: 1, visible: true });
    expect((post.body as { confirmLive?: boolean }).confirmLive).toBeUndefined();

    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/api/wellfound/runs/run-new/stream"))).toBe(true));
    const es = FakeEventSource.instances.find((e) => e.url.includes("run-new"))!;
    es.emit("run", run({ id: "run-new", status: "RUNNING", endedAt: null }));
    es.emit("log", { lines: ["2026-10-15T10:30:00.000+05:30 PAGE    ▶ Applying: SDE Intern @ Acme"], offset: 60 });
    expect(await screen.findByText(/Applying: SDE Intern @ Acme/)).toBeDefined();
    es.emit("end", run({ id: "run-new", status: "SUCCEEDED" }));
    expect(await screen.findByText("log complete")).toBeDefined();
    expect(screen.getByText(/Applying: SDE Intern @ Acme/)).toBeDefined();
    expect(es.closed).toBe(true);
  });

  it("requires typing APPLY before a live run", async () => {
    render(<WellfoundAutoApplyManager />);
    await screen.findByText("Start dry run");
    fireEvent.click(screen.getByText("Live"));
    fireEvent.click(screen.getByText("Start live run…"));
    const submit = screen.getByText("Submit applications") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/wellfound/runs")).toBe(false);

    fireEvent.change(screen.getByLabelText("Type APPLY to confirm"), { target: { value: "APPLY" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.pathname === "/api/wellfound/runs");
      expect(post?.body).toMatchObject({ mode: "LIVE", confirmLive: true });
    });
  });

  it("shows the server's preflight failure when a start is refused", async () => {
    routes["POST /api/wellfound/runs"] = () => respond({ error: "Preflight failed — fix the items below and retry.", preflight }, 412);
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByText("Start dry run"));
    expect(await screen.findByText(/Preflight failed — fix the items/)).toBeDefined();
  });

  it("falls back to polling when EventSource is unavailable", async () => {
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
    routes["GET /api/wellfound/overview"] = () => overview({ lastRun: run() });
    routes["GET /api/wellfound/runs/run-1/log"] = () => ({ lines: ["2026-10-15T10:30:00.000+05:30 ERROR   Wellfound session is logged out."], nextOffset: 80, done: true, run: run({ status: "FAILED" }) });
    render(<WellfoundAutoApplyManager />);
    expect(await screen.findByText(/Wellfound session is logged out/)).toBeDefined();
    expect(await screen.findByText("log complete")).toBeDefined();
  });

  it("lists run history with diagnostics thumbnails and HTML downloads", async () => {
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByRole("tab", { name: "History & Diagnostics" }));
    expect(await screen.findByText("logged out")).toBeDefined();
    const img = (await screen.findByAltText("Screenshot: logged-out")) as HTMLImageElement;
    expect(img.src).toContain("/api/wellfound/runs/run-1/diagnostics/01-logged-out.png");
    expect((screen.getByText("Download HTML") as HTMLAnchorElement).href).toContain("01-logged-out.html");
    expect(screen.getByText("trace.zip")).toBeDefined();
  });

  it("shows applied rows with today's marker and syncs to the pipeline", async () => {
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByRole("tab", { name: "Applied" }));
    expect(await screen.findByText("SDE Intern")).toBeDefined();
    expect(screen.getByText("TODAY")).toBeDefined();
    expect(screen.getByText("not synced")).toBeDefined();
    fireEvent.click(screen.getByText("Sync to pipeline"));
    expect(await screen.findByText(/Synced 3 jobs \(4 CSV rows\): 2 new/)).toBeDefined();
  });

  it("edits the profile without ever showing the Gemini key", async () => {
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByRole("tab", { name: "Profile & Rules" }));
    const name = (await screen.findByDisplayValue("Shourya Upadhyaya")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Shourya U" } });
    expect(screen.getByText("configured")).toBeDefined();
    fireEvent.click(screen.getByText("Save profile & rules"));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toMatchObject({ profile: { name: "Shourya U", gender: "", highlights: ["Built OpenPumTa"] }, rules: { dailyCap: 25, autoTickTerms: true } });
      expect((put?.body as { geminiKey?: string }).geminiKey).toBeUndefined();
    });
    expect(await screen.findByText(/Saved\. Runs and the Zen script use these values/)).toBeDefined();
  });

  it("builds a dry-run Zen script without the key by default", async () => {
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByRole("tab", { name: "Zen script" }));
    fireEvent.click(screen.getByText("Generate script"));
    expect(await screen.findByDisplayValue(/window.__APPLY_CONFIG/)).toBeDefined();
    const get = calls.find((c) => c.url.pathname === "/api/wellfound/script")!;
    expect(get.url.searchParams.get("mode")).toBe("dry");
    expect(get.url.searchParams.has("includeKey")).toBe(false);
  });

  it("explains setup in How to use", async () => {
    render(<WellfoundAutoApplyManager />);
    fireEvent.click(await screen.findByRole("tab", { name: "How to use" }));
    expect(screen.getByText("npm run wellfound:install")).toBeDefined();
    expect(screen.getAllByText("npm run wellfound:login").length).toBeGreaterThan(0);
    expect(screen.getAllByText("npm run wellfound:agent:docker").length).toBeGreaterThan(0);
  });
});

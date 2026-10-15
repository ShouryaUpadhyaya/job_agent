import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import SystemOverview, { timeAgo } from "./SystemOverview";

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body), json: async () => body });

const empty = {
  generatedAt: new Date().toISOString(),
  jobs: { active: 0, bySource: {}, freshness: { within3d: 0, within7d: 0, within30d: 0, older: 0 }, internships: 0, saved: 0, apply: 0, review: 0 },
  applications: { total: 0, byStage: {}, newThisWeek: 0, applied: 0, responded: 0, responseRate: null },
  contacts: { total: 0, byStatus: {}, vitAlumni: 0 },
  sync: { sources: [], failuresLast24h: 0 },
  gmail: { connected: false, status: "NOT_CONNECTED", email: null, lastSyncedAt: null },
  wellfound: { lastRun: null },
  resumes: { count: 0, defaultLabel: null },
};

describe("SystemOverview", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("renders empty states", async () => {
    global.fetch = vi.fn(() => reply(empty)) as unknown as typeof fetch;
    render(<SystemOverview />);
    await waitFor(() => expect(screen.getByText("Active jobs")).toBeDefined());
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText("No syncs have run.")).toBeDefined();
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.getByText("No runs yet.")).toBeDefined();
  });

  it("renders sync failures, Gmail and the last Wellfound run", async () => {
    const now = new Date().toISOString();
    global.fetch = vi.fn(() =>
      reply({
        ...empty,
        sync: { sources: [{ source: "lever", status: "FAILED", startedAt: now, completedAt: null, fetchedCount: 0, newCount: 0, errorMessage: "500", failuresLast24h: 2 }], failuresLast24h: 2 },
        gmail: { connected: true, status: "CONNECTED", email: "me@gmail.com", lastSyncedAt: now },
        wellfound: { lastRun: { mode: "DRY_RUN", status: "SUCCEEDED", startedAt: now, endedAt: now, submittedCount: 0, error: null } },
      })
    ) as unknown as typeof fetch;
    render(<SystemOverview />);
    await waitFor(() => expect(screen.getByText("lever")).toBeDefined());
    expect(screen.getByText(/2 failed in 24h/)).toBeDefined();
    expect(screen.getByText("Connected as me@gmail.com")).toBeDefined();
    expect(screen.getByText(/Succeeded · dry run/)).toBeDefined();
  });

  it("shows an inline error when the overview fails", async () => {
    global.fetch = vi.fn(() => reply({ error: "db down" }, false)) as unknown as typeof fetch;
    render(<SystemOverview />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("db down"));
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo("2026-10-15T11:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-10-13T12:00:00Z", now)).toBe("2d ago");
  });
});

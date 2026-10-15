import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Dashboard from "./Dashboard";

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body), json: async () => body });

describe("Dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => cleanup());

  it("renders the job discovery view by default", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/jobs/facets")) return reply({ sources: [], total: 0, internships: 0, saved: 0, dismissed: 0, closed: 0, resumes: [] });
      if (url.includes("/api/jobs")) return reply({ jobs: [], total: 0, page: 1, pageSize: 25, hasMore: false });
      if (url.includes("/api/profiles")) return reply({ id: "p", name: "Test", skills: [] });
      if (url.includes("/search-links")) return reply({ links: [] });
      if (url.includes("/x-sources")) return reply({ checkedAt: "", note: "", searchUrl: "https://x.com/search?q=x", accounts: [] });
      return reply({});
    }) as unknown as typeof fetch;

    render(<Dashboard />);
    expect(screen.getByRole("button", { name: "🎯 Job Discovery" })).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeDefined());
  });

  it("switches tabs and mirrors the tab in the URL", async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "👤 Profile & Resume" }));
    expect(window.location.search).toBe("?tab=PROFILE");
  });

  it("has no separate Job Sources tab; old ?tab=SOURCES links open the sources drawer in Discovery", async () => {
    window.history.replaceState(null, "", "/?tab=SOURCES");
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<Dashboard />);
    expect(screen.queryByRole("button", { name: /Job Sources|Target Companies/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Manage job sources" })).toBeDefined());
    expect(window.location.search).toBe("?tab=DISCOVERY");
  });
});

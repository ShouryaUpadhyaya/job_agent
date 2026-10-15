import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import SourcesManager from "./SourcesManager";

const mockSources = [
  {
    id: "src-1",
    sourceType: "greenhouse",
    name: "Cloudflare",
    boardToken: "cloudflare",
    enabled: true,
    jobCount: 420,
    supported: true,
    lastSyncedAt: new Date().toISOString(),
    lastRun: { status: "SUCCESS", startedAt: new Date().toISOString(), fetchedCount: 445, newCount: 3 },
  },
  {
    id: "src-2",
    sourceType: "smartrecruiters",
    name: "Freshworks",
    boardToken: "Freshworks",
    enabled: true,
    jobCount: 15,
    supported: true,
    lastRun: { status: "FAILED", startedAt: new Date().toISOString(), fetchedCount: 0, newCount: 0, errorMessage: "SmartRecruiters API error (500)" },
  },
  {
    id: "src-3",
    sourceType: "linkedin",
    name: "LinkedIn Jobs",
    boardToken: "software-engineer-intern",
    enabled: false,
    jobCount: 0,
    supported: false,
    unsupportedReason: "LinkedIn forbids automated access.",
  },
];

const types = [
  { type: "greenhouse", label: "Greenhouse", tokenLabel: "Board token", tokenRequired: true, example: "stripe" },
  { type: "smartrecruiters", label: "SmartRecruiters", tokenLabel: "Company id (case-sensitive)", tokenRequired: true, example: "Freshworks" },
  { type: "remotive", label: "Remotive", tokenLabel: "Category", tokenRequired: false, example: "software-dev" },
];

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, text: async () => JSON.stringify(body), json: async () => body });

function mockApi(extra: (url: string, init?: RequestInit) => unknown = () => undefined) {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.includes("/api/sources/types")) return reply({ types });
    if (url.endsWith("/api/sources")) return reply({ sources: mockSources });
    return reply({});
  }) as unknown as typeof fetch;
}

describe("SourcesManager", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("lists sources with last-run status, errors and unsupported rows", async () => {
    mockApi();
    render(<SourcesManager />);
    await waitFor(() => expect(screen.getByText("Cloudflare")).toBeDefined());
    expect(screen.getByText("420")).toBeDefined();
    expect(screen.getByText("SUCCESS")).toBeDefined();
    expect(screen.getByText("445 fetched · 3 new")).toBeDefined();
    expect(screen.getByText("SmartRecruiters API error (500)")).toBeDefined();
    expect(screen.getByText("Not supported")).toBeDefined();
    // Unsupported rows have no Sync button: 2 supported rows → 2 Sync buttons.
    expect(screen.getAllByRole("button", { name: "Sync" })).toHaveLength(2);
  });

  it("toggles a source", async () => {
    mockApi();
    render(<SourcesManager />);
    await waitFor(() => expect(screen.getByText("Cloudflare")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "Disable" })[0]);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/sources/src-1"), expect.objectContaining({ method: "PATCH" }))
    );
  });

  it("adds a source of a new type without lowercasing the token", async () => {
    mockApi();
    render(<SourcesManager />);
    await waitFor(() => expect(screen.getByText("Cloudflare")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "+ Add source" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "SmartRecruiters" })).toBeDefined());
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "smartrecruiters" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "ServiceNow" } });
    fireEvent.change(screen.getByLabelText("Company id (case-sensitive)"), { target: { value: "ServiceNow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    await waitFor(() => {
      const post = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([u, init]) => String(u).endsWith("/api/sources") && (init as RequestInit)?.method === "POST"
      );
      expect(post).toBeDefined();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ sourceType: "smartrecruiters", boardToken: "ServiceNow", name: "ServiceNow" });
    });
  });

  it("shows sync results and failures", async () => {
    mockApi((url) =>
      url.includes("/src-1/sync")
        ? reply({ source: mockSources[0], new: 4, updated: 10, closed: 2, durationMs: 120 })
        : url.includes("/src-2/sync")
        ? reply({ error: "SmartRecruiters API error (500)" }, false)
        : undefined
    );
    render(<SourcesManager />);
    await waitFor(() => expect(screen.getByText("Cloudflare")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "Sync" })[0]);
    await waitFor(() => expect(screen.getByText("✓ Synced Cloudflare: 4 new, 10 updated, 2 closed (120ms)")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "Sync" })[1]);
    await waitFor(() => expect(screen.getByText("✗ Sync failed: SmartRecruiters API error (500)")).toBeDefined());
  });
});

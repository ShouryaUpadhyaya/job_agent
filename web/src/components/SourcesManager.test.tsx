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
    lastSyncedAt: new Date().toISOString(),
  },
  {
    id: "src-2",
    sourceType: "lever",
    name: "Spotify",
    boardToken: "spotify",
    enabled: false,
    jobCount: 15,
  },
];

describe("SourcesManager Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sources table with company boards", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sources: mockSources }),
    });

    render(<SourcesManager />);

    await waitFor(() => {
      expect(screen.getByText("Cloudflare")).toBeDefined();
      expect(screen.getByText("Spotify")).toBeDefined();
    });

    expect(screen.getByText("420")).toBeDefined();
    expect(screen.getByText("spotify")).toBeDefined();
  });

  it("handles toggling source enabled status", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sources: mockSources }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ source: { ...mockSources[0], enabled: false } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sources: [{ ...mockSources[0], enabled: false }, mockSources[1]],
        }),
      });

    render(<SourcesManager />);

    await waitFor(() => {
      expect(screen.getByText("Cloudflare")).toBeDefined();
    });

    const disableBtn = screen.getByRole("button", { name: "Disable" });
    fireEvent.click(disableBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/sources/src-1"),
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  it("opens add company board form", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sources: mockSources }),
    });

    render(<SourcesManager />);

    await waitFor(() => {
      expect(screen.getByText("Cloudflare")).toBeDefined();
    });

    const addBtn = screen.getByRole("button", { name: "+ Add Company Board" });
    fireEvent.click(addBtn);

    expect(screen.getByText("Track New Employer ATS Board")).toBeDefined();
  });
});

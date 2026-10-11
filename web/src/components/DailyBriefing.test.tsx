import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import DailyBriefing from "./DailyBriefing";

const mockBriefing = {
  id: "briefing-1",
  summaryDate: new Date().toISOString(),
  timezone: "Asia/Kolkata",
  content: "# Executive Briefing\n- 🚨 Action: Interview scheduled with Cloudflare\n- 🤝 Connection accepted by Priya Sharma",
  newApplicationsCount: 3,
  interviewsCount: 1,
  rejectionsCount: 0,
  acceptedConnectionsCount: 1,
  needsAttentionCount: 1,
  generatedAt: new Date().toISOString(),
};

describe("DailyBriefing Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders metrics, briefing content, and 8:00 PM IST banner", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/briefing/today")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockBriefing),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([mockBriefing]),
      });
    }) as unknown as typeof fetch;

    render(<DailyBriefing />);

    await waitFor(() => {
      expect(screen.getByText("Executive Daily Briefing")).toBeDefined();
      expect(screen.getByText("Automated at 8:00 PM IST")).toBeDefined();
      expect(screen.getByText("🚨 Needs Attention")).toBeDefined();
    });

    expect(screen.getByText(/Interview scheduled with Cloudflare/)).toBeDefined();
    expect(screen.getByText("⚡ Refresh Briefing Now")).toBeDefined();
  });
});

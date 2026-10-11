import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GmailSync from "./GmailSync";

const mockStatus = {
  connected: true,
  email: "candidate@gmail.com",
  lastSyncedAt: new Date().toISOString(),
  totalEventsTracked: 12,
  hasCredentialsConfigured: true,
};

const mockEvents = [
  {
    id: "ev-1",
    messageId: "msg-101",
    sender: "recruiting@cloudflare.com",
    subject: "Invitation to Interview: Systems Engineer Intern",
    snippet: "Schedule a technical interview with our team",
    receivedAt: new Date().toISOString(),
    classification: "INTERVIEW_INVITATION",
    confidence: 0.95,
    company: "Cloudflare",
    suggestedAction: "Select an interview slot promptly",
  },
  {
    id: "ev-2",
    messageId: "msg-102",
    sender: "invitations@linkedin.com",
    subject: "Priya Sharma accepted your invitation to connect",
    snippet: "Priya Sharma is now a connection",
    receivedAt: new Date().toISOString(),
    classification: "LINKEDIN_CONNECTION_ACCEPTED",
    confidence: 0.98,
    company: "Cloudflare",
    suggestedAction: "Draft tailored referral follow-up note",
  },
];

describe("GmailSync Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders connection status and events feed", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/gmail/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStatus),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      });
    }) as unknown as typeof fetch;

    render(<GmailSync />);

    await waitFor(() => {
      expect(screen.getByText("● Connected")).toBeDefined();
      expect(screen.getByText("Synchronized with candidate@gmail.com")).toBeDefined();
    });

    expect(screen.getByText("INTERVIEW INVITATION")).toBeDefined();
    expect(screen.getByText("LINKEDIN CONNECTION ACCEPTED")).toBeDefined();
    expect(screen.getByText("Select an interview slot promptly")).toBeDefined();
  });
});

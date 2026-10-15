import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GmailSync from "./GmailSync";

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

let calls: { url: string; init?: RequestInit }[] = [];
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  calls = [];
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return (handler(url, init) as Promise<unknown>) ?? reply({});
  }) as unknown as typeof fetch;
}

const baseStatus = {
  configured: true,
  missingEnv: [],
  redirectUri: "http://localhost:3001/api/gmail/oauth2callback",
  setup: [],
  connected: true,
  accountStatus: "CONNECTED",
  email: "candidate@gmail.com",
  lastSyncedAt: new Date().toISOString(),
  lastSync: { startedAt: "", finishedAt: "", after: "", fetched: 10, new: 4, skipped: 6, errors: 0, remaining: 0, byClassification: {}, stageChanges: 1, applicationsCreated: 1, contactsCreated: 0, jobAlertListings: 0 },
  lastError: null,
  totalEventsTracked: 12,
  demoEvents: 0,
};

const summary = {
  days: 7,
  totalEvents: 3,
  counts: { INTERVIEW_INVITATION: 1, RECRUITER_OUTREACH: 1, JOB_ALERT: 1 },
  needsAction: [
    {
      eventId: "e1",
      kind: "INTERVIEW",
      subject: "Interview invitation - Backend Intern at CRED",
      company: "CRED",
      role: "Backend Intern",
      sender: "a@cred.club",
      senderName: "Ananya",
      deadline: "within 48 hours",
      receivedAt: new Date().toISOString(),
      suggestedAction: "Reply",
      application: { id: "a1", stage: "INTERVIEWING", title: "Backend Intern", company: "CRED" },
      contact: null,
      link: "?tab=PIPELINE",
    },
    {
      eventId: "e2",
      kind: "RECRUITER_REPLY",
      subject: "Opportunity at Juspay",
      company: "Juspay",
      role: null,
      sender: "rohan@juspay.in",
      senderName: "Rohan Mehta",
      deadline: null,
      receivedAt: new Date().toISOString(),
      suggestedAction: "Reply",
      application: null,
      contact: { id: "c1", name: "Rohan Mehta", company: "Juspay", status: "RESEARCHED" },
      link: "?tab=NETWORKING",
    },
  ],
  statusChanges: [{ eventId: "e1", applicationId: "a1", company: "CRED", title: "Backend Intern", from: "APPLIED", to: "INTERVIEWING", at: new Date().toISOString(), currentStage: "INTERVIEWING" }],
  newApplications: [],
  jobAlerts: { emails: 1, listingsAdded: 5 },
  highlights: ["1 interview invite to schedule."],
  aiSummary: null,
};

const events = [
  {
    id: "ev-1",
    messageId: "m1",
    sender: "a@cred.club",
    senderName: "Ananya",
    subject: "Interview invitation - Backend Intern at CRED",
    snippet: "Schedule a technical interview",
    receivedAt: new Date().toISOString(),
    classification: "INTERVIEW_INVITATION",
    confidence: 0.9,
    importance: "HIGH",
    company: "CRED",
    suggestedAction: "Reply with your availability",
    jobApplication: { id: "a1", stage: "INTERVIEWING", jobListing: { title: "Backend Intern", company: "CRED" } },
    networkingContact: null,
  },
];

function standard(overrides: { status?: unknown; sync?: () => Promise<unknown> } = {}) {
  mockFetch((url, init) => {
    if (url.includes("/api/gmail/status")) return reply(overrides.status ?? baseStatus);
    if (url.includes("/api/gmail/summary")) return reply(summary);
    if (url.includes("/api/gmail/events")) return reply(events);
    if (url.includes("/api/gmail/sync") && init?.method === "POST") return overrides.sync ? overrides.sync() : reply({ ...baseStatus.lastSync, new: 2 });
    if (url.includes("/api/gmail/disconnect")) return reply({ accounts: 1, revoked: 1 });
    return reply({});
  });
}

describe("GmailSync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState(null, "", "/?tab=GMAIL");
  });
  afterEach(() => cleanup());

  it("shows the summary first, connection status and linked events", async () => {
    standard();
    render(<GmailSync />);
    await waitFor(() => expect(screen.getByText("Account: candidate@gmail.com")).toBeDefined());
    expect(screen.getByText("Connected")).toBeDefined();
    expect(screen.getByText("Deadline: within 48 hours")).toBeDefined();
    expect(screen.getByText("Open in Pipeline").getAttribute("href")).toBe("?tab=PIPELINE");
    expect(screen.getByText("Open in Networking").getAttribute("href")).toBe("?tab=NETWORKING");
    expect(screen.getByTestId("sync-stats").textContent).toContain("4 new");
    await waitFor(() => expect(screen.getByText(/Application: CRED · Backend Intern/)).toBeDefined());
    // Summary panel is rendered above the connection card.
    const sections = screen.getAllByRole("region");
    expect(sections[0].getAttribute("aria-label")).toBe("Inbox summary");
  });

  it("explains setup when Gmail is not configured", async () => {
    standard({
      status: { ...baseStatus, configured: false, connected: false, accountStatus: null, email: null, missingEnv: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"], setup: ["Enable the Gmail API.", "Add the redirect URI."], lastSync: null },
    });
    render(<GmailSync />);
    await waitFor(() => expect(screen.getByText(/Missing: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET/)).toBeDefined());
    expect(screen.getByText("Enable the Gmail API.")).toBeDefined();
    expect(screen.queryByText("Connect Gmail")).toBeNull();
  });

  it("shows a fix when sync fails with an expired grant", async () => {
    standard({ sync: () => reply({ error: "Token has been expired or revoked.", code: "invalid_grant", fix: "Reconnect Gmail." }, 401) });
    render(<GmailSync />);
    await waitFor(() => expect(screen.getByText("Sync now")).toBeDefined());
    fireEvent.click(screen.getByText("Sync now"));
    await waitFor(() => expect(screen.getByText("Last sync failed: Token has been expired or revoked.")).toBeDefined());
    expect(screen.getByText("How to fix: Reconnect Gmail.")).toBeDefined();
  });

  it("disconnect asks for inline confirmation", async () => {
    standard();
    render(<GmailSync />);
    await waitFor(() => expect(screen.getByText("Disconnect")).toBeDefined());
    fireEvent.click(screen.getByText("Disconnect"));
    expect(calls.some((c) => c.url.includes("/disconnect"))).toBe(false);
    fireEvent.click(screen.getByText("Yes, disconnect"));
    await waitFor(() => expect(screen.getByText("Gmail disconnected and access revoked.")).toBeDefined());
    expect(calls.find((c) => c.url.includes("/disconnect"))?.init?.method).toBe("POST");
  });

  it("shows the OAuth result banner and clears it from the URL", async () => {
    window.history.replaceState(null, "", "/?tab=GMAIL&auth=error&reason=You%20declined%20access");
    standard();
    render(<GmailSync />);
    await waitFor(() => expect(screen.getByText("Gmail connection failed: You declined access")).toBeDefined());
    expect(window.location.search).toBe("?tab=GMAIL");
  });

  it("filters events by every classification, importance, link and demo", async () => {
    standard();
    render(<GmailSync />);
    await waitFor(() => expect(screen.getByLabelText("Type")).toBeDefined());
    const options = Array.from((screen.getByLabelText("Type") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(["RECRUITER_OUTREACH", "REFERRAL_RESPONSE", "JOB_ALERT", "UNKNOWN", "FOLLOW_UP_REQUIRED", "UNRELATED"]));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "JOB_ALERT" } });
    fireEvent.change(screen.getByLabelText("Importance"), { target: { value: "LOW" } });
    fireEvent.change(screen.getByLabelText("Linked"), { target: { value: "unlinked" } });
    fireEvent.change(screen.getByLabelText("Demo events"), { target: { value: "include" } });
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/api/gmail/events")).at(-1)!.url;
      expect(last).toContain("classification=JOB_ALERT");
      expect(last).toContain("importance=LOW");
      expect(last).toContain("linked=unlinked");
      expect(last).toContain("demo=include");
    });
  });
});

import { render, screen, waitFor, fireEvent, cleanup, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import ApplicationsPipeline from "./ApplicationsPipeline";
import type { PipelineApplication } from "./pipeline/types";

const fit = (score: number) => ({
  score,
  closed: false,
  breakdown: [
    { key: "match", label: "Resume match", points: 30, max: 45, detail: "Match score 70/100" },
    { key: "alumni", label: "VIT alumni there", points: 10, max: 20, detail: "1 VIT alumnus saved" },
  ],
});

const job = (id: string, title: string, company: string, location: string | null, score: number, extra = {}) => ({
  id,
  title,
  company,
  location,
  url: `https://example.com/${id}`,
  source: "greenhouse",
  score,
  status: "APPLY",
  matchReasons: [],
  matchedSkills: [],
  missingSkills: [],
  isActive: true,
  closedReason: null,
  closedAt: null,
  bestResumeId: null,
  publishedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

const mockApplications: PipelineApplication[] = [
  {
    id: "app-1",
    jobListingId: "job-1",
    stage: "BOOKMARKED",
    status: "DRAFT",
    isApproved: false,
    notes: "Follow up next week",
    appliedUrl: null,
    submittedAt: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    lastEmailAt: null,
    source: "manual",
    companyKey: "stripe",
    documentCount: 0,
    emailCount: 0,
    job: job("job-1", "Backend Engineering Intern", "Stripe", "Remote", 82),
    people: {
      count: 2,
      alumniCount: 1,
      engagedCount: 0,
      topContacts: [
        {
          id: "c1",
          name: "Priya Sharma",
          role: "SWE",
          company: "Stripe",
          persona: "ENGINEER",
          vitAlumni: true,
          status: "RESEARCHED",
          effectiveStatus: "RESEARCHED",
          linkedinUrl: null,
          xUrl: null,
          email: null,
          priority: 70,
          followUpDue: false,
        },
      ],
    },
    fit: fit(64),
  },
  {
    id: "app-2",
    jobListingId: "job-2",
    stage: "APPLIED",
    status: "SUBMITTED",
    isApproved: true,
    notes: null,
    appliedUrl: null,
    submittedAt: "2026-10-05T00:00:00.000Z",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    lastEmailAt: "2026-10-10T00:00:00.000Z",
    source: "wellfound",
    companyKey: "linear",
    documentCount: 0,
    emailCount: 1,
    job: job("job-2", "Full Stack Intern", "Linear", null, 55, { isActive: false, closedReason: "404" }),
    people: { count: 0, alumniCount: 0, engagedCount: 0, topContacts: [] },
    fit: fit(40),
  },
];

const stats = {
  total: 2,
  stages: { BOOKMARKED: 1, APPLYING: 0, APPLIED: 1, INTERVIEWING: 0, OFFERED: 0, REJECTED: 0, ARCHIVED: 0 },
  other: 0,
  sources: { manual: 1, wellfound: 1 },
};

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body } as Response);

type Handler = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(handler: Handler = () => undefined, list: unknown = mockApplications) {
  calls = [];
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const custom = handler(url, init);
    if (custom) return custom;
    if (url.includes("/api/applications/stats")) return reply(stats);
    if (url.includes("/api/applications") && (!init?.method || init.method === "GET")) return reply(list);
    return reply({});
  }) as unknown as typeof fetch;
}

const listCalls = () => calls.filter((c) => /\/api\/applications(\?|$)/.test(c.url) && (!c.init?.method || c.init.method === "GET"));

describe("ApplicationsPipeline", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("renders cards with real job details, scores, dates and the people strip", async () => {
    mockFetch();
    render(<ApplicationsPipeline />);

    await screen.findByText("Backend Engineering Intern");
    expect(screen.getByText("Full Stack Intern")).toBeDefined();
    expect(screen.queryByText(/Role Title/)).toBeNull();
    expect(screen.queryByText(/Location/)).toBeNull();
    expect(screen.getByText("Follow up next week")).toBeDefined();
    expect(screen.getByText("Match 82")).toBeDefined();
    expect(screen.getByText("Fit 64")).toBeDefined();
    expect(screen.getByText(/Applied 5 Oct 2026/)).toBeDefined();
    expect(screen.getByText(/Last email 10 Oct 2026/)).toBeDefined();
    expect(screen.getByText(/Listing looks closed \(404\)/)).toBeDefined();
    expect(screen.getByText("Wellfound")).toBeDefined();

    const strip = screen.getByTestId("people-strip-stripe");
    expect(within(strip).getByText(/2 people · 1 VIT alumni/)).toBeDefined();
    expect(within(strip).getByText("Priya Sharma")).toBeDefined();
    expect(within(strip).getByText("Draft referral ask")).toBeDefined();
    // People came from the list response: no per-card by-company requests.
    expect(calls.some((c) => c.url.includes("/api/networking/by-company"))).toBe(false);
    // Default sort is fit.
    expect(listCalls()[0].url).toContain("sort=fit");
  });

  it("shows the fit breakdown on click", async () => {
    mockFetch();
    render(<ApplicationsPipeline />);
    fireEvent.click(await screen.findByText("Fit 64"));
    const dialog = screen.getByRole("dialog", { name: "Fit breakdown" });
    expect(within(dialog).getByText("Resume match")).toBeDefined();
    expect(within(dialog).getByText("30/45")).toBeDefined();
  });

  it("passes the sort, stage, source and alumni filters to the server", async () => {
    mockFetch();
    render(<ApplicationsPipeline />);
    await screen.findByText("Backend Engineering Intern");

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "alumni" } });
    await waitFor(() => expect(listCalls().at(-1)!.url).toContain("sort=alumni"));

    fireEvent.click(screen.getByRole("button", { name: "Applied 1" }));
    await waitFor(() => expect(listCalls().at(-1)!.url).toContain("stage=APPLIED"));

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "wellfound" } });
    await waitFor(() => expect(listCalls().at(-1)!.url).toContain("source=wellfound"));

    fireEvent.click(screen.getByLabelText("Has VIT alumni"));
    await waitFor(() => expect(listCalls().at(-1)!.url).toContain("hasAlumni=true"));

    // Later loads never bring back the full-page spinner.
    expect(screen.queryByRole("status", { name: "Loading applications" })).toBeNull();
    expect(screen.getByText("Backend Engineering Intern")).toBeDefined();
  });

  it("updates the stage optimistically and keeps the server copy", async () => {
    let resolvePatch: (r: Response) => void = () => undefined;
    mockFetch((url, init) => {
      if (init?.method === "PATCH") return new Promise<Response>((r) => (resolvePatch = r));
      return undefined;
    });
    render(<ApplicationsPipeline />);
    const card = await screen.findByTestId("application-app-1");

    fireEvent.change(within(card).getByLabelText("Stage"), { target: { value: "INTERVIEWING" } });
    // Before the server answers, the badge already shows the new stage.
    expect(within(card).getAllByText("Interviewing").length).toBeGreaterThan(0);
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toContain("/api/applications/app-1");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ stage: "INTERVIEWING" });

    await act(async () => {
      resolvePatch(await reply({ ...mockApplications[0], stage: "INTERVIEWING", status: "INTERVIEWING", fit: fit(77) }));
    });
    await waitFor(() => expect(within(screen.getByTestId("application-app-1")).getByText("Fit 77")).toBeDefined());
  });

  it("rolls back a failed stage change and shows an inline error", async () => {
    mockFetch((url, init) => (init?.method === "PATCH" ? reply({ error: "Invalid stage" }, 400) : undefined));
    render(<ApplicationsPipeline />);
    const card = await screen.findByTestId("application-app-1");
    const select = within(card).getByLabelText("Stage") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "OFFERED" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid stage");
    expect((within(screen.getByTestId("application-app-1")).getByLabelText("Stage") as HTMLSelectElement).value).toBe("BOOKMARKED");
  });

  it("edits notes inline", async () => {
    mockFetch((url, init) =>
      init?.method === "PATCH" ? reply({ ...mockApplications[0], notes: "Recruiter: Asha" }) : undefined
    );
    render(<ApplicationsPipeline />);
    fireEvent.click(await screen.findByText("Follow up next week"));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Recruiter: Asha" } });
    fireEvent.click(screen.getByText("Save notes"));
    expect(screen.getByText("Recruiter: Asha")).toBeDefined();
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ notes: "Recruiter: Asha" });
  });

  it("deletes after an inline confirm and restores the card if the server fails", async () => {
    mockFetch((url, init) => (init?.method === "DELETE" ? reply({ error: "boom" }, 500) : undefined));
    render(<ApplicationsPipeline />);
    await screen.findByText("Backend Engineering Intern");

    fireEvent.click(screen.getByLabelText("Remove Backend Engineering Intern from pipeline"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Backend Engineering Intern")).toBeDefined();
    expect(calls.some((c) => c.init?.method === "DELETE" && c.url.includes("/api/applications/app-1"))).toBe(true);
  });

  it("switches to the board view with stage columns and move buttons", async () => {
    mockFetch((url, init) =>
      init?.method === "PATCH" ? reply({ ...mockApplications[0], stage: "APPLYING", status: "DRAFT" }) : undefined
    );
    render(<ApplicationsPipeline />);
    await screen.findByText("Backend Engineering Intern");
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    const board = screen.getByTestId("kanban-board");
    expect(within(board).getByRole("region", { name: "Interviewing column" })).toBeDefined();
    const saved = within(board).getByRole("region", { name: "Saved column" });
    fireEvent.click(within(saved).getByLabelText("Move to Preparing"));
    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === "PATCH")!;
      expect(JSON.parse(String(patch.init!.body))).toEqual({ stage: "APPLYING" });
    });
  });

  it("renders the empty state when nothing is tracked", async () => {
    mockFetch(undefined, []);
    render(<ApplicationsPipeline />);
    expect(await screen.findByText("No Applications Tracked Yet")).toBeDefined();
  });
});

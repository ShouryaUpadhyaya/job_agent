import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import DailyBriefing from "./DailyBriefing";
import { BriefingMarkdown, formatDateKey, linkHref } from "./briefing/ui";
import type { Briefing, BriefingResponse } from "./briefing/types";

const structured: Briefing = {
  version: 1,
  date: "2026-10-15",
  generatedAt: "2026-10-15T14:35:00.000Z",
  trigger: "scheduled",
  candidateName: "Asha Rao",
  inShort: { text: "Start with the Acme interview, then message Priya.", source: "rules" },
  counts: {
    newApplicationsCount: 2,
    interviewsCount: 1,
    rejectionsCount: 3,
    acceptedConnectionsCount: 1,
    needsAttentionCount: 1,
    offersCount: 1,
    newMatchesCount: 1,
    staleCount: 0,
    wellfoundRunsCount: 0,
  },
  matchesSince: "2026-10-14T14:30:00.000Z",
  sections: [
    {
      key: "actions",
      title: "Today's actions",
      emptyText: "Nothing urgent.",
      items: [
        {
          key: "INTERVIEW_INVITATION:e1",
          kind: "INTERVIEW_INVITATION",
          title: "Schedule your interview with Acme",
          detail: 'SWE Intern · "Interview with Acme"',
          tags: ["Deadline: Oct 18"],
          urgency: "high",
          link: { tab: "PIPELINE", id: "app1", label: "Open application" },
        },
      ],
    },
    {
      key: "matches",
      title: "New matches",
      emptyText: "No new matches.",
      items: [
        {
          key: "match:j1",
          kind: "MATCH",
          title: "Backend Intern at NewCo",
          tags: ["Use: Backend resume"],
          urgency: "normal",
          link: { tab: "DISCOVERY", id: "j1", label: "View in Discovery" },
          externalUrl: "https://example.com/jobs/1",
        },
      ],
    },
    { key: "stale", title: "Stale applications", emptyText: "Nothing has been waiting 14+ days.", items: [] },
  ],
  stats: {
    thisWeek: { applications: 5, responses: 2, interviews: 1, contactsMessaged: 3 },
    lastWeek: { applications: 3, responses: 2, interviews: 0, contactsMessaged: 4 },
    thisWeekRange: { from: "2026-10-09", to: "2026-10-15" },
    lastWeekRange: { from: "2026-10-02", to: "2026-10-08" },
  },
};

const today: BriefingResponse = {
  id: "b1",
  date: "2026-10-15",
  summaryDate: "2026-10-15",
  timezone: "Asia/Kolkata",
  deliveryStatus: "GENERATED",
  generatedAt: structured.generatedAt,
  newApplicationsCount: 2,
  interviewsCount: 1,
  rejectionsCount: 3,
  acceptedConnectionsCount: 1,
  needsAttentionCount: 1,
  content: "# Daily briefing",
  briefing: structured,
  persisted: true,
};

const legacy: BriefingResponse = {
  ...today,
  id: "b0",
  date: "2026-10-14",
  summaryDate: "2026-10-14",
  needsAttentionCount: 0,
  briefing: null,
  content: "# Old briefing\n## Needs Attention\n- **Interview** with [Beta](https://beta.example/jobs)\n- <script>alert(1)</script>",
};

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

let calls: { url: string; init?: RequestInit }[] = [];
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  calls = [];
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init) ?? reply({});
  }) as unknown as typeof fetch;
}

function standardApi(overrides: { generate?: BriefingResponse; live?: BriefingResponse; today?: BriefingResponse } = {}) {
  mockFetch((url, init) => {
    if (url.includes("/api/briefing/today")) return reply(overrides.today ?? today);
    if (url.includes("/api/briefing/history")) return reply([today, legacy]);
    if (url.includes("/api/briefing/live")) return reply(overrides.live ?? { ...today, id: null, persisted: false, briefing: { ...structured, trigger: "live" } });
    if (url.includes("/api/briefing/generate") && init?.method === "POST") return reply(overrides.generate ?? today);
    return reply({});
  });
}

describe("DailyBriefing", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("renders counts, the In short line and section cards with deep links", async () => {
    standardApi();
    render(<DailyBriefing />);

    expect(await screen.findByText("Schedule your interview with Acme")).toBeDefined();
    expect(screen.getByText("Start with the Acme interview, then message Priya.")).toBeDefined();
    expect(screen.getByText("Rejections").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText("Deadline: Oct 18")).toBeDefined();
    expect(screen.getByText("Nothing has been waiting 14+ days.")).toBeDefined();

    const open = screen.getByRole("link", { name: "Open application" });
    expect(open.getAttribute("href")).toBe("/?tab=PIPELINE&id=app1");
    expect(screen.getByRole("link", { name: "View in Discovery" }).getAttribute("href")).toBe("/?tab=DISCOVERY&id=j1");
    expect(screen.getByRole("link", { name: /Posting/ }).getAttribute("href")).toBe("https://example.com/jobs/1");
    expect(screen.getByText("This week vs last week")).toBeDefined();
    expect(screen.getByText("+2")).toBeDefined();
    // No raw markdown on screen.
    expect(screen.queryByText(/# Daily briefing/)).toBeNull();
  });

  it("labels history with the IST date string and renders legacy markdown safely", async () => {
    standardApi();
    render(<DailyBriefing />);
    await screen.findByText("Schedule your interview with Acme");

    const oct14 = screen.getByRole("button", { name: /14 Oct/ });
    expect(screen.getByRole("button", { name: /15 Oct/ })).toBeDefined();
    fireEvent.click(oct14);

    expect(await screen.findByText("Old briefing")).toBeDefined();
    expect(screen.getByRole("link", { name: "Beta" }).getAttribute("href")).toBe("https://beta.example/jobs");
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/Showing the briefing for/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Back to today" }));
    expect(await screen.findByText("Schedule your interview with Acme")).toBeDefined();
  });

  it("regenerates via POST and can switch to the live view", async () => {
    standardApi({
      generate: { ...today, briefing: { ...structured, trigger: "manual", inShort: { text: "Fresh focus line for today.", source: "gemini" } } },
    });
    render(<DailyBriefing />);
    await screen.findByText("Schedule your interview with Acme");

    fireEvent.click(screen.getByRole("button", { name: "Regenerate today's briefing" }));
    expect(await screen.findByText("Fresh focus line for today.")).toBeDefined();
    expect(screen.getByText(/AI summary/)).toBeDefined();
    expect(calls.some((c) => c.url.includes("/api/briefing/generate") && c.init?.method === "POST")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Live view" }));
    expect(await screen.findByText(/built from current data just now/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show saved briefing" }));
    await waitFor(() => expect(screen.queryByText(/built from current data just now/)).toBeNull());
  });

  it("shows guidance when every section is empty and surfaces API errors", async () => {
    const empty = { ...structured, sections: structured.sections.map((s) => ({ ...s, items: [] })) };
    standardApi({ today: { ...today, briefing: empty } });
    render(<DailyBriefing />);
    expect(await screen.findByText("Nothing to report yet.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Gmail" }).getAttribute("href")).toBe("/?tab=GMAIL");
    cleanup();

    mockFetch(() => reply({ error: "Failed to load today's briefing" }, 500));
    render(<DailyBriefing />);
    expect((await screen.findByRole("alert")).textContent).toContain("Failed to load today's briefing");
  });
});

describe("briefing ui helpers", () => {
  it("formatDateKey never shifts the IST date", () => {
    expect(formatDateKey("2026-10-15")).toMatch(/15 Oct/);
    expect(formatDateKey("2026-01-01", { day: "numeric", month: "short", year: "numeric" })).toMatch(/1 Jan 2026/);
  });

  it("linkHref adds id and params", () => {
    expect(linkHref({ tab: "NETWORKING", params: { companyKey: "acme" }, label: "x" })).toBe("/?tab=NETWORKING&companyKey=acme");
  });

  it("BriefingMarkdown drops unsafe links", () => {
    render(<BriefingMarkdown content={"- [click](javascript:alert(1)) and **bold**"} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});

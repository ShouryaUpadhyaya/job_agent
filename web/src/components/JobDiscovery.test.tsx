import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import JobDiscovery from "./JobDiscovery";
import { guessFromPastedText } from "./discovery/AddJobModal";
import { draftCoverLetter } from "./discovery/JobDetail";

const job = (over: Record<string, unknown>) => ({
  id: "1",
  title: "Backend Engineer Intern",
  company: "TechCorp",
  location: "Bengaluru, India",
  source: "greenhouse",
  sourceLabel: "Greenhouse",
  url: "https://techcorp.test/jobs/1",
  description: "Build awesome APIs.",
  descriptionTruncated: false,
  score: 85,
  status: "APPLY",
  matchReasons: ["Internship role", "Skills: TypeScript, Node.js", "CHECK: Mentions 2+ years of experience."],
  matchedSkills: ["TypeScript", "Node.js"],
  missingSkills: ["Kubernetes"],
  userStatus: "NONE",
  appliedStage: null,
  bestResumeLabel: "Backend",
  freshness: { postedAt: new Date().toISOString(), postedAtIsEstimate: false, ageDays: 2 },
  verified: true,
  verificationLabel: "Live in source feed",
  ...over,
});

const jobs = [
  job({}),
  job({ id: "2", title: "Frontend Intern", company: "DataCo", score: 40, status: "REVIEW", appliedStage: "APPLIED", source: "email:linkedin", sourceLabel: "LinkedIn alerts", verified: false, verificationLabel: "Unverified, older than 9 days", freshness: { postedAt: null, postedAtIsEstimate: true, ageDays: 9 } }),
];

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body), json: async () => body });

let calls: { url: string; init?: RequestInit }[] = [];

function mockApi(overrides: (url: string, init?: RequestInit) => unknown = () => undefined) {
  calls = [];
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const o = overrides(url, init);
    if (o) return o;
    if (url.includes("/api/jobs/facets"))
      return reply({ sources: [{ value: "greenhouse", label: "Greenhouse", count: 1 }, { value: "email:linkedin", label: "LinkedIn alerts", count: 1 }], total: 2, internships: 2, saved: 0, dismissed: 0, closed: 0, resumes: [] });
    if (url.includes("/user-status")) return reply({ id: "1", userStatus: JSON.parse(String(init?.body)).userStatus });
    if (url.includes("/api/jobs")) {
      const page = Number(new URL(url).searchParams.get("page") || 1);
      return page === 1
        ? reply({ jobs, total: 3, page: 1, pageSize: 25, hasMore: true })
        : reply({ jobs: [job({ id: "3", title: "Platform Intern", company: "Third" })], total: 3, page: 2, pageSize: 25, hasMore: false });
    }
    if (url.includes("/api/profiles")) return reply({ id: "p", name: "Asha Rao", targetRole: "Software Engineer Intern", targetGradYear: 2028, school: "Example University", skills: ["TypeScript"] });
    if (url.includes("/search-links")) return reply({ links: [{ id: "linkedin-india", site: "LinkedIn", label: "LinkedIn: SWE intern in India (past week)", url: "https://www.linkedin.com/jobs/search/?f_E=1", description: "d", group: "job-boards" }] });
    if (url.includes("/x-sources")) return reply({ checkedAt: "2026-10-15", note: "", searchUrl: "https://x.com/search?q=intern", accounts: [{ handle: "examplefeed", name: "Example Feed", url: "https://x.com/examplefeed", posts: "Internships", evidence: "e", evidenceUrl: "https://x.com/examplefeed" }] });
    if (url.includes("/api/sync")) return reply({ summary: { totalNew: 5, totalUpdated: 2 } });
    return reply({});
  }) as unknown as typeof fetch;
}

describe("JobDiscovery", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("shows loading, then cards with freshness, applied marker and why-matched chips", async () => {
    mockApi();
    render(<JobDiscovery />);
    expect(screen.getByTestId("loading-state")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    const card1 = screen.getByTestId("job-item-1");
    expect(within(card1).getByText("Posted 2d ago")).toBeDefined();
    expect(within(card1).getByText("Internship role")).toBeDefined();
    expect(within(card1).getByText("Best resume: Backend")).toBeDefined();
    const card2 = screen.getByTestId("job-item-2");
    expect(within(card2).getByText("✓ Applied · APPLIED")).toBeDefined();
    expect(within(card2).getByText("Unverified, older than 9 days")).toBeDefined();
    expect(screen.getByText(/Target: Software Engineer Intern · 2028 grad · Example University/)).toBeDefined();
  });

  it("shows search links and X feeds when no job is selected, and details when one is", async () => {
    mockApi();
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByText("LinkedIn: SWE intern in India (past week) ↗")).toBeDefined());
    expect(screen.getByText("@examplefeed")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    fireEvent.click(screen.getByTestId("job-item-1"));
    const details = screen.getByTestId("job-details");
    expect(within(details).getByText("✓ TypeScript")).toBeDefined();
    expect(within(details).getByText("Kubernetes")).toBeDefined();
    expect(within(details).getByText("⚠ Mentions 2+ years of experience.")).toBeDefined();
  });

  it("sends filters to the API", async () => {
    mockApi();
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    fireEvent.click(screen.getByLabelText(/Internships only/));
    fireEvent.change(screen.getByLabelText("Posted within"), { target: { value: "7" } });
    fireEvent.click(screen.getByLabelText("Source: LinkedIn alerts"));
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "newest" } });
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/api/jobs?")).pop()!;
      const q = new URL(last.url).searchParams;
      expect(q.get("internshipOnly")).toBe("true");
      expect(q.get("postedWithinDays")).toBe("7");
      expect(q.get("sources")).toBe("email:linkedin");
      expect(q.get("sort")).toBe("newest");
    });
  });

  it("loads more and dismisses jobs", async () => {
    mockApi();
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    await waitFor(() => expect(screen.getByTestId("job-item-3")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Backend Engineer Intern" }));
    await waitFor(() => expect(screen.queryByTestId("job-item-1")).toBeNull());
    const patch = calls.find((c) => c.url.includes("/api/jobs/1/user-status"));
    expect(patch?.init?.method).toBe("PATCH");
  });

  it("runs a sync", async () => {
    mockApi();
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Sync Jobs" }));
    await waitFor(() => expect(screen.getByText("Sync complete: 5 new, 2 updated")).toBeDefined());
  });

  it("adds a job from pasted details", async () => {
    mockApi((url) => (url.endsWith("/api/jobs/import") ? reply({ job: { title: "Data Intern" }, isNew: true, application: { stage: "BOOKMARKED" } }) : undefined));
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "+ Add job" }));
    fireEvent.change(screen.getByLabelText("Job URL"), { target: { value: "https://www.linkedin.com/jobs/view/4012345678/" } });
    fireEvent.change(screen.getByLabelText("Job description"), { target: { value: "Data Intern\nAcme · Pune\nWork with SQL." } });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Data Intern");
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Add job" }));
    await waitFor(() => expect(screen.getByText('✓ "Data Intern" added and tracked in the pipeline (BOOKMARKED).')).toBeDefined());
    const post = calls.find((c) => c.url.endsWith("/api/jobs/import"))!;
    expect(JSON.parse(String(post.init?.body))).toMatchObject({ title: "Data Intern", company: "Acme", location: "Pune", trackInPipeline: true });
    // Nothing was requested from LinkedIn itself.
    expect(calls.some((c) => c.url.includes("linkedin.com"))).toBe(false);
  });

  it("shows an error state", async () => {
    mockApi((url) => (url.includes("/api/jobs?") ? Promise.reject(new Error("API Error")) : undefined));
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByTestId("error-state")).toBeDefined());
    expect(screen.getByText("API Error")).toBeDefined();
  });
});

describe("helpers", () => {
  it("guesses fields from pasted text", () => {
    expect(guessFromPastedText("SDE Intern\nAcme Corp · Bengaluru\n...")).toEqual({ title: "SDE Intern", company: "Acme Corp", location: "Bengaluru" });
  });

  it("drafts a cover letter from the profile, not hardcoded text", () => {
    const text = draftCoverLetter(job({}) as never, { id: "p", name: "Asha Rao", school: "Example University", targetGradYear: 2028, skills: [] });
    expect(text).toContain("Asha Rao");
    expect(text).toContain("Example University");
    expect(text).not.toContain("VIT");
  });
  it("opens the Manage sources drawer with the sources manager and closes it", async () => {
    mockApi((url) => (url.endsWith("/api/sources") ? reply({ sources: [{ id: "s1", sourceType: "greenhouse", name: "Cloudflare", boardToken: "cloudflare", enabled: true, jobCount: 3, supported: true }] }) : undefined));
    render(<JobDiscovery />);
    await waitFor(() => expect(screen.getByTestId("job-item-1")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Manage sources" }));
    const dialog = screen.getByRole("dialog", { name: "Manage job sources" });
    await waitFor(() => expect(within(dialog).getByText("Cloudflare")).toBeDefined());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Manage job sources" })).toBeNull();
  });

  it("opens the sources drawer immediately when asked by a deep link", async () => {
    mockApi();
    render(<JobDiscovery initialSourcesOpen />);
    expect(screen.getByRole("dialog", { name: "Manage job sources" })).toBeDefined();
  });
});

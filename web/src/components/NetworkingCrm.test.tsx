import { render, screen, waitFor, fireEvent, cleanup, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NetworkingCrm from "./NetworkingCrm";

const contact = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Priya Sharma",
  company: "Razorpay",
  companyKey: "razorpay",
  role: "Software Engineer",
  headline: "SDE @ Razorpay | VIT Vellore",
  linkedinUrl: "https://www.linkedin.com/in/priya",
  xUrl: null,
  githubUrl: null,
  email: "priya@example.com",
  emailSource: "manual",
  school: "VIT Vellore",
  persona: "ENGINEER",
  source: "MANUAL",
  verified: true,
  vitAlumni: true,
  status: "RESEARCHED",
  effectiveStatus: "RESEARCHED",
  followUpDue: false,
  noReply: false,
  notes: null,
  targetJobId: "j1",
  targetJob: { id: "j1", title: "Backend Intern", company: "Razorpay", url: "https://jobs.example.com/1" },
  requestSentAt: null,
  acceptedAt: null,
  lastContactAt: null,
  nextFollowUpAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  priority: { score: 80, breakdown: [{ label: "Base", points: 10 }, { label: "VIT alumni (warmest cold contact)", points: 30 }] },
  nextActions: [
    { kind: "draft", value: "CONNECTION_NOTE", label: "Draft connection note" },
    { kind: "status", value: "REQUEST_SENT", label: "Request sent" },
  ],
  applicationStage: "APPLIED",
  messages: [],
  ...over,
});

const facets = { total: 2, alumni: 1, followUpDue: 1, status: { RESEARCHED: 1, FOLLOW_UP_DUE: 1 }, persona: {}, source: {}, companies: [{ companyKey: "razorpay", company: "Razorpay", count: 2 }] };

const reply = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  Promise.resolve({ ok, status, text: async () => JSON.stringify(body), json: async () => body });

let calls: { url: string; init?: RequestInit }[] = [];

function mockApi(overrides: (url: string, init?: RequestInit) => unknown = () => undefined, contacts: unknown[] = [contact(), contact({ id: "c2", name: "Alex Rivera", vitAlumni: false, school: null, persona: "RECRUITER", effectiveStatus: "FOLLOW_UP_DUE", followUpDue: true, messages: [{ id: "m1", contactId: "c2", type: "REFERRAL_ASK", content: "Draft body", status: "DRAFT", sentAt: null, createdAt: "", updatedAt: "" }] })]) {
  calls = [];
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const o = overrides(url, init);
    if (o) return o;
    if (url.includes("/api/networking/facets")) return reply(facets);
    if (url.includes("/api/networking/duplicates")) return reply({ groups: [] });
    if (url.includes("/api/networking/contacts?") || url.endsWith("/api/networking/contacts")) return reply(contacts);
    return reply({});
  }) as unknown as typeof fetch;
}

const contactListCalls = () => calls.filter((c) => /\/api\/networking\/contacts(\?|$)/.test(c.url) && (c.init?.method ?? "GET") === "GET");

describe("NetworkingCrm", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders real contacts with badges, links, email as text, linked job and drafts", async () => {
    mockApi();
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeDefined());
    const card = screen.getByText("Priya Sharma").closest("article")!;
    expect(within(card).getByText("VIT alumni")).toBeDefined();
    expect(within(card).getByText("Engineer")).toBeDefined();
    expect(within(card).getByText("Verified by you")).toBeDefined();
    expect(within(card).getByText("LinkedIn").getAttribute("href")).toBe("https://www.linkedin.com/in/priya");
    expect(within(card).getByText("priya@example.com").tagName).toBe("SPAN");
    expect(within(card).getByText("Backend Intern").getAttribute("href")).toBe("https://jobs.example.com/1");
    expect(within(card).getByLabelText("Priority 80")).toBeDefined();

    const alex = screen.getByText("Alex Rivera").closest("article")!;
    expect(within(alex).getByText("Follow-up due", { selector: "span" })).toBeDefined();
    expect(within(alex).getByText("Draft body")).toBeDefined();
    expect(within(alex).getByText("Mark sent")).toBeDefined();
  });

  it("offers all 11 statuses in the filter and sends filters to the server", async () => {
    mockApi();
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeDefined());
    const statusSelect = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(statusSelect.options.length).toBe(12);
    fireEvent.change(statusSelect, { target: { value: "FOLLOW_UP_DUE" } });
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "RECRUITER" } });
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "company" } });
    await waitFor(() => {
      const last = contactListCalls().at(-1)!.url;
      expect(last).toContain("status=FOLLOW_UP_DUE");
      expect(last).toContain("persona=RECRUITER");
      expect(last).toContain("sort=company");
    });
  });

  it("debounces search and aborts the stale request", async () => {
    mockApi();
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeDefined());
    vi.useFakeTimers();
    const before = contactListCalls().length;
    const input = screen.getByLabelText("Search contacts");
    fireEvent.change(input, { target: { value: "p" } });
    fireEvent.change(input, { target: { value: "pr" } });
    fireEvent.change(input, { target: { value: "pri" } });
    expect(contactListCalls().length).toBe(before);
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    vi.useRealTimers();
    await waitFor(() => expect(contactListCalls().length).toBe(before + 1));
    expect(contactListCalls().at(-1)!.url).toContain("q=pri");
    // The previous request's signal was aborted when the query changed.
    const prev = contactListCalls().at(-2)!;
    expect((prev.init?.signal as AbortSignal).aborted).toBe(true);
  });

  it("transitions status from a next-action button", async () => {
    mockApi();
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeDefined());
    const card = screen.getByText("Priya Sharma").closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Request sent" }));
    await waitFor(() => {
      const t = calls.find((c) => c.url.includes("/contacts/c1/transition"));
      expect(t).toBeDefined();
      expect(JSON.parse(String(t!.init!.body))).toEqual({ newStage: "REQUEST_SENT" });
    });
  });

  it("deletes only after an inline confirmation", async () => {
    mockApi();
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeDefined());
    const card = screen.getByText("Priya Sharma").closest("article")!;
    fireEvent.click(within(card).getByText("Delete"));
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    fireEvent.click(within(card).getByText("Yes, delete"));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE" && c.url.includes("/contacts/c1"))).toBe(true));
  });

  it("explains how to add real people when there are none", async () => {
    mockApi((url) => (url.includes("/facets") ? reply({ ...facets, total: 0, companies: [] }) : undefined), []);
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("No contacts yet")).toBeDefined());
    expect(screen.getByText(/only tracks real people you find/)).toBeDefined();
    expect(screen.queryByText(/Generate/)).toBeNull();
  });

  it("opens the find-people panel with search links for a company", async () => {
    mockApi((url) =>
      url.includes("/people-links")
        ? reply({ links: [{ id: "linkedin-alumni-0", group: "ALUMNI", site: "LinkedIn", label: "LinkedIn: Zepto + VIT Vellore", url: "https://www.linkedin.com/search/results/people/?keywords=Zepto+VIT+Vellore", description: "alumni" }] })
        : undefined
    );
    render(<NetworkingCrm />);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeDefined());
    fireEvent.click(screen.getAllByText("Find people at a company")[0]);
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Zepto" } });
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("LinkedIn: Zepto + VIT Vellore")).toBeDefined());
    expect(screen.getByText("LinkedIn: Zepto + VIT Vellore").getAttribute("target")).toBe("_blank");
  });
});

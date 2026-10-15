import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompanyPeoplePanel, MessageDraftModal, PeopleStrip, QuickAddContact, validateContactForm } from "./index";

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
const body = (i: number) => JSON.parse(String(calls[i].init?.body));

describe("networking components", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("validateContactForm rejects LinkedIn search links and bad handles", () => {
    const base = { name: "A", company: "B", linkedinUrl: "", xUrl: "", githubUrl: "", email: "" };
    expect(validateContactForm(base)).toEqual({});
    expect(validateContactForm({ ...base, linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=x" }).linkedinUrl).toBeDefined();
    expect(validateContactForm({ ...base, xUrl: "x.com/search?q=1" }).xUrl).toBeDefined();
    expect(validateContactForm({ ...base, xUrl: "@good_handle" }).xUrl).toBeUndefined();
    expect(validateContactForm({ ...base, name: "" }).name).toBeDefined();
  });

  it("QuickAddContact prefills from the headline and offers duplicate handling", async () => {
    mockFetch((url) => {
      if (url.includes("/parse-headline")) return reply({ role: "SDE", company: "Razorpay", persona: "ENGINEER", school: "VIT Vellore", vitAlumni: true });
      if (url.endsWith("/api/networking/contacts"))
        return reply({ error: "Looks like Priya at Razorpay is already saved.", duplicate: { id: "c9", name: "Priya", company: "Razorpay", vitAlumni: false, email: null }, canForce: true }, 409);
      if (url.includes("/contacts/c9")) return reply({ id: "c9" });
      return reply({});
    });
    const onSaved = vi.fn();
    render(<QuickAddContact onSaved={onSaved} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Priya" } });
    const headline = screen.getByPlaceholderText("SDE-2 @ Razorpay | VIT Vellore '21");
    fireEvent.change(headline, { target: { value: "SDE @ Razorpay | VIT Vellore" } });
    fireEvent.blur(headline);
    await waitFor(() => expect((screen.getByLabelText("Company *") as HTMLInputElement).value).toBe("Razorpay"));
    expect((screen.getByLabelText("School") as HTMLInputElement).value).toBe("VIT Vellore");
    expect((screen.getByLabelText("VIT alumni") as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText("Email (only one they gave you or published)"), { target: { value: "p@example.com" } });
    fireEvent.click(screen.getByText("Add contact"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByText(/already saved/)).toBeDefined();

    fireEvent.click(screen.getByText("Add these details to the existing contact"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    const sent = JSON.parse(String(patch.init!.body));
    expect(sent.email).toBe("p@example.com");
    expect(sent.vitAlumni).toBe(true);
    expect(sent.name).toBeUndefined(); // existing non-empty fields are not overwritten
  });

  it("MessageDraftModal asks for a job when a referral ask has none, then drafts and marks sent", async () => {
    let generated = 0;
    mockFetch((url) => {
      if (url.includes("/messages/generate")) {
        generated++;
        return generated === 1
          ? reply({ needsJobLink: true, message: null, reason: "Link the job first.", jobOptions: [{ id: "j1", title: "Backend Intern", company: "Razorpay", url: "u", applicationStage: "APPLIED" }] })
          : reply({
              needsJobLink: false,
              message: { id: "m1", content: "Hi Priya, Backend Intern https://jobs/1", status: "DRAFT" },
              content: "Hi Priya, Backend Intern https://jobs/1",
              type: "REFERRAL_ASK",
              usedAi: false,
              charCount: 40,
              wordCount: 5,
              limit: { words: 120 },
              job: { id: "j1", title: "Backend Intern", url: "https://jobs/1" },
              warnings: [],
            });
      }
      if (url.includes("/mark-sent")) return reply({ message: { id: "m1", content: "x", status: "SENT" } });
      return reply({});
    });
    const onChanged = vi.fn();
    render(<MessageDraftModal contact={{ id: "c1", name: "Priya", company: "Razorpay" }} type="REFERRAL_ASK" onClose={() => undefined} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText("Link the job first.")).toBeDefined());
    fireEvent.click(screen.getByText("Link job and draft"));
    await waitFor(() => expect((screen.getByLabelText("Message text") as HTMLTextAreaElement).value).toContain("Backend Intern"));
    expect(body(1)).toMatchObject({ type: "REFERRAL_ASK", jobListingId: "j1" });
    expect(screen.getByText(/5 words \(max 120\)/)).toBeDefined();
    fireEvent.click(screen.getByText("I sent it"));
    await waitFor(() => expect(screen.getByText(/Marked as sent/)).toBeDefined());
    expect(onChanged).toHaveBeenCalled();
  });

  it("CompanyPeoplePanel lists GitHub people and adds one", async () => {
    mockFetch((url) => {
      if (url.includes("/people-links")) return reply({ links: [] });
      if (url.includes("/github-people/add")) return reply({ id: "new" }, 201);
      if (url.includes("/github-people"))
        return reply({
          company: "Razorpay",
          org: { login: "razorpay", name: "Razorpay", htmlUrl: "https://github.com/razorpay" },
          orgCandidates: [],
          source: "members",
          rateLimited: false,
          rateLimitResetAt: null,
          message: null,
          people: [
            { login: "dev1", name: "Dev One", htmlUrl: "https://github.com/dev1", avatarUrl: null, blog: null, twitterUsername: null, company: "@razorpay", bio: null, email: null, location: null, via: "member", companyMatches: true, existingContactId: null },
            { login: "dev2", name: null, htmlUrl: "https://github.com/dev2", avatarUrl: null, blog: null, twitterUsername: null, company: null, bio: null, email: null, location: null, via: "member", companyMatches: false, existingContactId: "c5" },
          ],
        });
      return reply({});
    });
    const onAdded = vi.fn();
    render(<CompanyPeoplePanel company="Razorpay" onAdded={onAdded} />);
    fireEvent.click(screen.getByText("Find on GitHub"));
    await waitFor(() => expect(screen.getByText("Dev One")).toBeDefined());
    expect(screen.getByText("Saved")).toBeDefined(); // dev2 already a contact
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const add = calls.find((c) => c.url.includes("/github-people/add"))!;
    expect(JSON.parse(String(add.init!.body))).toEqual({ login: "dev1" });
  });

  it("PeopleStrip fetches by company and shows counts and top contacts", async () => {
    mockFetch((url) =>
      url.includes("/by-company")
        ? reply({
            razorpay: {
              count: 4,
              alumniCount: 2,
              topContacts: [{ id: "c1", name: "Priya", role: "SDE", company: "Razorpay", persona: "ENGINEER", vitAlumni: true, status: "RESEARCHED", effectiveStatus: "RESEARCHED", linkedinUrl: "https://www.linkedin.com/in/p", xUrl: null, email: null, priority: 85, followUpDue: false }],
            },
          })
        : reply({})
    );
    render(<PeopleStrip company="Razorpay" companyKey="razorpay" jobListingId="j1" />);
    await waitFor(() => expect(screen.getByText("4 people · 2 VIT alumni")).toBeDefined());
    expect(calls[0].url).toContain("keys=razorpay");
    expect(screen.getByText("Priya").getAttribute("href")).toBe("https://www.linkedin.com/in/p");
    expect(screen.getByText("Draft referral ask")).toBeDefined();
  });
});

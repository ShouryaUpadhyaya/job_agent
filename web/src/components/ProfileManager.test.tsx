import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import ProfileManager from "./ProfileManager";

const mockProfile = {
  id: "prof-1",
  name: "Asha Rao",
  email: "asha@example.org",
  phone: "+91 90000 00000",
  location: "Vellore",
  school: "Example University",
  targetRole: "Software Engineer Intern",
  targetGradYear: 2028,
  githubUrl: "https://github.com/asha",
  preferredLocations: ["Bengaluru", "Remote"],
  remoteOk: true,
  skills: ["TypeScript", "React", "Node.js", "Docker"],
  education: { institution: "Example University", degree: "B.Tech Computer Science", graduationYear: 2028 },
  experience: [{ kind: "work", company: "Acme", role: "Backend Intern", dates: "2025", bullets: ["Built APIs"] }],
  applicationAnswers: { noticePeriod: "Immediate", wellfoundRules: { dailyCap: 5 } },
};

const resumes = [
  { id: "r1", label: "Backend", targetCategory: "backend", content: "backend text", skills: ["Java", "PostgreSQL"], fileName: "backend.pdf", isDefault: true, createdAt: "", updatedAt: "", bestForCount: 12 },
  { id: "r2", label: "Frontend", targetCategory: "frontend", content: "frontend text", skills: ["React"], fileName: null, isDefault: false, createdAt: "", updatedAt: "", bestForCount: 1 },
];

const overview = {
  generatedAt: new Date().toISOString(),
  jobs: { active: 40, bySource: { greenhouse: 30, lever: 10 }, freshness: { within3d: 5, within7d: 6, within30d: 9, older: 20 }, internships: 12, saved: 2, apply: 8, review: 10 },
  applications: { total: 4, byStage: { APPLIED: 3, INTERVIEWING: 1 }, newThisWeek: 2, applied: 4, responded: 1, responseRate: 0.25 },
  contacts: { total: 3, byStatus: { RESEARCHED: 3 }, vitAlumni: 1 },
  sync: { sources: [{ source: "greenhouse", status: "SUCCESS", startedAt: new Date().toISOString(), completedAt: null, fetchedCount: 1, newCount: 0, errorMessage: null, failuresLast24h: 0 }], failuresLast24h: 0 },
  gmail: { connected: false, status: "NOT_CONNECTED", email: null, lastSyncedAt: null },
  wellfound: { lastRun: null },
  resumes: { count: 2, defaultLabel: "Backend" },
};

const reply = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  Promise.resolve({ ok, status, text: async () => JSON.stringify(body), json: async () => body });

let calls: { url: string; init?: RequestInit }[] = [];

function mockApi(overrides: (url: string, init?: RequestInit) => unknown = () => undefined) {
  calls = [];
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const o = overrides(url, init);
    if (o) return o;
    if (url.includes("/api/overview")) return reply(overview);
    if (url.includes("/api/resumes")) return reply({ resumes, rescore: { running: false } });
    if (url.includes("/api/profiles")) return reply(mockProfile);
    return reply({});
  }) as unknown as typeof fetch;
}

const bodyOf = (match: (c: { url: string; init?: RequestInit }) => boolean) => {
  const call = calls.find(match);
  return call?.init?.body ? JSON.parse(String(call.init.body)) : undefined;
};

describe("ProfileManager", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("renders the overview, editable profile sections and the resumes list", async () => {
    mockApi();
    render(<ProfileManager />);

    await waitFor(() => expect(screen.getByDisplayValue("Asha Rao")).toBeDefined());
    expect(screen.getByDisplayValue("+91 90000 00000")).toBeDefined();
    expect(screen.getByDisplayValue("https://github.com/asha")).toBeDefined();
    expect(screen.getByDisplayValue("Backend Intern")).toBeDefined();
    expect(screen.getByDisplayValue("Immediate")).toBeDefined();
    expect(screen.getByText("Bengaluru")).toBeDefined();

    await waitFor(() => expect(screen.getByText("Active jobs")).toBeDefined());
    expect(screen.getByText("25%")).toBeDefined();

    await waitFor(() => expect(screen.getAllByTestId("resume-item")).toHaveLength(2));
    const first = screen.getAllByTestId("resume-item")[0];
    expect(within(first).getByText("Default")).toBeDefined();
    expect(within(first).getByText(/Best match for 12 active jobs/)).toBeDefined();
  });

  it("saves every section without wiping data, merging application answers", async () => {
    mockApi((url, init) => (url.includes("/api/profiles") && init?.method === "POST" ? reply({ ...mockProfile, rescore: { status: "done", rescored: 40, error: null } }) : undefined));
    render(<ProfileManager />);
    await waitFor(() => expect(screen.getByDisplayValue("Asha Rao")).toBeDefined());

    fireEvent.change(screen.getByDisplayValue("Vellore"), { target: { value: "Chennai" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Docker" }));
    fireEvent.change(screen.getByPlaceholderText(/Add skill \(e\.g/), { target: { value: "Kubernetes" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Profile Changes" }));

    await waitFor(() => expect(screen.getByText(/Profile saved\. Rescored 40 jobs\./)).toBeDefined());
    const body = bodyOf((c) => c.url.includes("/api/profiles") && c.init?.method === "POST");
    expect(body.location).toBe("Chennai");
    expect(body.skills).toEqual(["TypeScript", "React", "Node.js", "Kubernetes"]);
    expect(body).not.toHaveProperty("rawResume");
    expect(body.experience).toEqual([{ kind: "work", company: "Acme", role: "Backend Intern", dates: "2025", bullets: ["Built APIs"] }]);
    expect(body.applicationAnswers.noticePeriod).toBe("Immediate");
    expect(body.applicationAnswers.gender).toBeNull(); // blank = prefer not to say
    expect(body.applicationAnswers).not.toHaveProperty("wellfoundRules");
  });

  it("shows save errors inline", async () => {
    mockApi((url, init) => (url.includes("/api/profiles") && init?.method === "POST" ? reply({ error: "targetGradYear must be a year" }, false, 400) : undefined));
    render(<ProfileManager />);
    await waitFor(() => expect(screen.getByDisplayValue("Asha Rao")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Save Profile Changes" }));
    await waitFor(() => expect(screen.getByText("targetGradYear must be a year")).toBeDefined());
  });

  it("adds a resume from pasted text", async () => {
    mockApi((url, init) =>
      url.endsWith("/api/resumes") && init?.method === "POST"
        ? reply({ resume: { ...resumes[1], id: "r3", label: "Data", skills: ["Python", "SQL"] }, filledProfileFields: [], rescore: { status: "running" } }, true, 201)
        : undefined
    );
    render(<ProfileManager />);
    await waitFor(() => expect(screen.getAllByTestId("resume-item")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByLabelText("New resume label"), { target: { value: "Data" } });
    fireEvent.change(screen.getByLabelText("Resume text"), { target: { value: "Python and SQL" } });
    fireEvent.click(screen.getByRole("button", { name: "Add resume" }));
    await waitFor(() => expect(screen.getByText(/Added "Data" with 2 skills\. Rescoring jobs in the background/)).toBeDefined());
    expect(bodyOf((c) => c.url.endsWith("/api/resumes") && c.init?.method === "POST")).toEqual({ content: "Python and SQL", label: "Data" });
  });

  it("sets a default and deletes with inline confirmation, surfacing server errors", async () => {
    mockApi((url, init) => {
      if (url.endsWith("/api/resumes/r2/default")) return reply({ resume: { ...resumes[1], isDefault: true } });
      if (url.endsWith("/api/resumes/r1") && init?.method === "DELETE") return reply({ error: "You need at least one resume." }, false, 409);
      return undefined;
    });
    render(<ProfileManager />);
    await waitFor(() => expect(screen.getAllByTestId("resume-item")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Set default" }));
    await waitFor(() => expect(screen.getByText(/"Frontend" is now your default resume/)).toBeDefined());

    const first = screen.getAllByTestId("resume-item")[0];
    fireEvent.click(within(first).getByRole("button", { name: "Delete" }));
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    fireEvent.click(within(screen.getAllByTestId("resume-item")[0]).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.getByText("You need at least one resume.")).toBeDefined());
  });

  it("edits a resume's label and skills", async () => {
    mockApi((url, init) =>
      url.endsWith("/api/resumes/r2") && init?.method === "PATCH"
        ? reply({ resume: { ...resumes[1], label: "Frontend v2", skills: [] }, rescore: { status: "done", rescored: 3, error: null } })
        : undefined
    );
    render(<ProfileManager />);
    await waitFor(() => expect(screen.getAllByTestId("resume-item")).toHaveLength(2));
    const second = screen.getAllByTestId("resume-item")[1];
    fireEvent.click(within(second).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(second).getByDisplayValue("Frontend"), { target: { value: "Frontend v2" } });
    fireEvent.click(within(second).getByRole("button", { name: "Remove React" }));
    fireEvent.click(within(second).getByRole("button", { name: "Save resume" }));
    await waitFor(() => expect(screen.getByText(/Saved "Frontend v2"\. Rescored 3 jobs\./)).toBeDefined());
    expect(bodyOf((c) => c.init?.method === "PATCH")).toEqual({ label: "Frontend v2", targetCategory: "frontend", skills: [] });
  });
});

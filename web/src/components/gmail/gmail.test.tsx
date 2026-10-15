import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DemoTools, SummaryPanel } from "./index";

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

describe("gmail components", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("DemoTools previews classification without storing and manages demo data", async () => {
    mockFetch((url, init) => {
      if (url.includes("/api/gmail/classify"))
        return reply({ classification: "ASSESSMENT", confidence: 0.93, importance: "HIGH", company: "Swiggy", deadline: "by Oct 20", suggestedAction: "Take it", explanation: "Invite" });
      if (url.includes("/api/gmail/demo") && init?.method === "POST") return reply({ created: 4 }, 201);
      if (url.includes("/api/gmail/demo") && init?.method === "DELETE") return reply({ deleted: 4 });
      return reply({});
    });
    const onChanged = vi.fn();
    render(<DemoTools demoCount={4} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText("Test subject"), { target: { value: "Swiggy assessment" } });
    fireEvent.click(screen.getByText("Classify (preview only)"));
    await waitFor(() => expect(screen.getByTestId("classify-preview").textContent).toContain("Assessment"));
    expect(screen.getByText("Deadline: by Oct 20")).toBeDefined();
    expect(calls[0].url).toContain("/api/gmail/classify");

    fireEvent.click(screen.getByText("Load demo events"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Added 4 demo event(s)"));
    fireEvent.click(screen.getByText("Clear demo data (4)"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Removed 4"));
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("SummaryPanel renders the AI summary when present and the empty state", () => {
    const base = { days: 7, totalEvents: 0, counts: {}, needsAction: [], statusChanges: [], newApplications: [], jobAlerts: { emails: 0, listingsAdded: 0 }, highlights: ["No job-search email in the last 7 days."], aiSummary: null };
    const { rerender } = render(<SummaryPanel summary={base} loading={false} error={null} />);
    expect(screen.getByText("No job-search email in the last 7 days.")).toBeDefined();
    expect(screen.getByText("Nothing waiting on you.")).toBeDefined();
    rerender(<SummaryPanel summary={{ ...base, aiSummary: "- One interview to schedule" }} loading={false} error={null} />);
    expect(screen.getByLabelText("AI summary").textContent).toBe("- One interview to schedule");
  });
});

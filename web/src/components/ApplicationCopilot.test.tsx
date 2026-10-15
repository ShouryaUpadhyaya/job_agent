import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import ApplicationCopilot from "./ApplicationCopilot";

const job = { id: "job-1", title: "Backend Intern", company: "Acme", url: "https://acme.example/jobs/1" };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ApplicationCopilot", () => {
  it("shows the drafted cover letter and never claims to submit", () => {
    render(<ApplicationCopilot job={job} initialCoverLetter="Dear Acme team," />);
    expect(screen.getByDisplayValue("Dear Acme team,")).toBeTruthy();
    expect(screen.queryByText(/Submitted Successfully/i)).toBeNull();
    expect(screen.getByText(/Nothing is sent from this page/)).toBeTruthy();
  });

  it("regenerates the letter from the server", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ body: "Fresh letter" }));
    render(<ApplicationCopilot job={job} />);
    fireEvent.click(screen.getByText("Generate from my resume"));
    await waitFor(() => expect(screen.getByDisplayValue("Fresh letter")).toBeTruthy());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/api/copilot/tailor-cover-letter");
    expect(JSON.parse(init.body).jobListingId).toBe("job-1");
  });

  it("records the application as applied, advancing an existing pipeline entry", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "app-1", duplicate: true, stage: "BOOKMARKED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "app-1", stage: "APPLIED" }));
    const onApplied = vi.fn();
    render(<ApplicationCopilot job={job} onApplied={onApplied} />);

    fireEvent.click(screen.getByText(/mark as applied/));
    await waitFor(() => expect(screen.getByText("Marked as applied")).toBeTruthy());
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(onApplied).toHaveBeenCalled();
  });

  it("shows server errors inline", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ error: "Job listing not found" }, 404));
    render(<ApplicationCopilot job={job} />);
    fireEvent.click(screen.getByText("Generate from my resume"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Job listing not found"));
  });
});

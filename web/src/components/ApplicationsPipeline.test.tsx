import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import ApplicationsPipeline from "./ApplicationsPipeline";

const mockApplications = [
  {
    id: "app-1",
    jobListingId: "job-1",
    stage: "BOOKMARKED",
    status: "DRAFT",
    isApproved: false,
    notes: "Follow up next week",
    createdAt: new Date().toISOString(),
    jobListing: {
      title: "Backend Engineering Intern",
      company: "Stripe",
      url: "https://stripe.com/jobs/1",
      location: "Remote",
    },
  },
  {
    id: "app-2",
    jobListingId: "job-2",
    stage: "APPLIED",
    status: "SUBMITTED",
    isApproved: true,
    createdAt: new Date().toISOString(),
    jobListing: {
      title: "Full Stack Intern",
      company: "Linear",
      url: "https://linear.app/careers/2",
      location: "San Francisco, CA",
    },
  },
];

describe("ApplicationsPipeline Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders pipeline list and application cards", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockApplications,
    });

    render(<ApplicationsPipeline />);

    await waitFor(() => {
      expect(screen.getByText("Backend Engineering Intern")).toBeDefined();
      expect(screen.getByText("Full Stack Intern")).toBeDefined();
    });

    expect(screen.getByText(/Follow up next week/i)).toBeDefined();
    expect(screen.getByText("Stripe • Remote")).toBeDefined();
  });

  it("handles stage update through select dropdown", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockApplications,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockApplications[0], stage: "INTERVIEWING" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { ...mockApplications[0], stage: "INTERVIEWING" },
          mockApplications[1],
        ],
      });

    render(<ApplicationsPipeline />);

    await waitFor(() => {
      expect(screen.getByText("Backend Engineering Intern")).toBeDefined();
    });

    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "INTERVIEWING" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/applications/app-1"),
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  it("renders empty state when no applications are tracked", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<ApplicationsPipeline />);

    await waitFor(() => {
      expect(screen.getByText("No Applications Tracked Yet")).toBeDefined();
    });
  });
});

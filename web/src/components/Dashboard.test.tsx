import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Dashboard from "./Dashboard";

const mockJobs = [
  {
    id: "1",
    title: "Frontend Engineer",
    company: "TechCorp",
    location: "Remote",
    description: "Build awesome UIs.",
    score: 85,
    status: "APPLY",
    url: "https://techcorp.test/jobs/1",
    matchedSkills: ["React", "TypeScript"],
  },
  {
    id: "2",
    title: "Backend Engineer",
    company: "DataCo",
    location: "New York, NY",
    description: "Build awesome APIs.",
    score: 30,
    status: "REVIEW",
    url: "https://dataco.test/jobs/2",
    matchedSkills: ["Node.js"],
  },
];

describe("Dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  
  afterEach(() => {
    cleanup();
  });

  it("renders loading state initially", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<Dashboard />);
    expect(screen.getByTestId("loading-state")).toBeDefined();
  });

  it("renders error state on fetch failure", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("API Error"))) as unknown as typeof fetch;
    render(<Dashboard />);
    
    await waitFor(() => {
      expect(screen.getByTestId("error-state")).toBeDefined();
    });
    expect(screen.getByText("API Error")).toBeDefined();
  });

  it("renders empty state when no jobs are returned", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })
    ) as unknown as typeof fetch;
    render(<Dashboard />);
    
    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeDefined();
    });
  });

  it("renders jobs and handles selection", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockJobs),
      })
    ) as unknown as typeof fetch;
    
    render(<Dashboard />);
    
    // Wait for jobs to render
    await waitFor(() => {
      expect(screen.getByTestId("job-item-1")).toBeDefined();
      expect(screen.getByTestId("job-item-2")).toBeDefined();
    });

    // Initial state: no job selected
    expect(screen.getByText("Select a job to view details")).toBeDefined();

    // Click on a job
    fireEvent.click(screen.getByTestId("job-item-1"));

    // Check if details are shown
    expect(screen.getByTestId("job-details")).toBeDefined();
    expect(screen.getAllByRole("heading", { name: "Frontend Engineer" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Build awesome UIs.")).toBeDefined();
    expect(screen.getByText("✓ React")).toBeDefined();
  });

  it("filters jobs by search input", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockJobs),
      })
    ) as unknown as typeof fetch;

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("job-item-1")).toBeDefined();
      expect(screen.getByTestId("job-item-2")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText("Search title, company, or tech...");
    fireEvent.change(searchInput, { target: { value: "DataCo" } });

    expect(screen.queryByTestId("job-item-1")).toBeNull();
    expect(screen.getByTestId("job-item-2")).toBeDefined();
  });

  it("handles manual sync trigger", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockJobs,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: "Synchronization completed.",
          summary: { totalNew: 5, totalUpdated: 2 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockJobs,
      });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("job-item-1")).toBeDefined();
    });

    const syncButton = screen.getByRole("button", { name: /Sync Jobs/i });
    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(screen.getByText(/Sync complete: 5 new, 2 updated/i)).toBeDefined();
    });
  });
});

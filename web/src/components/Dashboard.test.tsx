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
  },
  {
    id: "2",
    title: "Backend Engineer",
    company: "DataCo",
    location: "New York, NY",
    description: "Build awesome APIs.",
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
  });
});

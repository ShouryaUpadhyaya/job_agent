import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WellfoundAutoApplyManager from "./WellfoundAutoApplyManager";

// Mock fetch
const mockConfig = {
  env: {
    NAME: "Shourya Upadhyaya",
    EMAIL: "shouryaupadhyaya26@gmail.com",
    PHONE: "+91 9411594412",
    LOCATION: "Vellore, Tamil Nadu, India",
    CURRENT_ROLE: "Full-Stack Developer",
    COMPANY: "Moss X",
    SKILLS: "JavaScript, TypeScript, React.js, Node.js",
    HIGHLIGHTS: "Built OpenPumTa",
    GEMINI_KEY: "test-key",
  },
  dailyState: { date: "Tue Oct 13 2026", count: 12 },
  totalCsvApplications: 14,
  runnerState: {
    isRunning: false,
    mode: null,
    visible: false,
    max: 5,
    startedAt: null,
    logTail: ["[11:13:08] Auto-apply started"],
  },
};

const mockApplications = {
  applications: [
    {
      date: "10/13/2026, 11:13:08 AM",
      site: "wellfound",
      role: "SDE Intern",
      company: "Certa",
      salary: "₹25,000 – ₹30,000",
      skills: "Node.js; React",
      link: "https://wellfound.com/jobs/3263581-sde-intern",
    },
    {
      date: "10/13/2026, 11:16:50 AM",
      site: "wellfound",
      role: "Full Stack Developer Intern",
      company: "The Date Crew",
      salary: "₹2.4 LPA",
      skills: "React; Node.js",
      link: "https://wellfound.com/jobs/4824501-full-stack-developer-intern",
    },
  ],
};

describe("WellfoundAutoApplyManager Component", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/wellfound/config")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockConfig),
        });
      }
      if (url.includes("/api/wellfound/applications")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockApplications),
        });
      }
      if (url.includes("/api/wellfound/sync-database")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: { totalRows: 2, newImported: 2, alreadyTracked: 0, contactsCreated: 4 },
            }),
        });
      }
      if (url.includes("/api/wellfound/run")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, pid: 12345 }),
        });
      }
      if (url.includes("/api/wellfound/script")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve("// generated test zen script"),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it("renders metric cards and applications list", async () => {
    render(<WellfoundAutoApplyManager />);

    const title = await screen.findByText("Wellfound AutoApply Control Center");
    expect(title).toBeDefined();
    expect(screen.getByText("SDE Intern")).toBeDefined();
    expect(screen.getByText("Full Stack Developer Intern")).toBeDefined();
    expect(screen.getByText("Certa")).toBeDefined();
  });

  it("allows switching sub-tabs to Runner controls and Zen script", async () => {
    render(<WellfoundAutoApplyManager />);

    await screen.findByText("Wellfound AutoApply Control Center");

    // Click Runner tab
    fireEvent.click(screen.getByText(/Automation Runner & Live Logs/i));
    expect(screen.getByText("Playwright Runner Execution Options")).toBeDefined();
    expect(screen.getByText(/Dry Run \(Safe Test\)/i)).toBeDefined();
    expect(screen.getByText(/Live \(Submit\)/i)).toBeDefined();

    // Click Zen Script tab
    fireEvent.click(screen.getByText(/Zen Browser Console Script/i));
    const scriptHeader = await screen.findByText("Zen / Firefox Browser Injected Script");
    expect(scriptHeader).toBeDefined();
  });

  it("triggers database sync when clicking Sync to App Database", async () => {
    render(<WellfoundAutoApplyManager />);

    await screen.findByText("Wellfound AutoApply Control Center");

    const syncBtn = screen.getByText("📥 Sync to App Database");
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(screen.getByText(/Synced 2 applications to Database/i)).toBeDefined();
    });
  });
});

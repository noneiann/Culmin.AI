import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        connected: false,
        googleConfigured: false,
        aiConfigured: false,
      }),
    }),
  );
});

describe("Culmin workspace", () => {
  it("filters jobs and persists bookmark changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /All jobs/ }));
    await user.type(screen.getByRole("textbox", { name: "Filter jobs" }), "Linear");
    expect(screen.getByRole("button", { name: "Product Engineer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Frontend Engineer" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unsave Product Engineer" }));
    expect(JSON.parse(localStorage.getItem("culmin:demo:saved")!)).toEqual(["demo-4"]);
    await user.click(screen.getByRole("button", { name: "Saved jobs" }));
    expect(screen.getByRole("button", { name: "Design Engineer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Product Engineer" })).not.toBeInTheDocument();
  });
  it("creates a local draft from a job without calling Gmail", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Product Engineer" }));
    await user.click(screen.getByRole("button", { name: "Draft an email" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("To"), "recruiter@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Save demo draft" }));
    expect(await screen.findByText("LOCAL DEMO DRAFT")).toBeVisible();
    expect(JSON.parse(localStorage.getItem("culmin:demo:drafts")!)[0].to).toBe(
      "recruiter@example.com",
    );
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/status")).toBe(true);
  });
  it("adds and removes local calendar events", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    await user.click(screen.getByRole("button", { name: "Add event" }));
    await user.type(screen.getByLabelText("Event title"), "Technical interview");
    await user.click(screen.getByRole("button", { name: "Add to planner" }));
    expect(JSON.parse(localStorage.getItem("culmin:demo:events")!)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Delete Technical interview" }));
    expect(JSON.parse(localStorage.getItem("culmin:demo:events")!)).toHaveLength(0);
  });
  it("labels demo chat and filters remote sample roles", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Find remote engineering roles/ }));
    expect(await screen.findByText(/I’ve filtered the sample opportunities/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product Engineer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Design Engineer" })).not.toBeInTheDocument();
    expect(screen.getByText("Demo responses · Connect Gmail to get started.")).toBeVisible();
  });
  it("uses authenticated Gmail search without mixing in demo jobs", async () => {
    const user = userEvent.setup();
    const job = {
      id: "abcd",
      title: "New engineering roles",
      company: "Alerts",
      description: "Remote roles",
      date: String(Date.now()),
      sourceUrl: "https://mail.google.com/mail/u/0/#all/abcd",
      location: "",
      salary: "",
      tags: ["Gmail alert"],
    };
    let searched = false;
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      let data: unknown;
      if (url === "/api/status")
        data = {
          connected: true,
          email: "user@example.com",
          googleConfigured: true,
          aiConfigured: true,
        };
      else if (url === "/api/drafts") data = { drafts: [] };
      else if (url === "/api/tools") {
        expect(JSON.parse(options?.body as string).name).toBe("search_jobs");
        searched = true;
        data = { jobs: [job], failed: 0, hasMore: false };
      } else data = { jobs: searched ? [job] : [] };
      return { ok: true, json: async () => data } as Response;
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Product Engineer" })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Refresh jobs" }));
    expect(await screen.findByRole("button", { name: "New engineering roles" })).toBeVisible();
    expect(
      screen.queryByText("Sample data · Connect Gmail to make this yours"),
    ).not.toBeInTheDocument();
  });
});

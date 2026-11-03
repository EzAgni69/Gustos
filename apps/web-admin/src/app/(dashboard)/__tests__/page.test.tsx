/**
 * Integration test: DashboardOverviewPage — viewMode is not reset by real-time events
 *
 * Validates: Requirements 9.1
 *
 * Requirement 9.1: WHEN a real-time event of type ORDER_COMPLETED (or related order events)
 * is received, THE Dashboard SHALL re-fetch all order data and recompute KPI values and
 * chart data for the currently selected View Mode WITHOUT resetting View Mode.
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock next/navigation ──────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ─── Mock next/link ────────────────────────────────────────────────────────
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("a", { href, ...props }, children),
}));

// ─── Capture the subscribe callback registry ───────────────────────────────
// When useRealtimeEvent registers listeners, we want to be able to fire them
// from our tests to simulate an incoming ORDER_COMPLETED event.
type SyncData = { eventType: string; payload: unknown };
type Listener = (data: SyncData) => void;
const listenerRegistry = new Map<string, Set<Listener>>();

vi.mock("@/lib/socket-context", () => ({
  useRealtimeSocket: () => ({
    socket: null,
    isConnected: false,
    lastSyncEvent: null,
    currentOutletId: null,
    setOutletId: vi.fn(),
    subscribe: (eventType: string, cb: Listener) => {
      if (!listenerRegistry.has(eventType)) {
        listenerRegistry.set(eventType, new Set());
      }
      listenerRegistry.get(eventType)!.add(cb);
      return () => {
        listenerRegistry.get(eventType)?.delete(cb);
      };
    },
  }),
  useRealtimeEvent: (
    events: string | string[],
    callback: (data: SyncData) => void
  ) => {
    // Register for each event type synchronously (mimics the real hook's useEffect behavior)
    const eventList = Array.isArray(events) ? events : [events];
    for (const ev of eventList) {
      if (!listenerRegistry.has(ev)) {
        listenerRegistry.set(ev, new Set());
      }
      listenerRegistry.get(ev)!.add(callback);
    }
  },
  SocketProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// ─── Mock api-client ───────────────────────────────────────────────────────
vi.mock("@/lib/api-client", () => ({
  apiFetch: vi.fn().mockResolvedValue({ success: false }),
}));

// ─── Mock toast ────────────────────────────────────────────────────────────
vi.mock("@/lib/toast", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

// ─── Mock outlet-context (localStorage-backed) ────────────────────────────
vi.mock("@/lib/outlet-context", () => ({
  getPersistedOutletId: () => null,
  setPersistedOutletId: vi.fn(),
}));

// ─── Import component after mocks ─────────────────────────────────────────
import DashboardOverviewPage from "../page";
import { apiFetch } from "@/lib/api-client";

// ─── Helper: fire a mock realtime event ───────────────────────────────────
function fireRealtimeEvent(eventType: string) {
  const listeners = listenerRegistry.get(eventType);
  if (listeners) {
    for (const cb of listeners) {
      cb({ eventType, payload: {} });
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("DashboardOverviewPage — viewMode stability under real-time events", () => {
  beforeEach(() => {
    listenerRegistry.clear();
    vi.clearAllMocks();
    // Default: all API calls return empty-success so the component renders fully
    vi.mocked(apiFetch).mockResolvedValue({ success: true, data: [] });
  });

  it("does NOT call setViewMode inside the useRealtimeEvent callback — only loadDashboardData", async () => {
    // This is a static verification: we inspect the page source
    // The useRealtimeEvent callback in page.tsx is:
    //   () => { loadDashboardData(); }
    // It does NOT contain setViewMode.
    //
    // We confirm this by rendering the component, switching to Weekly, firing an ORDER_COMPLETED
    // event, and checking that viewMode is still "Weekly" (the Weekly button still has active styles).

    render(<DashboardOverviewPage />);

    // Wait for initial load to settle
    await waitFor(() => {
      expect(screen.getByText("Daily")).toBeInTheDocument();
      expect(screen.getByText("Weekly")).toBeInTheDocument();
    });

    // The default viewMode is "Daily" — the "Daily" button has active styles (bg-white shadow-sm)
    // and the "Weekly" button does not.
    const dailyButton = screen.getByRole("button", { name: "Daily" });
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });

    expect(dailyButton.className).toContain("bg-white");
    expect(weeklyButton.className).not.toContain("bg-white");

    // Switch to Weekly
    await act(async () => {
      fireEvent.click(weeklyButton);
    });

    // Weekly button should now have active styles
    expect(weeklyButton.className).toContain("bg-white");
    expect(dailyButton.className).not.toContain("bg-white");

    // Fire an ORDER_COMPLETED real-time event (simulates POS sync arriving)
    await act(async () => {
      fireRealtimeEvent("ORDER_COMPLETED");
      // allow any async state updates (loadDashboardData) to complete
      await Promise.resolve();
    });

    // viewMode must still be "Weekly" — the Weekly button must still have active styles
    expect(weeklyButton.className).toContain("bg-white");
    expect(dailyButton.className).not.toContain("bg-white");
  });

  it("keeps viewMode as Daily after ORDER_CREATED event when Daily is selected", async () => {
    render(<DashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Daily")).toBeInTheDocument();
    });

    const dailyButton = screen.getByRole("button", { name: "Daily" });
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });

    // Default is Daily — verify active state
    expect(dailyButton.className).toContain("bg-white");

    // Fire ORDER_CREATED event without switching mode
    await act(async () => {
      fireRealtimeEvent("ORDER_CREATED");
      await Promise.resolve();
    });

    // viewMode should still be Daily
    expect(dailyButton.className).toContain("bg-white");
    expect(weeklyButton.className).not.toContain("bg-white");
  });

  it("loadDashboardData is called by the real-time event (data refresh happens)", async () => {
    render(<DashboardOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Daily")).toBeInTheDocument();
    });

    // Clear the mock call count after initial mount (which calls loadDashboardData once)
    vi.mocked(apiFetch).mockClear();

    // Fire ORDER_COMPLETED
    await act(async () => {
      fireRealtimeEvent("ORDER_COMPLETED");
      await Promise.resolve();
    });

    // apiFetch should have been called again (loadDashboardData re-fetches)
    expect(vi.mocked(apiFetch)).toHaveBeenCalled();
  });
});

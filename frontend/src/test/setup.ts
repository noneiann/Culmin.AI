import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  configurable: true,
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

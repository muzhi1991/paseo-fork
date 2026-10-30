import { afterEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { MermaidIframeRuntime } from "./iframe-runtime.web";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const request = { revision: 1, source: "graph TD; A-->B", colorScheme: "light" } as const;
const next = { ...request, revision: 2, source: "graph TD; A-->C" };
afterEach(() => {
  root?.unmount();
  container?.remove();
});

it("loads the renderer on demand and preserves the queued request handshake", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const rendered = vi.fn();
  const failed = vi.fn();
  flushSync(() =>
    root?.render(
      <MermaidIframeRuntime request={null} onRendered={rendered} onRenderFailed={failed} />,
    ),
  );
  expect(container.querySelector("iframe")).toBeNull();
  root.render(
    <MermaidIframeRuntime request={request} onRendered={rendered} onRenderFailed={failed} />,
  );
  await expect.poll(() => rendered.mock.calls.length, { timeout: 10000 }).toBe(1);
  expect(rendered.mock.calls[0][0]).toMatchObject(request);
  expect(rendered.mock.calls[0][0].height).toBeGreaterThan(0);
  expect(failed).not.toHaveBeenCalled();
  root.render(
    <MermaidIframeRuntime request={next} onRendered={rendered} onRenderFailed={failed} />,
  );
  await expect.poll(() => rendered.mock.calls.length, { timeout: 10000 }).toBe(2);
  expect(rendered.mock.calls[1][0]).toMatchObject(next);
  expect(failed).not.toHaveBeenCalled();
});

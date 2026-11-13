/// <reference types="bun-types" />
/**
 * Unit tests pinning the desktop (Tauri 2) build invariants: the Tauri config
 * shape, the export-mode web build path, icon files, and the CI workflow that
 * produces the Linux artifacts. These read real files from the repo so the
 * configs cannot silently drift.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const readJson = (p: string) => JSON.parse(read(p));

describe("tauri.conf.json", () => {
  const conf = readJson("src-tauri/tauri.conf.json");

  it("uses the InfiniteNote identifier and schema v2", () => {
    expect(conf.identifier).toBe("com.infinitenote.app");
    expect(conf["$schema"]).toBe("https://schema.tauri.app/config/2");
    expect(conf.productName).toBe("InfiniteNote");
  });

  it("builds the web UI via build:desktop and serves ../out", () => {
    expect(conf.build.beforeBuildCommand).toBe("bun run build:desktop");
    expect(conf.build.frontendDist).toBe("../out");
    expect(conf.build.beforeDevCommand).toBe("bun run dev:e2e");
    expect(conf.build.devUrl).toBe("http://localhost:3000");
  });

  it("bundles Linux targets with real icon files", () => {
    expect(conf.bundle.active).toBe(true);
    for (const target of ["deb", "rpm", "appimage"]) {
      expect(conf.bundle.targets).toContain(target);
    }
    for (const icon of conf.bundle.icon) {
      expect(existsSync(join(ROOT, "src-tauri", icon)), `missing icon ${icon}`).toBe(true);
    }
  });

  it("tracks the app version like package.json", () => {
    const pkg = readJson("package.json");
    expect(conf.version).toBe(pkg.version);
  });
});

describe("desktop CSP (issue #207)", () => {
  // The exact policy shipped in tauri.conf.json, derived from the measured
  // request inventory in e2e/csp-inventory.spec.ts and documented
  // directive-by-directive in docs/desktop.md ("Desktop CSP"). These tests
  // pin the SHAPE of the policy: drift in either direction (weakening or
  // breaking the app) must fail here first.
  const conf = readJson("src-tauri/tauri.conf.json");
  const csp = conf.app?.security?.csp as string | undefined;

  it("ships a non-null CSP string", () => {
    expect(typeof csp).toBe("string");
    expect(csp!.length).toBeGreaterThan(0);
  });

  /** Parse "a b c; d e" into { a: ["b","c"], d: ["e"] } (quoted tokens kept). */
  function directives(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const part of csp!.split(";")) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      map.set(tokens[0], tokens.slice(1));
    }
    return map;
  }

  it("has exactly the expected directive set", () => {
    expect([...directives().keys()].sort()).toEqual(
      [
        "base-uri",
        "connect-src",
        "default-src",
        "font-src",
        "form-action",
        "img-src",
        "media-src",
        "object-src",
        "script-src",
        "style-src",
        "worker-src",
      ].sort(),
    );
  });

  it("keeps every directive origin-restricted (no remote hosts)", () => {
    for (const [name, values] of directives()) {
      for (const v of values) {
        const remote =
          /^https?:\/\//.test(v) && v !== "http://ipc.localhost" // Tauri v2 local IPC endpoint
          ;
        expect(remote, `directive ${name} must not allow remote origin ${v}`).toBe(false);
      }
    }
  });

  it("never allows runtime code compilation (no unsafe-eval)", () => {
    // the HWR bundle import was refactored away from `new Function`
    // precisely so this token is unnecessary
    for (const values of directives().values()) {
      expect(values).not.toContain("'unsafe-eval'");
    }
    expect(read("src/lib/hwr-client.ts")).not.toContain("new Function");
  });

  it("allows wasm compilation only via wasm-unsafe-eval in script-src", () => {
    const script = directives().get("script-src")!;
    expect(script).toContain("'wasm-unsafe-eval'"); // ORT + tesseract wasm
    expect(script).toContain("'self'");
    expect(script).toContain("blob:"); // the HWR bundle module import
  });

  it("allows inline bootstrap payloads only where the build needs them", () => {
    // Next's static export ships inline script payloads (the RSC flight
    // data bootstrap) — measured in the exported HTML; Tauri hashes its
    // own injected init scripts on top. Styles are inline everywhere
    // (React style attributes + Excalidraw's injected <style>). Scripts
    // outside these classes stay blocked (no remote, no eval).
    expect(directives().get("script-src")).toContain("'unsafe-inline'");
    expect(directives().get("style-src")).toContain("'unsafe-inline'");
  });

  it("covers the vendored engines' worker and fetch surfaces", () => {
    expect(directives().get("worker-src")).toEqual(["'self'", "blob:"]);
    const connect = directives().get("connect-src")!;
    expect(connect).toContain("'self'");
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost"); // Tauri v2 IPC
  });

  it("locks down the passive surfaces", () => {
    expect(directives().get("object-src")).toEqual(["'none'"]);
    expect(directives().get("base-uri")).toEqual(["'self'"]);
    expect(directives().get("form-action")).toEqual(["'none'"]);
    expect(directives().get("default-src")).toEqual(["'self'"]);
    // audio clips play from data:audio payloads (audioPayloadOf), the
    // recorder may hand the player a blob:; images come from scenes as
    // data: URLs and previews as blob: URLs
    expect(directives().get("media-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directives().get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directives().get("font-src")).toEqual(["'self'", "data:"]);
  });
});

describe("desktop build path", () => {
  it("exposes build:desktop and the tauri CLI script", () => {
    const pkg = readJson("package.json");
    // --webpack pinned: Turbopack's postcss worker IPC deadline elapsed
    // deterministically on slower CI runners (2026-11-11) — the desktop
    // export build shares the webpack compiler (fix/webpack-ci-build)
    expect(pkg.scripts["build:desktop"]).toBe("NEXT_OUTPUT_MODE=export next build --webpack");
    expect(pkg.scripts.tauri).toContain("@tauri-apps/cli");
  });

  it("gates static export behind NEXT_OUTPUT_MODE in next.config.ts", () => {
    const conf = read("next.config.ts");
    expect(conf).toContain('process.env.NEXT_OUTPUT_MODE === "export"');
    expect(conf).toContain('"export" : "standalone"');
    expect(conf).toContain("unoptimized");
  });

  it("keeps Cargo.toml metadata aligned with the bundle", () => {
    const cargo = read("src-tauri/Cargo.toml");
    expect(cargo).toContain('name = "infinitenote"');
    expect(cargo).toContain('tauri = { version = "2"');
    expect(cargo).toContain('tauri-build = { version = "2"');
    expect(cargo).toContain("edition = \"2021\"");
  });

  it("declares a default capability for the main window", () => {
    const cap = readJson("src-tauri/capabilities/default.json");
    expect(cap.windows).toEqual(["main"]);
    expect(cap.permissions).toContain("core:default");
  });
});

describe("desktop CI workflow", () => {
  const workflow = read(".github/workflows/desktop.yml");

  it("builds bundles and attaches them to tagged releases", () => {
    expect(workflow).toContain("bun run tauri build");
    expect(workflow).toContain("libwebkit2gtk-4.1-dev");
    expect(workflow).toContain("softprops/action-gh-release");
    expect(workflow).toContain("refs/tags/v");
  });

  it("does not run on pull_request (not a required check)", () => {
    const onBlock = workflow.split("jobs:")[0];
    expect(onBlock).not.toContain("pull_request");
  });

  // Issue #164: linuxdeploy copies the runner's webkit2gtk/glib into the
  // AppImage, so an ubuntu-latest build silently required GLIBC_2.42/2.43 and
  // failed to launch on every current LTS distro. The runner must stay pinned
  // to the oldest supported LTS image.
  it("builds on a pinned LTS runner, never ubuntu-latest (issue #164)", () => {
    expect(workflow).toContain("runs-on: ubuntu-22.04");
    expect(workflow).not.toContain("runs-on: ubuntu-latest");
  });

  it("triggers on pushes to main (pin: the filter was always correct on disk — an output-display artifact made it look corrupted)", () => {
    expect(workflow).toContain("branches: [main]");
  });

  it("enforces the AppImage glibc floor after the build (issue #164)", () => {
    expect(workflow).toContain('GLIBC_FLOOR: "2.35"');
    expect(workflow).toContain("--appimage-extract");
    expect(workflow).toContain("Enforce the AppImage glibc floor");
  });
});

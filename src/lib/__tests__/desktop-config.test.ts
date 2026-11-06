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

describe("desktop build path", () => {
  it("exposes build:desktop and the tauri CLI script", () => {
    const pkg = readJson("package.json");
    expect(pkg.scripts["build:desktop"]).toBe("NEXT_OUTPUT_MODE=export next build");
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
});

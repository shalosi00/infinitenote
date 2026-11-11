/// <reference types="bun-types" />
/**
 * Unit tests pinning the Flatpak packaging invariants: AppStream metainfo
 * shape, the flatpak-builder manifest (extra-data pinning contract), the
 * .desktop launcher, and the extradata tool.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Minimal XML well-formedness check: balanced, properly nested tags. */
function assertXmlWellFormed(xml: string): void {
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9._-]*)(?:\s[^<>]*?)?(\/?)>/g;
  // Strip comments and the XML prolog first.
  const src = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src)) !== null) {
    const [full, name, selfClose] = m;
    if (selfClose === "/") continue;
    if (full.startsWith("</")) {
      const top = stack.pop();
      expect(top, `closing </${name}> but open tag is <${top ?? "none"}>`).toBe(name);
    } else {
      stack.push(name);
    }
  }
  expect(stack, `unclosed tags: ${stack.join(", ")}`).toEqual([]);
}

describe("com.infinitenote.app.metainfo.xml", () => {
  const xml = read("packaging/flatpak/com.infinitenote.app.metainfo.xml");

  it("is well-formed XML", () => {
    assertXmlWellFormed(xml);
  });

  it("declares the desktop application with MIT licensing", () => {
    expect(xml).toContain('<component type="desktop-application">');
    expect(xml).toContain("<id>com.infinitenote.app</id>");
    expect(xml).toContain("<project_license>MIT</project_license>");
    expect(xml).toContain("<metadata_license>CC0-1.0</metadata_license>");
    expect(xml).toContain('<launchable type="desktop-id">com.infinitenote.app.desktop</launchable>');
  });

  it("lists releases for every shipped version", () => {
    expect(xml).toContain('release version="1.6.0"');
    expect(xml).toContain('release version="1.5.0"');
    expect(xml).toContain('release version="1.4.0"');
    expect(xml).toContain('release version="1.3.0"');
    expect(xml).toContain('<content_rating type="oars-1.1" />');
  });

  it("references only real repo assets in screenshots", () => {
    for (const shot of ["hero-light.png", "hero-dark.png", "mobile.png"]) {
      expect(xml).toContain(
        `https://raw.githubusercontent.com/shalosi00/infinitenote/main/assets/screenshots/${shot}`,
      );
      expect(statSync(join(ROOT, "assets/screenshots", shot)).size).toBeGreaterThan(0);
    }
  });

  it("carries the AppStream-required metadata", () => {
    expect(xml).toContain("<summary>Local-first OneNote-style notebook with an infinite canvas</summary>");
    expect(xml).toContain("<developer_name");
    expect(xml).toContain("<binary>infinitenote</binary>");
    expect(xml).toContain("<category>NoteTaking</category>");
    expect(xml).toContain("#7c3aed");
  });
});

describe("com.infinitenote.app.json (flatpak-builder manifest)", () => {
  const manifest = JSON.parse(read("packaging/flatpak/com.infinitenote.app.json"));
  const extra = manifest.modules[0].sources.find((s: { type: string }) => s.type === "extra-data");

  it("targets the freedesktop runtime with the right id and command", () => {
    expect(manifest.id).toBe("com.infinitenote.app");
    expect(manifest.runtime).toBe("org.freedesktop.Platform");
    expect(manifest.sdk).toBe("org.freedesktop.Sdk");
    expect(manifest.command).toBe("infinitenote");
    expect(manifest["finish-args"]).toContain("--socket=wayland");
    expect(manifest["finish-args"]).toContain("--socket=fallback-x11");
    expect(manifest["finish-args"]).toContain("--share=network");
    expect(manifest["finish-args"]).toContain("--filesystem=home");
  });

  it("ships the release AppImage via extra-data with the pinning contract", () => {
    expect(extra.type).toBe("extra-data");
    expect(extra.filename).toBe("InfiniteNote.AppImage");
    expect(extra.url).toMatch(
      /^https:\/\/github\.com\/shalosi00\/infinitenote\/releases\/download\/v\d+\.\d+\.\d+\/[A-Za-z0-9._-]+\.AppImage$/,
    );
    // Either fully pinned by scripts/flatpak-extradata.mjs, or untouched.
    const pinned = extra.sha256 !== "" && extra.size > 0;
    if (pinned) {
      expect(extra.sha256).toMatch(/^[0-9a-f]{64}$/);
    } else {
      expect(extra.sha256).toBe("");
      expect(extra.size).toBe(0);
    }
  });

  it("installs launcher, desktop file, metainfo and icons", () => {
    const cmds: string[] = manifest.modules[0]["build-commands"];
    expect(cmds.join("\n")).toContain("${FLATPAK_DEST}/bin/infinitenote");
    expect(cmds.join("\n")).toContain("share/applications/com.infinitenote.app.desktop");
    expect(cmds.join("\n")).toContain("share/metainfo/com.infinitenote.app.metainfo.xml");
    expect(cmds.join("\n")).toContain("share/icons/hicolor/512x512/apps/com.infinitenote.app.png");
    expect(cmds.join("\n")).toContain("share/icons/hicolor/scalable/apps/com.infinitenote.app.svg");
  });

  it("references source files that exist next to the manifest", () => {
    for (const src of manifest.modules[0].sources) {
      if (src.type === "file") {
        expect(statSync(join(ROOT, "packaging/flatpak", src.path)).size).toBeGreaterThan(0);
      }
    }
  });
});

describe("desktop launcher + wrapper + extradata tool", () => {
  const desktop = read("packaging/flatpak/com.infinitenote.app.desktop");

  it("is a valid desktop entry pointing at the wrapper command", () => {
    expect(desktop).toContain("Exec=infinitenote");
    expect(desktop).toContain("Icon=com.infinitenote.app");
    expect(desktop).toContain("Categories=NoteTaking;Productivity;Education;");
    expect(desktop).toContain("Type=Application");
  });

  it("wrapper extracts and runs the AppImage (no FUSE in the sandbox)", () => {
    const wrapper = read("packaging/flatpak/infinitenote-wrapper.sh");
    expect(wrapper).toContain("#!/bin/sh");
    expect(wrapper).toContain("/app/extra/InfiniteNote.AppImage");
    expect(wrapper).toContain("--appimage-extract-and-run");
  });

  it("extradata tool fetches the release asset and pins url/sha256/size", () => {
    const tool = read("scripts/flatpak-extradata.mjs");
    expect(tool).toContain("releases/tags/");
    expect(tool).toContain("createHash");
    expect(tool).toContain("extra.sha256");
    expect(tool).toContain("extra.size");
    expect(tool).toContain("extra.url");
    expect(tool).toContain(".AppImage");
    expect(tool).toContain("--check");
  });
});

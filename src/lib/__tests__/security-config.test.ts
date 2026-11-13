/// <reference types="bun-types" />
/**
 * Unit tests pinning the web app's baseline security headers (next.config.ts)
 * and the absence of the dead template auth/validation dependency chain.
 *
 * Context (security audit, 2026-11-13): the app is fully local-first — no
 * server DB, no auth. next-auth (1 CRITICAL CVE-2026-73420 + 1 HIGH) and
 * zod/@hookform/resolvers/react-hook-form (the unused form-tooling chain
 * around the unreferenced src/components/ui/form.tsx) were dead weight from
 * the original template and were removed; these tests keep them out.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("next.config.ts security headers", () => {
  const cfg = read("next.config.ts");

  it("sends X-Content-Type-Options: nosniff", () => {
    expect(cfg).toContain('"X-Content-Type-Options"');
    expect(cfg).toContain('"nosniff"');
  });

  it("forbids framing (X-Frame-Options: DENY)", () => {
    expect(cfg).toContain('"X-Frame-Options"');
    expect(cfg).toContain('"DENY"');
  });

  it("sets a Referrer-Policy", () => {
    expect(cfg).toContain('"Referrer-Policy"');
  });

  it("locks Permissions-Policy down to the features the app uses", () => {
    expect(cfg).toContain('"Permissions-Policy"');
    // the audio note recorder needs the microphone — nothing else
    expect(cfg).toContain("camera=()");
    expect(cfg).toContain("geolocation=()");
    expect(cfg).toContain("microphone=(self)");
  });

  it("serves headers on every path", () => {
    expect(cfg).toContain('source: "/:path*"');
  });

  it("keeps the desktop static export header-free (Tauri webview governs itself)", () => {
    expect(cfg).toContain("if (isDesktopExport) return [];");
  });
});

describe("dead template dependency chain stays out", () => {
  const pkg = read("package.json");

  it("has no auth libraries (local-first app: no auth surface)", () => {
    expect(pkg).not.toContain('"next-auth"');
  });

  it("has no unused form-validation chain (form.tsx was unreferenced)", () => {
    expect(pkg).not.toContain('"zod"');
    expect(pkg).not.toContain('"@hookform/resolvers"');
    expect(pkg).not.toContain('"react-hook-form"');
  });

  it("no source file imports the removed chain", () => {
    // scan tracked src/ files for any import of the removed packages
    const banned = /from\s+["'](zod|@hookform\/resolvers|react-hook-form|next-auth)["'\/]/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry)) {
          const text = readFileSync(p, "utf8");
          if (banned.test(text)) offenders.push(p);
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});

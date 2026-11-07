/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { classifyFile } from "../excalidraw-utils";

const mkFile = (name: string, type: string): File => new File(["x"], name, { type });

describe("classifyFile — structured import kinds", () => {
  it("classifies Word documents", () => {
    expect(classifyFile(mkFile("notes.docx", ""))).toBe("docx");
    expect(classifyFile(mkFile("NOTES.DOCX", ""))).toBe("docx");
  });

  it("classifies HTML pages by extension and mime", () => {
    expect(classifyFile(mkFile("page.html", ""))).toBe("html");
    expect(classifyFile(mkFile("page.htm", ""))).toBe("html");
    expect(classifyFile(mkFile("page.bin", "text/html"))).toBe("html");
  });

  it("classifies OneNote .mht single-file pages ahead of .html (mhtml ends with html)", () => {
    expect(classifyFile(mkFile("page.mht", ""))).toBe("mht");
    expect(classifyFile(mkFile("page.mhtml", ""))).toBe("mht");
    expect(classifyFile(mkFile("PAGE.MHT", ""))).toBe("mht");
    // the MIME types OneNote/browsers may stamp on it
    expect(classifyFile(mkFile("page.bin", "message/rfc822"))).toBe("mht");
    expect(classifyFile(mkFile("page.bin", "application/x-mimearchive"))).toBe("mht");
  });

  it("still classifies the original kinds", () => {
    expect(classifyFile(mkFile("scene.excalidraw", ""))).toBe("excalidraw");
    expect(classifyFile(mkFile("scene.excalidraw.json", ""))).toBe("excalidraw");
    expect(classifyFile(mkFile("doc.pdf", ""))).toBe("pdf");
    expect(classifyFile(mkFile("img.png", "image/png"))).toBe("image");
    expect(classifyFile(mkFile("notes.txt", "text/plain"))).toBe("text");
    expect(classifyFile(mkFile("notes.md", ""))).toBe("text");
    expect(classifyFile(mkFile("data.dat", "application/octet-stream"))).toBe("unknown");
  });
});

describe("classifyFile — audio clips (issue #67)", () => {
  it("classifies audio by MIME regardless of filename", () => {
    expect(classifyFile(mkFile("clip.bin", "audio/webm"))).toBe("audio");
    expect(classifyFile(mkFile("take", "audio/mpeg"))).toBe("audio");
    expect(classifyFile(mkFile("x.dat", "audio/mp4"))).toBe("audio");
  });

  it("classifies audio by extension when the MIME is empty", () => {
    expect(classifyFile(mkFile("interview.mp3", ""))).toBe("audio");
    expect(classifyFile(mkFile("VOICENOTE.WAV", ""))).toBe("audio");
    expect(classifyFile(mkFile("meeting.m4a", ""))).toBe("audio");
    expect(classifyFile(mkFile("mixtape.flac", ""))).toBe("audio");
  });

  it("treats .webm as audio only with an audio MIME (recordings, not videos)", () => {
    expect(classifyFile(mkFile("clip.webm", "audio/webm"))).toBe("audio"); // MediaRecorder
    expect(classifyFile(mkFile("clip.webm", ""))).toBe("unknown"); // probably video
    expect(classifyFile(mkFile("clip.webm", "video/webm"))).toBe("unknown");
  });

  it("audio beats the generic text bucket", () => {
    expect(classifyFile(mkFile("notes.mp3", "application/octet-stream"))).toBe("audio");
  });
});

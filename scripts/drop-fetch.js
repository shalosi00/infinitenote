(async () => {
  const specs = [
    ["test-image.png", "image/png"],
    ["test-notes.md", "text/markdown"],
    ["test-notes.txt", "text/plain"],
    ["test.pdf", "application/pdf"],
    ["onenote-export.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["onenote-page.html", "text/html"],
    ["onenote-page.mht", "message/rfc822"],
    ["test-scene.excalidraw", "application/json"],
    ["test-audio.wav", "audio/wav"],
  ];
  const dt = new DataTransfer();
  for (const [name, mime] of specs) {
    const res = await fetch("http://127.0.0.1:8799/" + name);
    const buf = await res.arrayBuffer();
    dt.items.add(new File([buf], name, { type: mime }));
  }
  const target = document.querySelector(".excalidraw") || document.body;
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return "dropped " + specs.length + " files";
})()

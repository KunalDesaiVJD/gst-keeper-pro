// Runs in the PAGE's own JS world (world: MAIN). The portal downloads a filed
// return by building a Blob and calling URL.createObjectURL(blob) + a hidden
// click. We hook createObjectURL to capture that Blob as a base64 data URL and
// hand it to our content script via postMessage. (Read-only capture; we still
// return the real object URL so the portal's own download proceeds normally.)
(() => {
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    try {
      if (obj instanceof Blob && obj.size > 0) {
        const fr = new FileReader();
        fr.onload = () => window.postMessage({ __gstkPdf: fr.result, size: obj.size, type: obj.type }, '*');
        fr.readAsDataURL(obj);
      }
    } catch (e) { /* ignore */ }
    return orig(obj);
  };
})();

// 0.18.3: reads back one file the browser saved (the GSTR-9 Table 8A file of
// the 8A pull), for background.js. An extension page's XMLHttpRequest can read
// a file:// address when "Allow access to file URLs" is on; fetch cannot.
// Read only; nothing is written or sent anywhere but back to background.js.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.gstkReadFile !== 'string' || !/^file:\/\//.test(msg.gstkReadFile)) return false;
  try {
    const x = new XMLHttpRequest();
    x.open('GET', msg.gstkReadFile);
    x.responseType = 'arraybuffer';
    x.onload = () => {
      const buf = x.response;
      if (!buf || !buf.byteLength) { reply({ ok: false, error: 'the file was empty or could not be opened' }); return; }
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      reply({ ok: true, b64: btoa(bin), size: bytes.length });
    };
    x.onerror = () => reply({ ok: false, error: 'Chrome refused to open the file (is "Allow access to file URLs" on for GST Keeper?)' });
    x.send();
  } catch (e) { reply({ ok: false, error: (e && e.message) || String(e) }); }
  return true;
});

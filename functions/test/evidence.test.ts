import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { validateEvidence, MAX_FILE } from '../src/evidence';
test('rejects empty, oversized and unsupported content', async () => {
  await assert.rejects(validateEvidence(Buffer.alloc(0), 'image/jpeg'));
  await assert.rejects(validateEvidence(Buffer.alloc(MAX_FILE + 1), 'image/png'));
  await assert.rejects(validateEvidence(Buffer.from('<svg/>'), 'image/svg+xml'));
});
test('does not trust a claimed MIME type', async () => {
  await assert.rejects(validateEvidence(Buffer.from('not an image'), 'image/png'));
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  await assert.rejects(validateEvidence(jpeg, 'image/png'));
});
test('decodes and re-encodes images, dropping original metadata', async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } }).withMetadata().jpeg().toBuffer();
  const result = await validateEvidence(jpeg, 'image/jpeg');
  assert.equal(result.type, 'image/webp'); const metadata = await sharp(result.bytes).metadata(); assert.equal(metadata.exif, undefined);
});
test('PDF uploads fail closed without malware scanning', async () => {
  delete process.env.CLAMAV_HOST;
  const doc = await PDFDocument.create(); doc.addPage(); const bytes = Buffer.from(await doc.save());
  await assert.rejects(validateEvidence(bytes, 'application/pdf'), /scanning is not configured/);
});
test('active PDF content is rejected before scanning', async () => {
  const doc = await PDFDocument.create(); doc.addPage(); doc.addJavaScript('unsafe', 'app.alert("hi")');
  await assert.rejects(validateEvidence(Buffer.from(await doc.save()), 'application/pdf'), /Active content/);
});

test('inline file attachments and stream dictionaries are rejected before scanning', async () => {
  const { PDFName, PDFString } = await import('pdf-lib');
  const doc = await PDFDocument.create(); const page = doc.addPage();
  const stream = doc.context.register(doc.context.stream(Buffer.from('attachment content'), { Type: 'EmbeddedFile' }));
  const annotation = doc.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [0, 0, 20, 20], FS: { Type: 'Filespec', F: PDFString.of('attachment.txt'), EF: { F: stream } } });
  page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  delete process.env.CLAMAV_HOST;
  await assert.rejects(validateEvidence(Buffer.from(await doc.save()), 'application/pdf'), /Active content/);
});
test('inline annotation actions inside arrays are rejected before scanning', async () => {
  const { PDFName, PDFString } = await import('pdf-lib');
  const doc = await PDFDocument.create(); const page = doc.addPage();
  page.node.set(PDFName.of('Annots'), doc.context.obj([{ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 20, 20], A: { S: 'URI', URI: PDFString.of('https://example.invalid/private') } }]));
  delete process.env.CLAMAV_HOST;
  await assert.rejects(validateEvidence(Buffer.from(await doc.save()), 'application/pdf'), /Active content/);
});
test('standalone embedded-file stream types cannot evade recursive inspection', async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  doc.context.register(doc.context.stream(Buffer.from('file bytes'), { Type: 'EmbeddedFile' }));
  await assert.rejects(validateEvidence(Buffer.from(await doc.save()), 'application/pdf'), /Active content/);
});

/** Protocol fixture only: not a deployed ClamAV/signature-currency test. */
async function withScanner(response: string | null, fn: () => Promise<void>) {
  const { createServer } = await import('node:net');
  const server = createServer(socket => {
    let pending = Buffer.alloc(0); let offset = 10; let replied = false;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (replied || pending.length < 10) return;
      assert.equal(pending.subarray(0, 10).toString(), 'zINSTREAM\0');
      while (pending.length >= offset + 4) {
        const size = pending.readUInt32BE(offset);
        if (pending.length < offset + 4 + size) return;
        offset += 4 + size;
        if (size === 0) { replied = true; if (response === null) socket.end(); else socket.end(response); return; }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const host = process.env.CLAMAV_HOST, port = process.env.CLAMAV_PORT;
  process.env.CLAMAV_HOST = '127.0.0.1'; process.env.CLAMAV_PORT = String(address.port);
  try { await fn(); } finally {
    if (host === undefined) delete process.env.CLAMAV_HOST; else process.env.CLAMAV_HOST = host;
    if (port === undefined) delete process.env.CLAMAV_PORT; else process.env.CLAMAV_PORT = port;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
test('a static PDF requires a complete clean INSTREAM acknowledgement', async () => {
  const doc = await PDFDocument.create(); doc.addPage(); const bytes = Buffer.from(await doc.save());
  await withScanner('stream: OK\0', async () => {
    const validated = await validateEvidence(bytes, 'application/pdf');
    assert.equal(validated.type, 'application/pdf'); assert.deepEqual(validated.bytes, bytes);
  });
});
for (const [label, response] of [['malware', 'stream: Eicar-Test-Signature FOUND\0'], ['scanner error', 'INSTREAM size limit exceeded. ERROR\0'], ['incomplete response', null], ['malformed response', 'OK\0']] as const) {
  test(`PDF scanning fails closed on ${label} (synthetic loopback scanner)`, async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    await withScanner(response, async () => { await assert.rejects(validateEvidence(Buffer.from(await doc.save()), 'application/pdf')); });
  });
}

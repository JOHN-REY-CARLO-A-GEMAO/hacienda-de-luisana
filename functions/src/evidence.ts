import sharp from 'sharp';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream } from 'pdf-lib';
import { createConnection } from 'node:net';
import { requireThat } from './domain';
export const MAX_FILE = 10 * 1024 * 1024;
export const CHUNK_SIZE = 192 * 1024;
export const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
/** Private-network ClamAV INSTREAM. No configured/available scanner => PDF fails closed. */
export async function scanPdf(bytes: Buffer): Promise<void> {
  requireThat(process.env.CLAMAV_HOST, 'PDF scanning is not configured. Use a photograph or screenshot for now.');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: process.env.CLAMAV_HOST!, port: Number(process.env.CLAMAV_PORT || 3310) });
    let result = ''; let done = false;
    const finish = (err?: Error) => { if (done) return; done = true; socket.destroy(); err ? reject(err) : resolve(); };
    socket.setTimeout(30000, () => finish(new Error('Evidence scanner timed out.')));
    socket.on('error', finish);
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let start = 0; start < bytes.length; start += 65536) {
        const chunk = bytes.subarray(start, start + 65536); const size = Buffer.alloc(4); size.writeUInt32BE(chunk.length);
        socket.write(size); socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', data => { result += data.toString(); if (result.length > 2048) return finish(new Error('Invalid scanner response.')); if (result.includes('\0')) finish(result.trim().replace(/\0/g, '') === 'stream: OK' ? undefined : new Error('Evidence did not pass malware scanning.')); });
    socket.on('end', () => { if (!done) finish(new Error('Incomplete scanner response.')); });
  });
}
export async function validateEvidence(bytes: Buffer, declared: string): Promise<{ bytes: Buffer; type: string }> {
  requireThat(bytes.length > 0 && bytes.length <= MAX_FILE && TYPES.includes(declared), 'Unsupported evidence type or size.', 'invalid-argument');
  if (declared === 'application/pdf') {
    requireThat(bytes.subarray(0, 5).toString() === '%PDF-', 'PDF signature mismatch.', 'invalid-argument');
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    requireThat(pdf.getPageCount() > 0 && pdf.getPageCount() <= 100, 'PDF must have 1–100 pages.');
    // Traverse direct objects inside arrays/dictionaries as well as indirect
    // objects and stream dictionaries. Top-level enumeration alone misses
    // inline annotation actions, associated files and stream /Type values.
    const blocked = new Set(['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFiles', 'EmbeddedFile', 'RichMedia', 'XFA', 'AcroForm', 'URI', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'FileAttachment', 'EF', 'AF']);
    const visited = new Set<object>();
    const inspect = (obj: unknown, depth = 0): void => {
      requireThat(depth <= 64, 'PDF object nesting is too deep.');
      if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
      visited.add(obj);
      if (obj instanceof PDFName) requireThat(!blocked.has(obj.decodeText()), 'Active content, forms, external links and embedded files are not allowed in PDF evidence.');
      else if (obj instanceof PDFDict) for (const [key, value] of obj.entries()) { inspect(key, depth + 1); inspect(value, depth + 1); }
      else if (obj instanceof PDFArray) for (const value of obj.asArray()) inspect(value, depth + 1);
      else if (obj instanceof PDFStream) inspect(obj.dict, depth + 1);
      // References are inspected when their indirect objects are enumerated;
      // do not recursively chase page-tree cycles.
    };
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) inspect(obj);
    await scanPdf(bytes);
    return { bytes, type: declared };
  }
  const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'warning' });
  const metadata = await image.metadata();
  const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[declared];
  requireThat(format === metadata.format && (!metadata.pages || metadata.pages === 1), 'Image signature mismatch or animation is not supported.', 'invalid-argument');
  // Decode and re-encode instead of trusting MIME/extension; strips EXIF/location and trailing payloads.
  const safe = await image.rotate().webp({ quality: 90 }).toBuffer();
  requireThat(safe.length <= MAX_FILE, 'Processed evidence exceeds size limit.');
  return { bytes: safe, type: 'image/webp' };
}

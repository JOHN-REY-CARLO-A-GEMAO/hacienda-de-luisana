/**
 * The OCR.space proxy (`functions/src/ocr.ts`, ADR-0024), without a network.
 *
 * What matters here is not "does OCR.space work" — that is their service — but
 * the four things this function is responsible for:
 *
 *   - the deployment is off until a key is set, and says so in a way the
 *     website can fall back from (`ocrSpaceSettings` → null);
 *   - a payload that is not a small, real receipt image is refused before a
 *     single byte is forwarded (`parseReceiptImageRequest`);
 *   - the request carries the key in the body, the image as a data URL, and
 *     nothing else (`ocrSpaceForm`);
 *   - a reply is either text or a typed failure, never a fabricated string
 *     (`ocrSpaceText` / `callOcrSpace`).
 *
 * The Phase 0 runner executes this suite inside a network namespace, so `fetch`
 * is injected everywhere. A test that needed the internet would fail for the
 * wrong reason.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RECEIPT_BYTES,
  OcrSpaceError,
  callOcrSpace,
  ocrSpaceFailureText,
  ocrSpaceForm,
  ocrSpaceSettings,
  ocrSpaceText,
  parseReceiptImageRequest,
  type OcrSpaceSettings,
} from '../src/ocr';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const settings: OcrSpaceSettings = {
  apiKey: 'test-key',
  endpoint: 'https://api.ocr.space/parse/image',
  language: 'eng',
  engine: '2',
};

const payloadFor = (bytes: Buffer, mimeType = 'image/png') => ({
  image: bytes.toString('base64'),
  mimeType,
});

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ocrSpaceSettings', () => {
  test('a deployment with no key is off, not broken', () => {
    assert.equal(ocrSpaceSettings({}), null);
    assert.equal(ocrSpaceSettings({ OCR_SPACE_API_KEY: '   ' }), null);
  });

  test('a key turns it on with the documented defaults', () => {
    const resolved = ocrSpaceSettings({ OCR_SPACE_API_KEY: 'abc123' });
    assert.deepEqual(resolved, {
      apiKey: 'abc123',
      endpoint: 'https://api.ocr.space/parse/image',
      language: 'eng',
      engine: '2',
    });
  });

  test('bad engine and language values fall back instead of being sent', () => {
    const resolved = ocrSpaceSettings({
      OCR_SPACE_API_KEY: 'abc123',
      OCR_SPACE_ENGINE: '9',
      OCR_SPACE_LANGUAGE: 'ENGLISH',
    });
    assert.equal(resolved?.engine, '2');
    assert.equal(resolved?.language, 'eng');
  });

  test('a PRO endpoint can be pointed at without touching code', () => {
    const resolved = ocrSpaceSettings({
      OCR_SPACE_API_KEY: 'abc123',
      OCR_SPACE_ENDPOINT: 'https://eu.pro.ocr.space/parse/image',
      OCR_SPACE_ENGINE: '3',
      OCR_SPACE_LANGUAGE: 'fil',
    });
    assert.equal(resolved?.endpoint, 'https://eu.pro.ocr.space/parse/image');
    assert.equal(resolved?.engine, '3');
    assert.equal(resolved?.language, 'fil');
  });
});

describe('parseReceiptImageRequest', () => {
  test('accepts a base64 image and its declared type', () => {
    const payload = payloadFor(PNG_BYTES);
    assert.deepEqual(parseReceiptImageRequest(payload), payload);
  });

  test('accepts a data URL and hands on only the base64', () => {
    const parsed = parseReceiptImageRequest({
      image: `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
      mimeType: 'image/png',
    });
    assert.equal(parsed.image, PNG_BYTES.toString('base64'));
  });

  test('refuses a missing image, a missing type, or a non-image type', () => {
    for (const body of [
      {},
      { image: 'abc', mimeType: '' },
      { image: PNG_BYTES.toString('base64'), mimeType: 'application/pdf' },
      { image: PNG_BYTES.toString('base64'), mimeType: 'image/webp' },
      { image: 'not base64 at all!!', mimeType: 'image/png' },
    ]) {
      assert.throws(() => parseReceiptImageRequest(body), /./);
    }
  });

  test('refuses bytes that are not an image at all', () => {
    assert.throws(
      () => parseReceiptImageRequest({ image: Buffer.from('hi').toString('base64'), mimeType: 'image/png' }),
      (error: any) => error.code === 'invalid-argument',
    );
  });

  test('refuses a file over the free plan cap instead of truncating it', () => {
    const tooBig = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    assert.throws(
      () => parseReceiptImageRequest(payloadFor(tooBig)),
      (error: any) => error.code === 'invalid-argument',
    );
  });

  test('refuses a payload shaped like an array', () => {
    assert.throws(() => parseReceiptImageRequest([payloadFor(PNG_BYTES)]));
  });
});

describe('ocrSpaceForm', () => {
  test('sends the key and the image in the body, and nothing in the URL', () => {
    const form = ocrSpaceForm(payloadFor(PNG_BYTES), settings);
    assert.equal(form.get('apikey'), 'test-key');
    assert.equal(form.get('language'), 'eng');
    assert.equal(form.get('OCREngine'), '2');
    assert.equal(form.get('isOverlayRequired'), 'false');
    assert.equal(
      form.get('base64Image'),
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
    );
  });

  test('the endpoint never carries the key as a query parameter', () => {
    assert.equal(new URL(settings.endpoint).search, '');
  });
});

describe('ocrSpaceText', () => {
  test('joins every parsed page', () => {
    const text = ocrSpaceText({
      ParsedResults: [{ ParsedText: 'Ref No. 7044 357 122304\r\n' }, { ParsedText: 'Amount 1,020.00\r\n' }],
      IsErroredOnProcessing: false,
      OCRExitCode: 1,
    });
    assert.equal(text, 'Ref No. 7044 357 122304\nAmount 1,020.00');
  });

  test('an empty read is an empty string, not a failure', () => {
    assert.equal(ocrSpaceText({ ParsedResults: [], IsErroredOnProcessing: false }), '');
  });

  test('an engine error is a typed failure, never text', () => {
    assert.throws(
      () => ocrSpaceText({ IsErroredOnProcessing: true, ErrorMessage: ['E101'], OCRExitCode: 4 }),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'unreachable',
    );
    assert.throws(
      () => ocrSpaceText({ ParsedResults: [], OCRExitCode: 3 }),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'unreachable',
    );
  });

  test('a reply that is not an OCR.space reply is not guessed at', () => {
    assert.throws(
      () => ocrSpaceText({ hello: 'world' }),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'malformed',
    );
    assert.throws(
      () => ocrSpaceText(null),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'malformed',
    );
  });

  test('the failure text is flattened and clipped for the log', () => {
    assert.equal(ocrSpaceFailureText({ ErrorMessage: ['E101', 'Bad image.'] }), 'E101 Bad image.');
    assert.equal(ocrSpaceFailureText({ ErrorMessage: 'E101' }), 'E101');
    assert.equal(ocrSpaceFailureText({ ErrorMessage: ['x'.repeat(400)] }).length, 300);
    assert.equal(ocrSpaceFailureText({}), '');
  });
});

describe('callOcrSpace', () => {
  test('posts the form to the endpoint and returns the text', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const text = await callOcrSpace(payloadFor(PNG_BYTES), settings, async (url, init) => {
      seen.url = String(url);
      seen.init = init;
      return reply({ ParsedResults: [{ ParsedText: 'Amount 1,020.00' }], OCRExitCode: 1 });
    });
    assert.equal(text, 'Amount 1,020.00');
    assert.equal(seen.url, settings.endpoint);
    assert.equal(seen.init?.method, 'POST');
    const headers = seen.init?.headers as Record<string, string>;
    assert.equal(headers['content-type'], 'application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(seen.init?.body));
    assert.equal(body.get('apikey'), 'test-key');
    assert.ok(body.get('base64Image')?.startsWith('data:image/png;base64,'));
  });

  test('429 is a quota failure, and every other status is unreachable', async () => {
    for (const [status, reason] of [
      [429, 'quota'],
      [500, 'unreachable'],
      [400, 'unreachable'],
    ] as const) {
      await assert.rejects(
        callOcrSpace(payloadFor(PNG_BYTES), settings, async () => new Response('', { status })),
        (error: unknown) => error instanceof OcrSpaceError && error.reason === reason,
      );
    }
  });

  test('a dropped connection and a non-JSON body are failures, not empty text', async () => {
    await assert.rejects(
      callOcrSpace(payloadFor(PNG_BYTES), settings, async () => {
        throw new Error('ECONNRESET');
      }),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'unreachable',
    );
    await assert.rejects(
      callOcrSpace(payloadFor(PNG_BYTES), settings, async () => new Response('<html>oops</html>', { status: 200 })),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'malformed',
    );
  });

  test('an engine that answers with an error report produces a typed failure', async () => {
    await assert.rejects(
      callOcrSpace(payloadFor(PNG_BYTES), settings, async () =>
        reply({ IsErroredOnProcessing: true, ErrorMessage: ['E101'], OCRExitCode: 4 }),
      ),
      (error: unknown) => error instanceof OcrSpaceError && error.reason === 'unreachable',
    );
  });

  test('an empty read returns an empty string so the website can ask the Guest to type', async () => {
    const text = await callOcrSpace(payloadFor(PNG_BYTES), settings, async () =>
      reply({ ParsedResults: [{ ParsedText: '   ' }], OCRExitCode: 1 }),
    );
    assert.equal(text, '');
  });
});

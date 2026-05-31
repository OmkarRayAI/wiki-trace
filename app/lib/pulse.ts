/**
 * Minimal Pulse client. Multipart upload, optional signed-URL handoff for
 * large responses. Mirrors scripts/parse_pdf.py.
 */

import { Buffer } from "node:buffer";

const PULSE_EXTRACT = "https://api.runpulse.com/extract";

export type PulseResult = {
  markdown: string;
  page_count?: number;
  credits_used?: number;
};

function multipart(filename: string, bytes: Buffer, fields: Record<string, string>): { body: Buffer; boundary: string } {
  const boundary = "----pulse" + Date.now();
  const crlf = "\r\n";
  let head = "";
  for (const [k, v] of Object.entries(fields)) {
    head += `--${boundary}${crlf}Content-Disposition: form-data; name="${k}"${crlf}${crlf}${v}${crlf}`;
  }
  head += `--${boundary}${crlf}`;
  head += `Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}`;
  head += `Content-Type: application/pdf${crlf}${crlf}`;
  const tail = `${crlf}--${boundary}--${crlf}`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), bytes, Buffer.from(tail, "utf8")]);
  return { body, boundary };
}

export async function pulseExtract(
  apiKey: string,
  filename: string,
  bytes: Buffer,
  opts?: { pages?: string },
): Promise<PulseResult> {
  const { body, boundary } = multipart(filename, bytes, opts?.pages ? { pages: opts.pages } : {});
  const r = await fetch(PULSE_EXTRACT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Pulse ${r.status}: ${text.slice(0, 400)}`);
  }
  let data: any = await r.json();
  if (data?.is_url) {
    const r2 = await fetch(data.url, { headers: { "x-api-key": apiKey } });
    if (!r2.ok) throw new Error(`Pulse signed-url fetch ${r2.status}`);
    data = await r2.json();
  }
  if (!data?.markdown) {
    throw new Error(`Pulse returned no markdown (keys: ${Object.keys(data ?? {}).join(",")})`);
  }
  return {
    markdown: data.markdown as string,
    page_count: data.page_count,
    credits_used: data.credits_used,
  };
}

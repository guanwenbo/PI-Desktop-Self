import { describe, expect, it } from "vitest";
import { hydrateAttachmentHistory } from "./attachment-history.js";
import type { UiMessage } from "@pi-desktop/shared";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import os from "node:os";

async function withTempDir(run: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(os.tmpdir(), "test-attachment-history-"));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

/**
 * A probeable PNG: real signature and IHDR header, zero padding after it.
 * The dimension probe reads only the header, so padding never matters.
 */
function pngBytes(length: number, width = 800, height = 600): Buffer {
  const bytes = Buffer.alloc(Math.max(33, length));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(bytes);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** HEIC-style container: a real format, but not one a provider image input accepts. */
function heicBytes(): Buffer {
  return Buffer.from("000000186674797068656963000000006d69663168656963", "hex");
}

function userMessage(
  id: string,
  attachments: NonNullable<UiMessage["attachments"]>,
): UiMessage {
  return {
    id,
    role: "user",
    content: id,
    createdAt: new Date().toISOString(),
    attachments,
  };
}

describe("hydrateAttachmentHistory", () => {
  it("inlines image attachments when supportsVision is true and within per-image byte limits", async () => {
    await withTempDir(async (tmp) => {
      const png = pngBytes(64);
      const imgPath = resolve(tmp, "sample.png");
      await writeFile(imgPath, png);
      const history = [
        userMessage("msg-1", [
          {
            name: "sample.png",
            ref: imgPath,
            kind: "image",
            mimeType: "image/png",
            size: png.length,
          },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
      });

      expect(hydrated[0]?.attachments?.[0]?.data).toBe(png.toString("base64"));
    });
  });

  it("does not let a pixel-limit rejection consume the history byte budget", async () => {
    await withTempDir(async (tmp) => {
      const olderBytes = pngBytes(33);
      const olderPath = resolve(tmp, "older.png");
      await writeFile(olderPath, olderBytes);
      const newerPath = resolve(tmp, "page.png");
      const header = pngBytes(33, 780, 14182);
      await writeFile(newerPath, header);
      const history = [
        userMessage("older", [
          {
            name: "older.png",
            ref: olderPath,
            kind: "image",
            mimeType: "image/png",
            size: olderBytes.length,
          },
        ]),
        userMessage("newer", [
          {
            name: "page.png",
            ref: newerPath,
            kind: "image",
            mimeType: "image/png",
            size: header.length,
          },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
        // Fits either image alone, not both. The newer one is over 8000 px.
        maxInlinedImageBytes: 40,
      });

      expect(hydrated[1]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[1]?.content).toContain("page.png");
      expect(hydrated[0]?.attachments?.[0]?.data).toBe(olderBytes.toString("base64"));
    });
  });

  it("keeps the path fallback for an image past the pixel limit (#1913)", async () => {
    await withTempDir(async (tmp) => {
      const imgPath = resolve(tmp, "page.png");
      await writeFile(imgPath, pngBytes(33, 780, 14182));
      const history = [
        userMessage("msg-1", [
          { name: "page.png", ref: imgPath, kind: "image", mimeType: "image/png", size: 33 },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
      });

      expect(hydrated[0]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[0]?.content).toContain(imgPath);
    });
  });

  it("keeps the path fallback for an image no accepted format probe can read", async () => {
    await withTempDir(async (tmp) => {
      const heic = heicBytes();
      const imgPath = resolve(tmp, "photo.jpg");
      await writeFile(imgPath, heic);
      const history = [
        userMessage("msg-1", [
          // The declared MIME claims JPEG; the bytes say otherwise. Inlining
          // this would 400 the provider request on every later turn.
          { name: "photo.jpg", ref: imgPath, kind: "image", mimeType: "image/jpeg", size: heic.length },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
      });

      expect(hydrated[0]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[0]?.content).toContain(imgPath);
    });
  });

  it("preserves historical image turns beyond ten messages when within the default byte budget", async () => {
    await withTempDir(async (tmp) => {
      const history: UiMessage[] = [];
      const payloads: Buffer[] = [];
      for (let i = 1; i <= 12; i++) {
        const payload = pngBytes(33 + i);
        const imgPath = resolve(tmp, `sample-${i}.png`);
        await writeFile(imgPath, payload);
        payloads.push(payload);
        history.push(
          userMessage(`msg-${i}`, [
            {
              name: `sample-${i}.png`,
              ref: imgPath,
              kind: "image",
              mimeType: "image/png",
              size: payload.length,
            },
          ]),
        );
      }

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
      });

      for (let i = 0; i < payloads.length; i++) {
        expect(hydrated[i]?.attachments?.[0]?.data).toBe(payloads[i]!.toString("base64"));
      }
    });
  });

  it("bounds actual aggregate bytes across many attachments in one message", async () => {
    await withTempDir(async (tmp) => {
      const attachments: NonNullable<UiMessage["attachments"]> = [];
      for (let i = 1; i <= 5; i++) {
        const imgPath = resolve(tmp, `burst-${i}.png`);
        await writeFile(imgPath, pngBytes(100));
        attachments.push({
          name: `burst-${i}.png`,
          ref: imgPath,
          kind: "image",
          mimeType: "image/png",
          // Deliberately incorrect metadata must not bypass the actual byte budget.
          size: 1,
          ...(i === 1 ? { data: "stale-base64-must-be-cleared" } : {}),
        });
      }
      const history = [userMessage("msg-burst", attachments)];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
        maxInlinedImageBytes: 250,
      });
      const result = hydrated[0];
      expect(result?.attachments?.map((attachment) => attachment.data)).toEqual([
        undefined,
        undefined,
        undefined,
        pngBytes(100).toString("base64"),
        pngBytes(100).toString("base64"),
      ]);
      for (let i = 1; i <= 3; i++) {
        expect(result?.content).toContain(`burst-${i}.png`);
        expect(result?.attachments?.[i - 1]?.ref).toContain(`burst-${i}.png`);
      }
    });
  });

  it("treats a zero history byte budget as no images inlined", async () => {
    await withTempDir(async (tmp) => {
      const imgPath = resolve(tmp, "sample.png");
      await writeFile(imgPath, pngBytes(33));
      const history = [
        userMessage("msg-1", [
          {
            name: "sample.png",
            ref: imgPath,
            kind: "image",
            mimeType: "image/png",
            size: 33,
          },
        ]),
      ];

      const hydrated = await hydrateAttachmentHistory(history, {
        projectPath: tmp,
        supportsVision: true,
        maxInlinedImageBytes: 0,
      });

      expect(hydrated[0]?.attachments?.[0]?.data).toBeUndefined();
      expect(hydrated[0]?.content).toContain("sample.png");
    });
  });
});

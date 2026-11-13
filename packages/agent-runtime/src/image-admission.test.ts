import type { Message } from "@earendil-works/pi-ai";
import type { UiMessage } from "@pi-desktop/shared";
import { describe, expect, it } from "vitest";
import { omitUndeliverableImages } from "./image-admission.js";
import { convertToLlm } from "./pi-runtime-messages.js";
import { toolResultFromUi } from "./runtime.js";

function pngBase64(width: number, height: number): string {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(bytes);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

const TALL = pngBase64(780, 14182);
const NORMAL = pngBase64(1688, 1514);
/** HEIC-style header: a real container format, but not one a provider accepts. */
const HEIC = Buffer.from("000000186674797068656963000000006d69663168656963", "hex")
  .toString("base64");
const NOTICE =
  "[Image omitted: 780x14182 px exceeds the 8000 px longest-edge limit for model input.]";
const FORMAT_NOTICE =
  "[Image omitted: not a readable PNG/JPEG/GIF/WebP image; model input accepts those formats only.]";

describe("omitUndeliverableImages", () => {
  it("replaces an oversized image in a user prompt and keeps its position", () => {
    const messages: Message[] = [{
      role: "user",
      content: [
        { type: "text", text: "before" },
        { type: "image", data: TALL, mimeType: "image/png" },
        { type: "image", data: NORMAL, mimeType: "image/png" },
      ],
      timestamp: 1,
    }];
    const [user] = omitUndeliverableImages(messages);
    expect(user?.content).toEqual([
      { type: "text", text: "before" },
      { type: "text", text: NOTICE },
      { type: "image", data: NORMAL, mimeType: "image/png" },
    ]);
    expect(messages[0]?.content).toHaveLength(3);
    expect((messages[0]?.content as Array<{ type: string }>)[1]?.type).toBe("image");
  });

  it("replaces an image whose bytes no accepted format probe can read", () => {
    const messages: Message[] = [{
      role: "user",
      content: [
        { type: "text", text: "shot" },
        { type: "image", data: HEIC, mimeType: "image/jpeg" },
        { type: "image", data: NORMAL, mimeType: "image/png" },
      ],
      timestamp: 1,
    }];
    const [user] = omitUndeliverableImages(messages);
    expect(user?.content).toEqual([
      { type: "text", text: "shot" },
      { type: "text", text: FORMAT_NOTICE },
      { type: "image", data: NORMAL, mimeType: "image/png" },
    ]);
  });

  it("returns the same array when every image is admissible", () => {
    const messages: Message[] = [
      { role: "user", content: "plain text", timestamp: 1 },
      {
        role: "user",
        content: [{ type: "image", data: NORMAL, mimeType: "image/png" }],
        timestamp: 2,
      },
    ];
    expect(omitUndeliverableImages(messages)).toBe(messages);
  });

  it("heals a restored session whose Read result holds an oversized image", () => {
    const row = {
      id: "tool-1",
      role: "tool",
      content: "",
      toolName: "read",
      toolCallId: "call-1",
      toolStatus: "done",
      toolResult: {
        path: "page.png",
        text: "Image file page.png (1890000 bytes, image/png); the image is attached to this result.",
        images: [{ data: TALL, mimeType: "image/png" }],
      },
    } as unknown as UiMessage;
    const restored = toolResultFromUi(row, 1);
    expect(restored.content.some((block) => block.type === "image")).toBe(true);

    const [outgoing] = convertToLlm([restored]);
    expect(outgoing?.role).toBe("toolResult");
    const content = outgoing?.content as Array<{ type: string; text?: string }>;
    expect(content.some((block) => block.type === "image")).toBe(false);
    expect(content.at(-1)).toEqual({ type: "text", text: NOTICE });
  });
});

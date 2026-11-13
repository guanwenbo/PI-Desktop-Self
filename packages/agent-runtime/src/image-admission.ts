/**
 * Last-view admission for provider image blocks (issue #1913).
 *
 * Host Read and prompt attachments refuse an oversized image before it is
 * persisted, but older sessions, plugin and MCP tool results can still carry
 * one. A provider rejects such an image with a non-retriable 400, and every
 * later request replays it, so the session can never continue. The same holds
 * for bytes no accepted format probe can read (HEIC, AVIF, a renamed file,
 * truncated data): the declared MIME type is user-supplied metadata, never
 * proof. Replacing the block with a notice is deterministic for the same
 * bytes: the request prefix stays stable across turns and prompt caching
 * keeps working.
 */
import type { Message } from "@earendil-works/pi-ai";
import {
  imageExceedsInlineDimensions,
  isUnrecognizedInlineImage,
  omittedImageNotice,
  omittedUnrecognizedImageNotice,
  probeBase64ImageDimensions,
} from "@pi-desktop/shared";

type ContentBlock = Exclude<Message["content"], string>[number];

function admittedBlocks<T extends ContentBlock>(content: T[]): T[] {
  let next: T[] | undefined;
  content.forEach((block, index) => {
    if (block.type !== "image" || typeof block.data !== "string") return;
    const dimensions = probeBase64ImageDimensions(block.data);
    const notice = imageExceedsInlineDimensions(dimensions)
      ? omittedImageNotice(dimensions)
      : isUnrecognizedInlineImage(dimensions)
        ? omittedUnrecognizedImageNotice()
        : undefined;
    if (notice === undefined) return;
    next ??= content.slice();
    next[index] = { type: "text", text: notice } as T;
  });
  return next ?? content;
}

/**
 * Replace every image a provider would reject — known-oversized, or not a
 * readable PNG/JPEG/GIF/WebP at all — with a text notice. Returns the input
 * array when nothing was replaced.
 */
export function omitUndeliverableImages(messages: Message[]): Message[] {
  let next: Message[] | undefined;
  messages.forEach((message, index) => {
    if (message.role !== "user" && message.role !== "toolResult") return;
    if (!Array.isArray(message.content)) return;
    const content = admittedBlocks(message.content as ContentBlock[]);
    if (content === message.content) return;
    next ??= messages.slice();
    next[index] = { ...message, content } as Message;
  });
  return next ?? messages;
}

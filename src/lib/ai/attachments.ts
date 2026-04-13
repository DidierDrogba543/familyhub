import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { GmailAttachment } from "../types";

function getApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  throw new Error("ANTHROPIC_API_KEY not found");
}

/**
 * Extract text content from attachments.
 * - PDFs: uses pdf-parse for text extraction
 * - Images: uses Claude vision to read the content
 *
 * Returns the extracted text to be appended to the email body
 * before running the extraction pipeline.
 */
export async function extractTextFromAttachments(
  attachments: GmailAttachment[]
): Promise<string> {
  if (attachments.length === 0) return "";

  const extractedTexts: string[] = [];

  for (const attachment of attachments) {
    try {
      if (attachment.mimeType === "application/pdf") {
        const text = await extractPdfText(attachment.data);
        if (text.trim()) {
          extractedTexts.push(
            `\n--- ATTACHMENT: ${attachment.filename} (PDF) ---\n${text.slice(0, 5000)}`
          );
        }
      } else if (attachment.mimeType.startsWith("image/")) {
        const text = await extractImageText(attachment);
        if (text.trim()) {
          extractedTexts.push(
            `\n--- ATTACHMENT: ${attachment.filename} (Image) ---\n${text}`
          );
        }
      }
    } catch (err) {
      console.error(`Failed to extract from ${attachment.filename}:`, err);
    }
  }

  return extractedTexts.join("\n");
}

/**
 * Extract text from a PDF using pdf-parse.
 */
async function extractPdfText(data: Buffer): Promise<string> {
  // Dynamic import to avoid issues with pdf-parse in edge environments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfModule = await import("pdf-parse") as any;
  const pdfParse = pdfModule.default || pdfModule;
  const result = await pdfParse(data);
  return result.text;
}

/**
 * Extract text from an image using Claude's vision capability.
 * Claude can read flyers, letters, timetables, and handwritten notes.
 */
async function extractImageText(attachment: GmailAttachment): Promise<string> {
  const anthropic = new Anthropic({ apiKey: getApiKey() });

  const base64 = attachment.data.toString("base64");
  const mediaType = attachment.mimeType as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: "Extract ALL text from this image. This is likely a school letter, flyer, timetable, or notice. Include dates, times, names, locations, deadlines, and any action items. Return the text as-is, preserving the information. If the image is not a document (e.g. a photo or logo), reply with EMPTY.",
          },
        ],
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text === "EMPTY" ? "" : text;
}

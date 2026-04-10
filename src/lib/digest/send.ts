import { Resend } from "resend";
import type { ExtractedItem } from "../types";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

interface DigestOptions {
  recipientEmail: string;
  recipientName: string;
  items: ExtractedItem[];
  date: string; // "Thursday 10 April 2026"
}

/**
 * Send the morning digest email.
 * Groups items by urgency: high first, then medium, then low.
 */
export async function sendDigestEmail(opts: DigestOptions): Promise<boolean> {
  const { recipientEmail, recipientName, items, date } = opts;

  if (items.length === 0) {
    // Send "all clear" digest
    return sendEmail(
      recipientEmail,
      `FamilyHub: All clear for ${date}`,
      buildAllClearHtml(recipientName, date)
    );
  }

  const high = items.filter((i) => i.urgency === "high");
  const medium = items.filter((i) => i.urgency === "medium");
  const low = items.filter((i) => i.urgency === "low");

  const subject =
    high.length > 0
      ? `FamilyHub: ${high.length} urgent + ${medium.length + low.length} more for ${date}`
      : `FamilyHub: ${items.length} items for ${date}`;

  const html = buildDigestHtml(recipientName, date, high, medium, low);

  return sendEmail(recipientEmail, subject, html);
}

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  try {
    const { error } = await getResend().emails.send({
      from: "FamilyHub <digest@familyhub.app>",
      to,
      subject,
      html,
    });
    if (error) {
      console.error("Digest send error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Digest send exception:", err);
    return false;
  }
}

function buildDigestHtml(
  name: string,
  date: string,
  high: ExtractedItem[],
  medium: ExtractedItem[],
  low: ExtractedItem[]
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f7f7f7; }
    .header { padding: 20px 0; }
    .header h1 { font-size: 22px; margin: 0; color: #1a1a1a; }
    .header p { font-size: 14px; color: #888; margin: 4px 0 0; }
    .section { margin: 16px 0; }
    .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0; }
    .section-title.urgent { color: #dc2626; }
    .section-title.action { color: #d97706; }
    .section-title.info { color: #2563eb; }
    .item { background: #fff; border-radius: 12px; padding: 16px; margin: 8px 0; border-left: 4px solid #ddd; }
    .item.urgent { border-left-color: #dc2626; }
    .item.action { border-left-color: #d97706; }
    .item.info { border-left-color: #2563eb; }
    .item-title { font-size: 16px; font-weight: 600; margin: 0; }
    .item-meta { font-size: 13px; color: #666; margin: 4px 0; }
    .item-snippet { font-size: 13px; color: #888; margin: 8px 0 0; font-style: italic; }
    .item-action { display: inline-block; margin-top: 8px; padding: 8px 16px; background: #2563eb; color: #fff; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500; }
    .child-tag { display: inline-block; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; color: #555; }
    .review-badge { display: inline-block; background: #fef3c7; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; color: #92400e; margin-left: 4px; }
    .footer { padding: 20px 0; font-size: 12px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Good morning${name ? `, ${name}` : ""}</h1>
    <p>${date} &middot; ${high.length + medium.length + low.length} items</p>
  </div>

  ${high.length > 0 ? `
  <div class="section">
    <div class="section-title urgent">Urgent (${high.length})</div>
    ${high.map((item) => renderItem(item, "urgent")).join("")}
  </div>` : ""}

  ${medium.length > 0 ? `
  <div class="section">
    <div class="section-title action">This week (${medium.length})</div>
    ${medium.map((item) => renderItem(item, "action")).join("")}
  </div>` : ""}

  ${low.length > 0 ? `
  <div class="section">
    <div class="section-title info">For your info (${low.length})</div>
    ${low.map((item) => renderItem(item, "info")).join("")}
  </div>` : ""}

  <div class="footer">
    FamilyHub &middot; Never miss a school thing again
  </div>
</body>
</html>`;
}

function renderItem(item: ExtractedItem, cssClass: string): string {
  const dateLine = item.date
    ? new Date(item.date).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";
  const deadlineLine = item.deadline
    ? `Deadline: ${new Date(item.deadline).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";

  return `
  <div class="item ${cssClass}">
    <p class="item-title">${escapeHtml(item.title)}</p>
    <p class="item-meta">
      ${dateLine}${dateLine && deadlineLine ? " &middot; " : ""}${deadlineLine}
      ${item.child_name ? `<span class="child-tag">${escapeHtml(item.child_name)}</span>` : ""}
      ${item.needs_review ? `<span class="review-badge">Check this</span>` : ""}
    </p>
    ${item.raw_snippet ? `<p class="item-snippet">${escapeHtml(item.raw_snippet.slice(0, 150))}</p>` : ""}
    ${item.action_url ? `<a class="item-action" href="${escapeHtml(item.action_url)}">Take action</a>` : ""}
  </div>`;
}

function buildAllClearHtml(name: string, date: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 40px 20px; text-align: center; }
    h1 { font-size: 22px; color: #1a1a1a; }
    p { font-size: 16px; color: #888; }
    .footer { padding: 40px 0 20px; font-size: 12px; color: #aaa; }
  </style>
</head>
<body>
  <h1>All clear${name ? `, ${name}` : ""}</h1>
  <p>No new school items for ${date}. Enjoy your day.</p>
  <div class="footer">FamilyHub</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

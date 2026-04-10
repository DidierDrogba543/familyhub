import { google } from "googleapis";

export interface GmailCredentials {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export function createGmailClient(credentials: GmailCredentials) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expiry_date: credentials.expiry_date,
  });

  // Handle token refresh
  oauth2Client.on("tokens", (tokens) => {
    // Caller is responsible for persisting refreshed tokens
    credentials.access_token = tokens.access_token ?? credentials.access_token;
    if (tokens.expiry_date) {
      credentials.expiry_date = tokens.expiry_date;
    }
  });

  return {
    gmail: google.gmail({ version: "v1", auth: oauth2Client }),
    oauth2Client,
    credentials,
  };
}

/**
 * Fetch emails newer than a given date, in reverse chronological order.
 * Returns a page of messages with a next page token for chunked processing.
 */
export async function fetchEmails(
  gmail: ReturnType<typeof google.gmail>,
  opts: {
    afterDate?: Date;
    pageToken?: string;
    maxResults?: number;
  }
) {
  const query = opts.afterDate
    ? `after:${Math.floor(opts.afterDate.getTime() / 1000)}`
    : "";

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: opts.maxResults ?? 30,
    pageToken: opts.pageToken ?? undefined,
  });

  const messages = listResponse.data.messages ?? [];
  const nextPageToken = listResponse.data.nextPageToken ?? null;

  return { messages, nextPageToken };
}

/**
 * Fetch full message content for a single email.
 */
export async function fetchMessageContent(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string
) {
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = msg.data.payload?.headers ?? [];
  const subject =
    headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
  const from =
    headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "unknown";
  const date =
    headers.find((h) => h.name?.toLowerCase() === "date")?.value ?? "";

  // Extract body text (handle multipart)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = extractBody(msg.data.payload as any);

  return {
    id: msg.data.id ?? messageId,
    threadId: msg.data.threadId ?? "",
    subject,
    from,
    date,
    body,
    snippet: msg.data.snippet ?? "",
  };
}

function extractBody(
  payload: Record<string, unknown> | undefined | null
): string {
  if (!payload) return "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;

  // Direct body
  if (p.body?.data) {
    return Buffer.from(p.body.data, "base64").toString("utf-8");
  }

  // Multipart — look for text/plain first, then text/html
  if (p.parts) {
    const textPart = p.parts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (part: any) => part.mimeType === "text/plain"
    );
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, "base64").toString("utf-8");
    }

    const htmlPart = p.parts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (part: any) => part.mimeType === "text/html"
    );
    if (htmlPart?.body?.data) {
      const html = Buffer.from(htmlPart.body.data, "base64").toString("utf-8");
      // Strip HTML tags for text extraction
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }

    // Recurse into nested multipart
    for (const part of p.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

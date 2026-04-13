import mammoth from "mammoth";

const DOWNLOADABLE_EXTENSIONS = [".docx", ".doc", ".pdf", ".png", ".jpg", ".jpeg"];
const MAX_DOWNLOAD_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * Find download links in email body text/HTML that point to documents.
 * Handles ParentMail, school portals, and other platforms that send
 * wrapper emails with links to the actual content.
 */
export function findDocumentLinks(body: string): string[] {
  // Match URLs from href attributes and plain text
  // Captures URLs in href="...", href='...', and bare URLs
  const hrefPattern = /href=["']?(https?:\/\/[^"'\s<>]+)/gi;
  const hrefMatches: string[] = [];
  let m;
  while ((m = hrefPattern.exec(body)) !== null) {
    hrefMatches.push(m[1]);
  }

  // Also match bare URLs ending in downloadable extensions
  const urlPattern = /https?:\/\/[^\s"'<>]+\.(?:docx|doc|pdf|png|jpg|jpeg)(?:[^\s"'<>]*)?/gi;
  const bareMatches = body.match(urlPattern) || [];

  // Combine all matches
  const allUrls = [...hrefMatches, ...bareMatches];

  // Filter to only document/download links
  const docLinks = allUrls.filter((link) => {
    return DOWNLOADABLE_EXTENSIONS.some((ext) => link.toLowerCase().includes(ext))
      || link.includes("parentmail.co.uk/download")
      || link.includes("/attachment")
      || link.includes("/download");
  });

  // Clean trailing punctuation/quotes that might have been captured
  const cleaned = docLinks.map((link) => link.replace(/[)"']+$/, ""));

  // Deduplicate
  return [...new Set(cleaned)];
}

/**
 * Download a document from a URL and extract its text content.
 * Supports .docx, .pdf, and images.
 */
export async function downloadAndExtract(url: string): Promise<{
  text: string;
  filename: string;
  mimeType: string;
} | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "FamilyHub/1.0 (School communication aggregator)",
      },
    });

    if (!response.ok) {
      console.error(`Download failed for ${url}: ${response.status}`);
      return null;
    }

    // Check size
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE) {
      console.error(`File too large: ${contentLength} bytes`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const filename = extractFilename(url, response);

    // Route to the right extractor based on file type
    if (
      contentType.includes("wordprocessingml") ||
      contentType.includes("msword") ||
      filename.endsWith(".docx") ||
      filename.endsWith(".doc") ||
      url.toLowerCase().includes(".docx")
    ) {
      const text = await extractDocxText(buffer);
      return { text, filename, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }

    if (contentType.includes("pdf") || filename.endsWith(".pdf")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfModule = await import("pdf-parse") as any;
      const pdfParse = pdfModule.default || pdfModule;
      const result = await pdfParse(buffer);
      return { text: result.text, filename, mimeType: "application/pdf" };
    }

    if (contentType.startsWith("image/")) {
      // Return buffer for vision processing by the caller
      return { text: `[IMAGE: ${filename} - needs vision processing]`, filename, mimeType: contentType };
    }

    console.log(`Unsupported content type: ${contentType} for ${url}`);
    return null;
  } catch (err) {
    console.error(`Download error for ${url}:`, err);
    return null;
  }
}

/**
 * Extract text from a .docx file using mammoth.
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractFilename(url: string, response: Response): string {
  // Try Content-Disposition header
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const match = disposition.match(/filename[*]?=["']?(?:UTF-8'')?([^"';\n]+)/i);
    if (match) return decodeURIComponent(match[1]);
  }

  // Fall back to URL path
  const urlPath = new URL(url).pathname;
  const segments = urlPath.split("/");
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && lastSegment.includes(".")) return lastSegment;

  return "download";
}

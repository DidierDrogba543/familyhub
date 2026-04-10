import mammoth from "mammoth";

const DOWNLOADABLE_EXTENSIONS = [".docx", ".doc", ".pdf", ".png", ".jpg", ".jpeg"];
const MAX_DOWNLOAD_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * Find download links in email body text/HTML that point to documents.
 * Handles ParentMail, school portals, and other platforms that send
 * wrapper emails with links to the actual content.
 */
export function findDocumentLinks(body: string): string[] {
  // Match URLs ending in downloadable extensions
  const urlPattern = /https?:\/\/[^\s"'<>]+\.(?:docx|doc|pdf|png|jpg|jpeg)(?:[^\s"'<>]*)?/gi;
  const matches = body.match(urlPattern) || [];

  // Also match ParentMail-style download links (may not have extension in URL)
  const parentMailPattern = /https?:\/\/pmx\.parentmail\.co\.uk\/download\/[^\s"'<>]+/gi;
  const pmMatches = body.match(parentMailPattern) || [];

  // Deduplicate
  const allLinks = [...new Set([...matches, ...pmMatches])];

  return allLinks.filter((link) => {
    // Only follow links that look like document downloads
    return DOWNLOADABLE_EXTENSIONS.some((ext) => link.toLowerCase().includes(ext))
      || link.includes("parentmail.co.uk/download")
      || link.includes("/attachment")
      || link.includes("/download");
  });
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
      const pdfParse = (await import("pdf-parse")).default;
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

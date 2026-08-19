import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "./http/errors";

export async function pdfToText(bytes: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = (Array.isArray(text) ? text.join("\n") : text).trim();
    if (!clean) throw new HttpError(422, "empty_resume");
    return clean.slice(0, 20_000);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, "unreadable_pdf");
  }
}

import Tesseract from "tesseract.js";

// Run OCR on an image file entirely in the browser. No data leaves the device.
export async function ocrImage(file: File | Blob, onProgress?: (p: number) => void): Promise<string> {
  const { data } = await Tesseract.recognize(file, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) onProgress(m.progress);
    },
  });
  return data.text;
}

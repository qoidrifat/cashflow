export interface CompressReceiptImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: 'image/jpeg' | 'image/webp';
  maxOutputBytes?: number;
}

const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_MAX_HEIGHT = 1280;
const DEFAULT_QUALITY = 0.75;
const DEFAULT_OUTPUT_TYPE = 'image/jpeg';
const DEFAULT_MAX_OUTPUT_BYTES = 1_500_000;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('Gagal mengompres gambar.'));
          return;
        }
        resolve(result);
      },
      type,
      quality,
    );
  });
}

function fileNameWithExtension(fileName: string, outputType: string): string {
  const extension = outputType === 'image/webp' ? 'webp' : 'jpg';
  return `${fileName.replace(/\.[^.]+$/, '') || 'receipt'}.${extension}`;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressReceiptImage(
  file: File,
  {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    quality = DEFAULT_QUALITY,
    outputType = DEFAULT_OUTPUT_TYPE,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  }: CompressReceiptImageOptions = {},
): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar.');
  }

  const image = await loadImageElement(file);
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser tidak mendukung pemrosesan gambar.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  const qualities = Array.from(new Set([quality, 0.65, 0.55, 0.45])).filter((q) => q > 0 && q <= 1);
  let smallestBlob: Blob | null = null;

  for (const currentQuality of qualities) {
    const blob = await canvasToBlob(canvas, outputType, currentQuality);
    smallestBlob = blob;
    if (blob.size <= maxOutputBytes) {
      return new File([blob], fileNameWithExtension(file.name, outputType), {
        type: outputType,
        lastModified: Date.now(),
      });
    }
  }

  if (smallestBlob && smallestBlob.size <= 2_000_000) {
    return new File([smallestBlob], fileNameWithExtension(file.name, outputType), {
      type: outputType,
      lastModified: Date.now(),
    });
  }

  throw new Error('Gambar masih terlalu besar setelah dikompres. Coba foto lebih dekat dan jelas.');
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, fileName = 'receipt-camera.jpg'): File {
  const [header, base64 = ''] = dataUrl.split(',');
  const mimeType = header.match(/^data:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType, lastModified: Date.now() });
}

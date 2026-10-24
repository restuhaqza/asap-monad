/**
 * Browser-side image compression: evidence photos are downscaled to a 1280px
 * long edge and re-encoded as JPEG q0.82 before upload, which keeps the request
 * far under the 3 MB evidence cap.
 */

export const MAX_IMAGE_EDGE = 1280;
export const JPEG_QUALITY = 0.82;

/** Downscale + re-encode. Rejects when the file cannot be decoded as an image. */
export function compressImage(
  file: Blob,
  maxEdge: number = MAX_IMAGE_EDGE,
  quality: number = JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    const cleanup = () => URL.revokeObjectURL(url);

    image.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            cleanup();
            if (blob) resolve(blob);
            else reject(new Error('compress failed'));
          },
          'image/jpeg',
          quality,
        );
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('cannot read image'));
      }
    };

    image.onerror = () => {
      cleanup();
      reject(new Error('cannot read image'));
    };

    image.src = url;
  });
}

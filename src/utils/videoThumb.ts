/**
 * Generates a thumbnail image from a video file or video URL using HTML5 canvas.
 * Captures a frame at timestamp ~0.5s - 1.0s.
 */
export async function generateVideoThumbnail(
  source: File | Blob | string,
  targetTimeSec: number = 0.5
): Promise<{ thumbnailDataUrl: string; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let objectUrl = '';
    if (typeof source === 'string') {
      video.src = source;
      video.crossOrigin = 'anonymous';
    } else {
      objectUrl = URL.createObjectURL(source);
      video.src = objectUrl;
    }

    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      video.remove();
    };

    const timeout = setTimeout(() => {
      cleanup();
      // Fallback empty poster if video format can't decode frame
      resolve({ thumbnailDataUrl: '', duration: 0 });
    }, 7000);

    video.onloadedmetadata = () => {
      const seekTime = Math.min(targetTimeSec, video.duration > 1 ? 1 : video.duration / 2);
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        
        // Scale down to max 640x360 to keep thumbnail small
        const maxDim = 640;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          clearTimeout(timeout);
          cleanup();
          resolve({ thumbnailDataUrl, duration: video.duration || 0 });
          return;
        }
      } catch (err) {
        console.warn('Could not extract video canvas frame:', err);
      }
      clearTimeout(timeout);
      cleanup();
      resolve({ thumbnailDataUrl: '', duration: video.duration || 0 });
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      // Don't reject, just return empty thumb so the upload still succeeds!
      resolve({ thumbnailDataUrl: '', duration: 0 });
    };
  });
}

/**
 * Compresses an image file to a lightweight data URL for fast previews and fallback storage.
 */
export async function compressImage(file: File, maxDim: number = 1600, quality: number = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      let scale = Math.min(1, maxDim / Math.max(w, h));
      let q = quality;

      const draw = () => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, c.width, c.height);
        }
        return c.toDataURL('image/jpeg', q);
      };

      let out = draw();
      // If oversized, slightly decrease quality
      while (out.length > 900_000 && q > 0.45) {
        q -= 0.15;
        out = draw();
      }

      URL.revokeObjectURL(url);
      resolve(out);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };

    img.src = url;
  });
}

/** Thin-lens blur-circle diameter in pixels: c = fx·A·|1/s − 1/s_f| (focal length ≪ s). */
export const blurDiameter = (
  fx: number,
  aperture: number,
  depth: number,
  focusDepth: number,
) => fx * aperture * Math.abs(1 / depth - 1 / focusDepth);
/** Gaussian σ with the same second moment as a uniform disc of diameter c. */
export const blurSigma = (diameter: number) => diameter / 4;
/** Contrast left on a sinusoid of period P pixels after a Gaussian blur σ. */
export const gaussianMtf = (sigma: number, period: number) =>
  Math.exp((-2 * Math.PI * Math.PI * sigma * sigma) / (period * period));
/** Camera depth-of-field criterion: blur diameter ≤ 2 px. */
export const CAMERA_BLUR_LIMIT = 2;
/** Largest projector blur diameter (px) that keeps a pattern's MTF ≥ 0.5. */
export const projectorBlurLimit = (width: number, frequency: number) =>
  4 * (width / frequency / Math.PI) * Math.sqrt(Math.LN2 / 2);

const MAX_BLUR_RADIUS = 20;

/**
 * Spatially varying defocus: every source pixel spreads with its own Gaussian
 * (separable two-pass approximation, exact for uniform σ; energy kept inside the image).
 */
export function scatterBlur(
  images: Float64Array[],
  width: number,
  height: number,
  sigma: Float64Array,
): Float64Array[] {
  const pass = (input: Float64Array[], horizontal: boolean) => {
    const output = input.map(() => new Float64Array(width * height));
    const weights = new Float64Array(2 * MAX_BLUR_RADIUS + 1);
    for (let i = 0; i < width * height; i++) {
      const s = sigma[i];
      if (!(s >= 0.2)) {
        for (let k = 0; k < input.length; k++) output[k][i] += input[k][i];
        continue;
      }
      const x = i % width,
        y = Math.floor(i / width),
        pos = horizontal ? x : y,
        size = horizontal ? width : height,
        radius = Math.min(MAX_BLUR_RADIUS, Math.ceil(3 * s)),
        lo = Math.max(-radius, -pos),
        hi = Math.min(radius, size - 1 - pos);
      let total = 0;
      for (let d = lo; d <= hi; d++)
        total += weights[d + radius] = Math.exp((-d * d) / (2 * s * s));
      for (let d = lo; d <= hi; d++) {
        const j = horizontal ? i + d : i + d * width,
          w = weights[d + radius] / total;
        for (let k = 0; k < input.length; k++) output[k][j] += w * input[k][i];
      }
    }
    return output;
  };
  return pass(pass(images, true), false);
}

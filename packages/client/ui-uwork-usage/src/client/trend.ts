/** Geometry for observed trend values; absent days never become fabricated samples. */

/** Scale observed values into the chart viewport, preserving single points and zero values.
 * @param values - Actual values in server trend order; signed costs are retained.
 * @returns One chart coordinate per observed value, with no inserted samples.
 */
export function plotTrend(
  values: readonly { readonly id: string; readonly value: number }[],
): readonly { readonly id: string; readonly x: number; readonly y: number }[] {
  const bounds = values.reduce((result, item) => ({
    min: Math.min(result.min, item.value), max: Math.max(result.max, item.value),
  }), { min: 0, max: 0 })
  const scale = Math.max(Math.abs(bounds.min), Math.abs(bounds.max)) || 1
  const minimum = bounds.min / scale
  const span = bounds.max / scale - minimum || 1
  return values.map((item, index) => ({
    id: item.id,
    x: values.length === 1 ? 300 : 16 + index / (values.length - 1) * 568,
    y: 144 - (item.value / scale - minimum) / span * 128,
  }))
}

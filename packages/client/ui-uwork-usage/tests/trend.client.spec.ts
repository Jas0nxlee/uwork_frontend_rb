/** Chart geometry preserves empty, single-point, zero and signed-cost observations. */
import { expect, it } from 'vitest'
import { plotTrend as plot } from '../src/client/trend.ts'

function plotTrend(values: readonly number[]) {
  return plot(values.map((value, index) => ({ id: `synthetic-${index}`, value }))).map(({ x, y }) => ({ x, y }))
}

it('renders no samples for an empty period and a centered single observed point', () => {
  expect(plotTrend([])).toEqual([])
  expect(plotTrend([10])).toEqual([{ x: 300, y: 16 }])
  expect(plotTrend([0])).toEqual([{ x: 300, y: 144 }])
})
it('keeps observed zeros and negative accounting values finite without inserting days', () => {
  expect(plotTrend([0, 0])).toEqual([{ x: 16, y: 144 }, { x: 584, y: 144 }])
  expect(plotTrend([-10, 0, 10])).toEqual([{ x: 16, y: 144 }, { x: 300, y: 80 }, { x: 584, y: 16 }])
  expect(plotTrend([-Number.MAX_VALUE, Number.MAX_VALUE])).toEqual([{ x: 16, y: 144 }, { x: 584, y: 16 }])
})

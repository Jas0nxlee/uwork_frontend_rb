import { readFileSync } from 'node:fs'
import { clientBundle } from '../tsdown.client.ts'

const notice = readFileSync(new URL('./licenses/UWork.notice.txt', import.meta.url), 'utf8')
const license = readFileSync(new URL('./licenses/UWork.Apache-2.0.txt', import.meta.url), 'utf8')

export default clientBundle(import.meta.dirname, ['lib/types/index.js'], {
  clientBanner: () => `/*!
${notice}
${license}
*/`,
})

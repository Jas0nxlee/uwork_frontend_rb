import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clientBundle } from '../tsdown.client.ts'

const notice = ['UWork.notice.txt', 'UWork.txt'].map(name =>
  readFileSync(join(import.meta.dirname, 'licenses', name), 'utf8')).join('\n')

export default clientBundle(import.meta.dirname, ['lib/types/index.js'], {
  clientBanner: () => ['//! UWork Office source license notices', ...notice.trimEnd().split('\n').map(line => `// ${line}`)].join('\n'),
})

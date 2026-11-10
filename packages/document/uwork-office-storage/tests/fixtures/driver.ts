/** File operations exercised after the real dsh profile reaches application readiness. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '../../src/index.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'

/** Services supplied by the profile and launcher. */
export const inject = ['uworkOfficeStorage', 'appReady', 'appExit']

/**
 * Run the file round trip without creating an Agent or requesting a model.
 * @param ctx - real profile Loader context.
 */
export function apply(ctx: Context): void {
  const exit = ctx.appExit!
  ctx.effect(() => ctx.appReady!.onReady(() => {
    void exercise(ctx).then(() => { exit(0) }, (error: unknown) => { console.error(error); exit(1) })
  }))
}

async function exercise(ctx: Context): Promise<void> {
  const session = Session.create(SessionId('office-loader'))
  const signal = new AbortController().signal
  const first = await ctx.uworkOfficeStorage.save(session, {
    path: '文档.docx', contentBase64: 'UEsA/w==', expected: { kind: 'createIfAbsent' },
  }, signal)
  const opened = await ctx.uworkOfficeStorage.read(session, '文档.docx', signal)
  if (opened.version !== first.version || Buffer.from(opened.data).toString('base64') !== 'UEsA/w==') {
    throw new Error('Loader Office source snapshot did not match publication.')
  }
  await ctx.uworkOfficeStorage.save(session, {
    path: '文档.docx', contentBase64: 'UEuAAAE=', expected: { kind: 'replaceIfVersion', version: opened.version },
  }, signal)
  try {
    await ctx.uworkOfficeStorage.save(session, {
      path: '文档.docx', contentBase64: 'UEsA/w==', expected: { kind: 'replaceIfVersion', version: opened.version },
    }, signal)
    throw new Error('Loader Office stale save overwrote a newer version.')
  } catch (error) {
    const failure = remoteErrorOf(error)
    if (failure?.code !== 'office-file/failed' || failure.details.reason !== 'FS_STALE_VERSION') throw error
  }
  const current = await ctx.uworkOfficeStorage.read(session, '文档.docx', signal)
  console.log(`office-loader:${Buffer.from(current.data).toString('base64')}`)
}

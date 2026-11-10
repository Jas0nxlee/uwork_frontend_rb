import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

type IdentityFailure = 'CONFIG' | 'PROTOCOL' | 'NETWORK' | 'HTTP' | 'UNAUTHORIZED' | 'STALE' | 'EXPIRED' | 'CALLBACK' | 'DISPOSED'
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'uwork-enterprise/failed': { reason: IdentityFailure; status?: number }
  }
}
/** Safe error identity: issuer bodies, tokens and callback URLs are never included. */
export class IdentityError extends RemoteError<'uwork-enterprise/failed'> {
  constructor(readonly reason: IdentityFailure, message: string, status?: number) {
    super('uwork-enterprise/failed', message, { reason, ...(status === undefined ? {} : { status }) })
    this.name = 'IdentityError'
  }
}

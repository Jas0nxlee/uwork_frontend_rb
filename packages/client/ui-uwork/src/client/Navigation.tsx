/** Product density around the native navigation; no duplicated navigation state. */
import type { ReactNode } from 'react'
import type { SidebarFrameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Navigation.module.css'

/** Keep drawer touch targets and the native rail while tightening expanded desktop navigation. */
export function UWorkNavigation({ collapsed, drawer, children }: SidebarFrameOwnerProps & { readonly children: ReactNode }): ReactNode {
  return <div className={css.frame} data-uwork-navigation={drawer ? 'drawer' : collapsed ? 'rail' : 'compact'}>
    {children}
  </div>
}

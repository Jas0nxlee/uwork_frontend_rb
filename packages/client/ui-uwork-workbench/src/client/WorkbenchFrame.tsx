/** Source UWork tab-strip geometry, applied without adding a containing block or remounting tab bodies. */
import type { ReactNode } from 'react'
import type { SidebarRightFrameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import css from './WorkbenchFrame.module.css'

/**
 * Preserve the native rightbar's retained children while scoping product visual variables.
 * @param props - committed panel presentation and unchanged docking tree.
 * @returns a layout-neutral product frame.
 */
export function WorkbenchFrame({ active, expanded, fullscreen, children }: SidebarRightFrameOwnerProps & { readonly children: ReactNode }) {
  return <div className={css.frame} data-uwork-workbench="" data-uwork-workbench-active={active || undefined}
    data-uwork-workbench-expanded={expanded || undefined} data-uwork-workbench-fullscreen={fullscreen || undefined}>
    {children}
  </div>
}

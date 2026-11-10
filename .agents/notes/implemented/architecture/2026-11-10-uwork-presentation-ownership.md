# Agent Note: UWork presentation over native UI owners

Status: implemented

English | [中文](2026-11-10-uwork-presentation-ownership.zh.md)

## Problem

The UWork product needs its neutral palette and compact navigation while retaining the native workspace, session, composer, keyboard, and mobile behavior. Replacing the sidebar plugin would also replace its child-seat declarations and navigation callbacks.

## Decision

[ui-uwork](../../../../packages/client/ui-uwork/README.md) installs one lifecycle-owned paired `theme.overrideTokens` layer. It maps the source UWork Zai palettes to existing semantic roles, follows light/dark/system preferences, and restores the underlying palette on withdrawal. It does not write theme preferences or replace status colors, focus indicators, or typography owners.

The native sidebar remains the unique `sidebar` owner and declares a root `sidebar.frame` HOC. Frame layers receive only `collapsed`, `drawer`, and the shell as `children`. The UWork layer changes the existing expanded desktop alignment variables; drawers and collapsed rails retain native geometry. The renderer's standard `display:contents` slot anchor remains present even without a frame contribution.

Brand and home artwork continue through native brand and hero slots. The conversation frame stays mounted across phases, so home decoration can disappear without replacing the composer. Native agent presets, session stores, approvals, and workbench presenters remain their existing owners.

## Alternatives considered

- Copying the source sidebar or conversation store would duplicate navigation and session authorities.
- Direct DOM theme mutations would bypass the native theme preference and layer lifetimes.
- Referencing private sidebar CSS classes would couple the product to implementation names instead of the existing alignment variables.

## Consequences

Product presentation can withdraw without removing the native navigation owner. Source artwork and palette provenance retain an Apache-2.0 notice. The theme and navigation slice does not establish complete migration of message, approval, or workbench page families; those require their own assembled-page evidence.

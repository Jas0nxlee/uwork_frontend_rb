---
description: 'Enterprise usage and subscription presentation'
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-usage

English | [中文](README.zh.md)

## Summary

Read-only enterprise usage panel with period and metric filters, request and token totals, success rates, daily aggregates, model distribution and subscription balances, organization and user display names, the public gateway endpoint and masked key metadata. Mount with the safe Host gateway service and the standard Client resources service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

The sidebar opens the native main panel. Aggregate data is read through `useResource`; identity changes withdraw previous account values before reading the new scope. Signed-out states show a sign-in prompt without fabricated zeros. Failed refreshes show a notice and an explicitly dated same-selection last success when the Host can verify its identity. Amounts retain unspecified accounting units, without currency symbols.

The panel supports all eight application locales, native keyboard-accessible filters and a refresh action. It adds no credential editing or key reveal controls.

## Understand the implementation

The standard resource registry owns subscriptions. The Remote stream supervisor clears data on carrier loss and reopens against the next Host generation; the panel keeps only filter selections in local state.

## Model Experience

None, as this package renders existing safe account and aggregate projections.

#### KV Cache effect

This package does not change model request prefixes.

## Known Limitations and Deferred Work

- Authenticated fixtures are synthetic. The trend plots observed values and retains an accessible data table. Accounting units and model share units remain unspecified until the upstream protocol supplies them.
### Dev Note

The Host identity stream controls resource invalidation; the Client does not poll or retain account data in a parallel store.

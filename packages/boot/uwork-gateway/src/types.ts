/** Host-only gateway request configuration and safe read projections. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Gateway key identifier admitted by the control plane. */
export type GatewayKeyId = Branded<'GatewayKeyId'>
/** Host identity scope; the owner cancels signal before switching accounts. */
export interface GatewaySession {
  readonly orgId: string
  readonly userId: string
  readonly generation: string
  readonly token: string
  readonly signal: AbortSignal
}
/** Explicit request limits, resolved by the composing Host. */
export interface GatewayConfig {
  /** Configured control-plane HTTPS origin; identity bearers never leave this origin. */
  readonly apiBaseUrl: string
  /** Exact deployment HTTPS origins allowed for advertised model endpoints. */
  readonly allowedModelEndpointOrigins: readonly string[]
  /** Deadline covering request headers and the complete response body. */
  readonly timeoutMs: number
  /** Maximum UTF-8 response body bytes before cancellation. */
  readonly maxResponseBytes: number
  /** Maximum records in any response collection. */
  readonly maxItems: number
}
/** Distinct failures safe to project without upstream content or credentials. */
export type GatewayFailureKind = 'unauthorized' | 'forbidden' | 'rate-limited' | 'http' | 'network' | 'timeout' | 'cancelled' | 'invalid'
/** A masked key record; never includes its secret. */
export interface GatewayKey {
  readonly id: GatewayKeyId
  readonly alias: string | null
  readonly maskedKey: string
  readonly status: string
}
/** A subscription whose amounts retain the server's unspecified accounting unit. */
export interface GatewaySubscription {
  readonly planId: string
  readonly planTitle: string
  readonly amountTotal: number
  readonly amountUsed: number
  readonly amountUnit: 'unspecified'
  readonly nextResetTime: number | null
  readonly status: string
}
/** Supported aggregate period. */
export type UsagePeriod = '7d' | 'month' | '30d'
/** Supported aggregate metric. */
export type UsageMetric = 'requests' | 'cost' | 'tokens'
/** Usage selection; force bypasses the server's aggregate cache. */
export interface UsageRequest { readonly period: UsagePeriod
  readonly metric: UsageMetric
  readonly force?: boolean }
/** Server aggregates; successRate uses a 0–1 fraction and cost has no asserted currency. */
export interface GatewayUsage {
  readonly period: UsagePeriod
  readonly metric: UsageMetric
  readonly from: string
  readonly until: string
  readonly costUnit: 'unspecified'
  readonly summary: {
    readonly requestCount: number
    readonly successCount: number
    readonly successRate: number
    readonly cost: number
    readonly averageCost: number
    readonly promptTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
    readonly cacheReadTokens: number
    readonly cacheCreationTokens: number
  }
  readonly trend: readonly { readonly date: string
    readonly requestCount: number
    readonly cost: number
    readonly tokens: number }[]
  readonly models: readonly { readonly model: string
    readonly requestCount: number
    readonly cost: number
    readonly share: number }[]
}
/** The explicit plan filter; unrestricted is independent of an empty list. */
export interface GatewayPlanModels { readonly models: readonly string[]
  readonly unrestricted: boolean
  readonly hasSubscription: boolean }

/** Explicit input modalities reported by the endpoint directory. */
export type GatewayModality = 'text' | 'image' | 'video' | 'audio' | 'pdf'
/** Explicit reasoning levels, ordered by the client's fixed semantic order. */
export type GatewayReasoningLevel = 'disabled' | 'enabled' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** Endpoint capability facts; absent fields remain unknown and do not imply selectability. */
export interface GatewayModel {
  readonly id: string
  readonly contextWindow?: number
  readonly maxOutputTokens?: number
  readonly inputModalities?: readonly GatewayModality[]
  readonly supportsVision?: boolean
  readonly supportsTools?: boolean
  readonly supportsReasoning?: boolean
  readonly reasoningLevels?: readonly GatewayReasoningLevel[]
}

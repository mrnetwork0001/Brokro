/**
 * Canonical domain types for Brokro.
 *
 * Every transition in the 6-step procurement graph and Attack Arena consumes
 * and produces strongly typed records so nothing moves on an unverified model string.
 */

export type KiteNetworkId = "testnet" | "mainnet";

export type KitePolicyErrorCode =
  | "session_rule_exceeded"
  | "session_total_exceeded"
  | "session_endpoint_forbidden"
  | "session_asset_forbidden"
  | "session_expired"
  | "payment_target_forbidden"
  | "payment_nonce_replay_detected";

export type SessionMode = "delegated" | "kpass" | "wallet";

/** One (network, asset) pair a mandate permits payment in. */
export interface AuthorizedAsset {
  caip2Network: string;
  assetAddress: string;
  symbol: string;
  decimals: number;
  /** False for testnet play-money, true when a payment moves real value. */
  realValue: boolean;
}

export interface SessionPolicy {
  sessionId: string;
  mode: SessionMode;
  taskSummary: string;
  ownerAddress: string;
  agentAddress: string;
  network: KiteNetworkId;
  caip2Network: "eip155:2368" | "eip155:2366";
  assetSymbol: "pieUSD" | "USDC.e";
  assetAddress: `0x${string}`;
  /**
   * The complete set of (network, asset) pairs this mandate authorizes. A 402
   * challenge matching none of these is refused with `session_asset_forbidden`
   * before any signature is produced. The home Kite asset is always first.
   */
  allowedAssets: AuthorizedAsset[];
  maxAmountPerTxUsd: number;
  maxTotalAmountUsd: number;
  spentUsd: number;
  txCount: number;
  createdAt: string;
  expiresAt: string;
  allowedHosts: string[];
  /**
   * How the owner actually authorized this mandate. "none" is a demo session
   * nobody signed for; it is the honest default, because a field that always
   * reads "verified" tells a reader nothing.
   */
  ownerAuthorization: "none" | "eip191-wallet-signature" | "kite-passport-passkey";
  /**
   * True only for a mandate approved through Kite Passport's passkey flow.
   * An EIP-191 wallet signature is owner authorization but is NOT a passkey,
   * so it does not set this.
   */
  passkeyVerified: boolean;
  walletSignature?: string;
}

export interface VendorManifest {
  id: string;
  slug: string;
  name: string;
  provider: string;
  category: "registry" | "security" | "osint" | "market" | "rogue";
  endpoint: string;
  wellKnownUrl: string;
  advertisedPriceUsd: number;
  /**
   * Actual atomic price demanded when the HTTP 402 challenge fires. Honest
   * vendors match advertisedPriceUsd; bait-and-switch rogue vendors spike here.
   */
  actualChallengePriceUsd: number;
  network: KiteNetworkId;
  payTo: `0x${string}`;
  description: string;
  deliverableFields: string[];
  slaMs: number;
  source: "brokr-x402-live" | "kite-catalog" | "dolphin-x402-node" | "adversarial-fixture";
  adversarialType?: "prompt_injection" | "price_spike";
}

export interface GuardReport {
  vendorId: string;
  vendorName: string;
  admitted: boolean;
  severity: "clean" | "low" | "high";
  deterministicHits: string[];
  servGuardRan: boolean;
  servFlagged: boolean;
  reason: string;
}

export interface PlannedVendorSelection {
  vendorId: string;
  role: "primary" | "fallback";
  expectedCostUsd: number;
  purpose: string;
  replacesVendorId?: string;
}

export interface BasketPlan {
  mandateIntent: string;
  selected: PlannedVendorSelection[];
  estimatedPrimarySpendUsd: number;
  remainingCapAfterPrimaryUsd: number;
  coverageDimensions: string[];
  rationale: string;
  reasoningSummary: string[];
}

export interface SettlementReceipt {
  receiptId: string;
  vendorId: string;
  vendorName: string;
  endpoint: string;
  httpStatus: number;
  advertisedUsd: number;
  challengedUsd: number;
  settledUsd: number;
  assetSymbol: "pieUSD" | "USDC.e";
  caip2Network: "eip155:2368" | "eip155:2366";
  outcome: "settled" | "blocked_policy" | "failed";
  executionEngine: "pieverse-x402-exact" | "kpass-cli" | "local-ledger-fallback";
  onChain: boolean;
  txHash?: string;
  explorerUrl?: string;
  payer?: string;
  payTo: string;
  nonce?: string;
  policyErrorCode?: KitePolicyErrorCode;
  policyHint?: string;
  reroutedToVendorId?: string;
  latencyMs: number;
  timestamp: string;
  payload?: Record<string, unknown>;
  /** True when the counterparty is an independent third-party x402 business. */
  externalMerchant?: boolean;
  /** CAIP-2 chain this purchase actually settled on (may differ from Kite home). */
  settlementNetwork?: string;
  settlementAssetSymbol?: string;
}

export interface CitedFinding {
  findingId: string;
  dimension: string;
  status: "verified" | "warning" | "critical" | "indeterminate";
  claim: string;
  vendorId: string;
  fieldPath: string;
  quotedEvidence: string;
}

export interface SynthesizedDossier {
  headline: string;
  executiveDecision: "proceed" | "proceed_with_conditions" | "hold";
  riskScore: number;
  executiveSummary: string;
  findings: CitedFinding[];
  recommendedConditions: string[];
  shadowAgentTools: string[];
}

export interface VerificationReport {
  passed: boolean;
  citationsChecked: number;
  /** Findings whose cited `fieldPath` resolved to a real key on the paid payload. */
  citationsResolved: number;
  /** Findings whose `quotedEvidence` actually restates the resolved value. */
  citationsValueMatched: number;
  unresolvedCitations: string[];
  /** Findings that cited a real field but misquoted its value. */
  misquotedCitations: string[];
  budgetInvariantPassed: boolean;
  perTxInvariantPassed: boolean;
  quarantinedVendorReferenced: boolean;
  indeterminateCarriedDecision: boolean;
  receiptDigestSha256: string;
  notes: string[];
}

export interface WholesaleMargin {
  wholesalePriceUsd: number;
  upstreamSpendUsd: number;
  servInferenceUsd: number;
  totalCostUsd: number;
  netMarginUsd: number;
  grossMarginPct: number;
  unitPositive: boolean;
}

export interface ReppoAuditRecord {
  evalId: string;
  status: "PENDING" | "SETTLED" | "UNCONFIGURED" | "ERROR";
  settlementMinutes: number;
  submittedAt: string;
  score?: number;
  decision?: "accept" | "revise" | "reject";
  confidence?: "high" | "medium" | "low";
  route?: "auto-ship" | "review" | "block";
  critique?: string;
  consoleUrl: string;
  note?: string;
}

export type StepName =
  | "screen_catalog"
  | "plan_basket"
  | "settle_x402"
  | "cross_examine"
  | "verify_dossier"
  | "anchor_audit";

export interface StepTelemetry {
  step: StepName;
  title: string;
  engine: string;
  model?: string;
  servTools?: string[];
  status: "running" | "completed" | "blocked" | "error";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUsd?: number;
  repairs?: number;
  inputDigest?: string;
  summary: string;
  detail?: unknown;
}

export interface ProcurementMandate {
  id: string;
  title: string;
  targetEntity: string;
  targetIdentifier: string;
  counterpartyAmountUsd: number;
  prompt: string;
  requiredDimensions: string[];
}

export interface ProcurementRun {
  runId: string;
  createdAt: string;
  completedAt?: string;
  status: "running" | "completed" | "halted" | "failed";
  callerType: "interactive-desk" | "x402-wholesale-buyer";
  mandate: ProcurementMandate;
  includeAdversarial: boolean;
  submitToReppo: boolean;
  session: SessionPolicy;
  steps: StepTelemetry[];
  guards: GuardReport[];
  plan?: BasketPlan;
  receipts: SettlementReceipt[];
  dossier?: SynthesizedDossier;
  verification?: VerificationReport;
  margin: WholesaleMargin;
  reppoAudit?: ReppoAuditRecord;
  wholesalePaymentTxHash?: string;
  error?: string;
}

export interface LiveCatalogProbe {
  serviceId: string;
  name: string;
  baseUrl: string;
  wellKnownUrl: string;
  probeEndpoint: string;
  source: "ksearch-cli" | "x402-manifest";
  reachable: boolean;
  httpStatus: number;
  probedPriceUsd: number | null;
  probedNetworks: string[];
  payTo: string | null;
  servGuardPassed: boolean;
  servGuardReason: string;
  kitePolicyAdmitted: boolean;
  kitePolicyReason: string;
  latencyMs: number;
}

export interface NaiveAgentRun {
  model: string;
  servGuardActive: false;
  kiteSessionActive: false;
  selectedVendorIds: string[];
  fellForPromptInjection: boolean;
  promptInjectionEvidence: string | null;
  attemptedPayTo: string[];
  /** Sum of the REAL HTTP 402 challenge amounts this plan would have signed. */
  attemptedSpendUsd: number;
  maxSpikeHitUsd: number;
  /** Observed challenge dollars whose payee is a burn/attacker sink. */
  fundsDirectedToAttackerUsd: number;
  /** Whether the poisoned listing entered the agent's planning context at all. */
  selectedPoisonedVendor: boolean;
  /** Per-vendor record of what the live 402 header actually demanded. */
  observedChallenges: Array<{
    vendorId: string;
    advertisedUsd: number;
    challengedUsd: number;
    payTo: string;
    /** True when the figure came from a live header rather than the manifest. */
    headerObserved: boolean;
  }>;
  unverifiedClaimsCount: number;
  outcome: "COMPROMISED_DRAINED" | "OVERPAID_SPIKE" | "PARTIAL_RISK";
  summary: string;
  rawPlanExcerpt: string;
  durationMs: number;
}

export interface ArenaBenchmarkResult {
  benchmarkId: string;
  createdAt: string;
  mandateTitle: string;
  sessionCapPerTxUsd: number;
  sessionCapTotalUsd: number;
  naiveAgent: NaiveAgentRun;
  brokroAgent: ProcurementRun;
  delta: {
    naiveExposureUsd: number;
    naiveFundsToAttackerUsd: number;
    /** What Brokro actually, legitimately spent under its session policy. */
    brokroAuthorizedSpendUsd: number;
    /** Measured, not asserted: Brokro dollars that reached a burn sink. */
    brokroLossUsd: number;
    savedUsd: number;
    injectionsQuarantined: number;
    spikesBlocked: number;
    citationsVerifiedPct: number;
    wholesaleNetMarginUsd: number;
  };
}

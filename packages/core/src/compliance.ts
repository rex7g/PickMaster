/**
 * ComplianceEngine (§31): KYC, sanctions, geofencing, jurisdiction rules.
 * MarketEligibility(userJurisdiction, marketJurisdiction, regulatoryStatus,
 * userRisk) → ALLOWED | RESTRICTED | BLOCKED | REQUIRES_REVIEW.
 *
 * The jurisdiction matrix below is a placeholder: the authoritative list
 * comes from the legal/regulatory work, which is handled outside this
 * repository. A decentralized architecture does not exempt PickMaster from
 * regulation, including DR requirements for internet gaming operations, so
 * these values must be reviewed before enabling real money.
 */
import type { EligibilityResult, Market, UserProfile } from "./types";

/** Jurisdictions where operating is blocked pending legal review. */
const BLOCKED_JURISDICTIONS = new Set(["US", "KP", "IR", "CU", "SY"]);
/** Jurisdictions requiring case-by-case review. */
const REVIEW_JURISDICTIONS = new Set(["VE", "NI"]);

export interface EligibilityInput {
  user: UserProfile;
  market: Market;
}

export function marketEligibility({ user, market }: EligibilityInput): EligibilityResult {
  if (user.sanctioned) return "BLOCKED";
  if (BLOCKED_JURISDICTIONS.has(user.jurisdiction)) return "BLOCKED";
  if (!user.kycVerified || !user.ageVerified) return "RESTRICTED";
  if (REVIEW_JURISDICTIONS.has(user.jurisdiction)) return "REQUIRES_REVIEW";
  if (market.complianceStatus !== "APPROVED") return "RESTRICTED";
  if (user.riskScore >= 0.8) return "REQUIRES_REVIEW";
  return "ALLOWED";
}

/** Gate applied before matching (AC-004, AC-011). */
export function assertCanTrade(user: UserProfile, market: Market): void {
  const result = marketEligibility({ user, market });
  if (result !== "ALLOWED") {
    throw new ComplianceError(result, user.jurisdiction, market.id);
  }
}

export class ComplianceError extends Error {
  constructor(
    public readonly result: EligibilityResult,
    public readonly jurisdiction: string,
    public readonly marketId: string,
  ) {
    super(`Operación ${result} para jurisdicción ${jurisdiction} en mercado ${marketId}.`);
  }
}

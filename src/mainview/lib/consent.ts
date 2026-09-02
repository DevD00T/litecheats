// Bump the suffix (e.g. -v2) to force every visitor to re-accept after a
// material change to the Terms, Privacy Policy, or DPDP Compliance Policy.
export const CONSENT_STORAGE_KEY = "litecheats-consent-accepted-v1";

export function hasAcceptedConsent(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "true";
	} catch {
		return true;
	}
}

import { Resend } from "resend";

const RESEND_API_KEY = Bun.env.RESEND_API_KEY?.trim();
/**
 * Every one-time code emailed to a customer comes from the support address,
 * whatever RESEND_FROM_EMAIL says, so a code never arrives from a sandbox or
 * unfamiliar sender. litecheats.com must be a verified domain in Resend.
 */
export const CUSTOMER_OTP_FROM_EMAIL = "Litecheats Enquiry <support@litecheats.com>";
const RESEND_FROM_EMAIL = Bun.env.RESEND_FROM_EMAIL?.trim() || CUSTOMER_OTP_FROM_EMAIL;
const PUBLIC_APP_URL = (Bun.env.PUBLIC_APP_URL?.trim() || "http://localhost:8080").replace(
	/\/+$/,
	"",
);
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function buildVerificationEmailHtml(fullName: string, verifyUrl: string): string {
	return `
<div style="font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="background:#111827;color:#ffffff;padding:20px 24px;">
      <h1 style="margin:0;font-size:18px;line-height:1.3;">Verify your Litecheats account</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;">Hi ${escapeHtml(fullName || "there")},</p>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;">
        Confirm this is your email address to finish setting up your Litecheats account.
      </p>
      <p style="margin:0 0 24px 0;">
        <a href="${verifyUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">
          Verify email address
        </a>
      </p>
      <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">
        Or paste this link into your browser:
      </p>
      <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all;">${verifyUrl}</p>
      <p style="margin:24px 0 0 0;font-size:12px;color:#6b7280;">
        This link expires in 24 hours. If you didn't create a Litecheats account, you can ignore this email.
      </p>
    </div>
  </div>
</div>
`.trim();
}

function buildVerificationEmailText(fullName: string, verifyUrl: string): string {
	return [
		`Hi ${fullName || "there"},`,
		"",
		"Confirm this is your email address to finish setting up your Litecheats account:",
		verifyUrl,
		"",
		"This link expires in 24 hours. If you didn't create a Litecheats account, you can ignore this email.",
	].join("\n");
}

export async function sendVerificationEmail(
	to: string,
	fullName: string,
	verifyUrl: string,
): Promise<void> {
	if (!resend) {
		console.warn(
			`[email] RESEND_API_KEY not set; skipping verification email to ${to}. Verify URL: ${verifyUrl}`,
		);
		return;
	}

	try {
		const result = await resend.emails.send({
			from: RESEND_FROM_EMAIL,
			to,
			subject: "Verify your Litecheats account",
			html: buildVerificationEmailHtml(fullName, verifyUrl),
			text: buildVerificationEmailText(fullName, verifyUrl),
		});

		if (result.error) {
			console.error(
				`[email] Failed to send verification email to ${to}:`,
				result.error,
				`Verify URL: ${verifyUrl}`,
			);
		}
	} catch (error) {
		console.error(
			`[email] Failed to send verification email to ${to}:`,
			error,
			`Verify URL: ${verifyUrl}`,
		);
	}
}

interface RenewalWarningParams {
	to: string;
	fullName: string;
	planName: string;
	renewsAt: Date;
	daysRemaining: number;
	amountDue: number;
	walletBalance: number;
	shortfall: number;
	paymentMode: "wallet" | "checkout";
	autoRenew: boolean;
	/**
	 * Which of the app's domains this account uses. Links point back there, so a
	 * customer who signed up on one domain is never sent to another.
	 */
	appOrigin?: string | null;
}

function formatMoney(paise: number): string {
	return new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: "INR",
		maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
	}).format(paise / 100);
}

function renewalAction(params: RenewalWarningParams): string {
	if (params.paymentMode !== "wallet" || !params.autoRenew) {
		return "Your account is set to pay manually, so this term will not renew on its own. Switch to wallet auto-renew or complete checkout before the date above.";
	}
	if (params.shortfall > 0) {
		return `Your wallet is short by ${formatMoney(params.shortfall)}. Load up your wallet or change your payment mode to continue using RDOS and its services.`;
	}
	return "Your wallet covers this renewal, so there is nothing for you to do. We will debit it automatically.";
}

export async function sendRenewalWarningEmail(params: RenewalWarningParams): Promise<void> {
	const appOrigin = (params.appOrigin || PUBLIC_APP_URL).replace(/\/+$/, "");
	const billingUrl = `${appOrigin}/billing`;
	const renewsOn = params.renewsAt.toLocaleDateString("en-IN", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	const action = renewalAction(params);
	const subject =
		params.shortfall > 0 || params.paymentMode !== "wallet" || !params.autoRenew
			? `Action needed: ${params.planName} renews in ${params.daysRemaining} days`
			: `${params.planName} renews in ${params.daysRemaining} days`;

	if (!resend) {
		console.warn(
			`[email] RESEND_API_KEY not set; skipping renewal warning to ${params.to}. ${subject} — ${action}`,
		);
		return;
	}

	const html = `
<div style="font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="background:#111827;color:#ffffff;padding:20px 24px;">
      <h1 style="margin:0;font-size:18px;line-height:1.3;">${escapeHtml(params.planName)} renews in ${params.daysRemaining} days</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;">Hi ${escapeHtml(params.fullName || "there")},</p>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;">
        Your <strong>${escapeHtml(params.planName)}</strong> plan renews on <strong>${escapeHtml(renewsOn)}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 20px 0;">
        <tr><td style="padding:6px 0;color:#6b7280;">Amount due</td><td style="padding:6px 0;text-align:right;">${formatMoney(params.amountDue)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Wallet balance</td><td style="padding:6px 0;text-align:right;">${formatMoney(params.walletBalance)}</td></tr>
        ${
					params.shortfall > 0
						? `<tr><td style="padding:6px 0;color:#b91c1c;">Shortfall</td><td style="padding:6px 0;text-align:right;color:#b91c1c;font-weight:600;">${formatMoney(params.shortfall)}</td></tr>`
						: ""
				}
      </table>
      <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;">${escapeHtml(action)}</p>
      <p style="margin:0 0 24px 0;">
        <a href="${billingUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">
          Open billing
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all;">${billingUrl}</p>
    </div>
  </div>
</div>
`.trim();

	const text = [
		`Hi ${params.fullName || "there"},`,
		"",
		`Your ${params.planName} plan renews on ${renewsOn} (${params.daysRemaining} days away).`,
		"",
		`Amount due:     ${formatMoney(params.amountDue)}`,
		`Wallet balance: ${formatMoney(params.walletBalance)}`,
		...(params.shortfall > 0 ? [`Shortfall:      ${formatMoney(params.shortfall)}`] : []),
		"",
		action,
		"",
		billingUrl,
	].join("\n");

	try {
		const result = await resend.emails.send({
			from: RESEND_FROM_EMAIL,
			to: params.to,
			subject,
			html,
			text,
		});
		if (result.error) {
			console.error(`[email] Failed to send renewal warning to ${params.to}:`, result.error);
		}
	} catch (error) {
		console.error(`[email] Failed to send renewal warning to ${params.to}:`, error);
	}
}

/** Sends the signup verification code, always from CUSTOMER_OTP_FROM_EMAIL. */
export async function sendVerificationCodeEmail(
	to: string,
	fullName: string,
	code: string,
	expiresInMinutes: number,
): Promise<void> {
	const subject = `${code} is your Litecheats verification code`;

	if (!resend) {
		console.warn(
			`[email] RESEND_API_KEY not set; skipping verification code to ${to}. Code: ${code}`,
		);
		return;
	}

	const html = `
<div style="font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="background:#111827;color:#ffffff;padding:20px 24px;">
      <h1 style="margin:0;font-size:18px;line-height:1.3;">Confirm your email address</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;">Hi ${escapeHtml(fullName || "there")},</p>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;">
        Enter this code to finish setting up your Litecheats account:
      </p>
      <div style="margin:0 0 20px 0;padding:18px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
        <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#111827;">${escapeHtml(code)}</span>
      </div>
      <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6b7280;">
        This code expires in ${expiresInMinutes} minutes and can only be used once.
      </p>
      <p style="margin:0;font-size:12px;color:#6b7280;">
        If you didn't create a Litecheats account, you can ignore this email. Never share this code
        with anyone — our team will never ask you for it.
      </p>
    </div>
  </div>
</div>
`.trim();

	const text = [
		`Hi ${fullName || "there"},`,
		"",
		"Enter this code to finish setting up your Litecheats account:",
		"",
		`    ${code}`,
		"",
		`This code expires in ${expiresInMinutes} minutes and can only be used once.`,
		"",
		"If you didn't create a Litecheats account, you can ignore this email.",
		"Never share this code with anyone - our team will never ask you for it.",
	].join("\n");

	try {
		const result = await resend.emails.send({
			from: CUSTOMER_OTP_FROM_EMAIL,
			to,
			subject,
			html,
			text,
		});
		if (result.error) {
			console.error(`[email] Failed to send verification code to ${to}:`, result.error);
		}
	} catch (error) {
		console.error(`[email] Failed to send verification code to ${to}:`, error);
	}
}

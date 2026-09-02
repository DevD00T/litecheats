import { Resend } from "resend";

const RESEND_API_KEY = Bun.env.RESEND_API_KEY?.trim();
const RESEND_FROM_EMAIL =
	Bun.env.RESEND_FROM_EMAIL?.trim() || "Litecheats Technologies <onboarding@resend.dev>";
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

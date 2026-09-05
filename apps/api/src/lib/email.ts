import { Resend } from "resend";
import { config } from "../config.js";
import { logger } from "./logger.js";

const log = logger.child({ lib: "email" });

/**
 * `text` is optional but worth passing. An HTML-only message with no plain-text
 * alternative is a spam signal: the operator signup notice landed in Gmail's
 * spam folder on 2026-09-05 while the older, plainer notices did not.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<boolean> {
  if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
    log.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not configured — skipping email");
    return false;
  }

  try {
    const resend = new Resend(config.RESEND_API_KEY);
    await resend.emails.send({
      from: `Notipo <${config.RESEND_FROM_EMAIL}>`,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    });
    log.info({ to, subject }, "Email sent");
    return true;
  } catch (err) {
    log.error({ err, to, subject }, "Failed to send email");
    return false;
  }
}

import { Resend } from "resend";
import { config } from "../config.js";
import { logger } from "./logger.js";

const log = logger.child({ lib: "email" });

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
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
    });
    log.info({ to, subject }, "Email sent");
    return true;
  } catch (err) {
    log.error({ err, to, subject }, "Failed to send email");
    return false;
  }
}

use crate::db::{self, DbPool};
use chrono::Local;
use lettre::message::header::ContentType;
use lettre::message::{MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use reqwest::Client;
use rusqlite::params;
use serde_json::json;
use tauri::{command, State};

// ─────────────────────────────────────────────────────────────────────────────
// Inline image attached via CID (Content-ID) – works in ALL email clients
// including Gmail which strips data: URIs.
// ─────────────────────────────────────────────────────────────────────────────

struct InlineImage {
    /// The CID value WITHOUT angle brackets, e.g. "qr@smartgate"
    cid: String,
    /// Raw image bytes
    data: Vec<u8>,
    /// MIME type, e.g. "image/png"
    mime_type: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal email payload (provider-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

struct EmailPayload {
    to_email: String,
    to_name: String,
    subject: String,
    html_content: String,
    from_email: String,
    from_name: String,
    /// Inline images referenced via cid: in the HTML
    inline_images: Vec<InlineImage>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Brevo (HTTP REST) transport
// ─────────────────────────────────────────────────────────────────────────────

async fn send_via_brevo(pool: &DbPool, payload: &EmailPayload) -> Result<(), String> {
    let mut api_key = db::get_setting(pool, "brevo_api_key")
        .unwrap_or(None)
        .unwrap_or_default();

    if api_key.is_empty() {
        api_key = std::env::var("BREVO_API_KEY").unwrap_or_else(|_| "".to_string());
    }

    if api_key.is_empty() {
        return Err(
            "Brevo API Key not configured. Please add it in System Configuration.".to_string(),
        );
    }

    // Build inline attachments for Brevo (referenced in HTML via cid:)
    let mut brevo_body = json!({
        "sender": { "name": payload.from_name, "email": payload.from_email },
        "to": [{ "email": payload.to_email, "name": payload.to_name }],
        "subject": payload.subject,
        "htmlContent": payload.html_content
    });

    if !payload.inline_images.is_empty() {
        let attachments: Vec<serde_json::Value> = payload.inline_images.iter().map(|img| {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &img.data);
            json!({
                "name": format!("{}.png", img.cid),
                "content": b64,
                "contentId": img.cid
            })
        }).collect();
        brevo_body["attachment"] = json!(attachments);
    }

    let client = Client::new();
    let resp = client
        .post("https://api.brevo.com/v3/smtp/email")
        .header("api-key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&brevo_body)
        .send()
        .await;

    match resp {
        Ok(response) => {
            if response.status().is_success() {
                Ok(())
            } else {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                Err(format!(
                    "Brevo send failed. Status: {}, Response: {}",
                    status, text
                ))
            }
        }
        Err(e) => Err(format!("Request to Brevo failed: {}", e)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMTP (lettre) transport
// ─────────────────────────────────────────────────────────────────────────────

async fn send_via_smtp(pool: &DbPool, payload: &EmailPayload) -> Result<(), String> {
    let host = db::get_setting(pool, "smtp_host")
        .unwrap_or(None)
        .unwrap_or_default();
    let port_str = db::get_setting(pool, "smtp_port")
        .unwrap_or(None)
        .unwrap_or_else(|| "587".to_string());
    let username = db::get_setting(pool, "smtp_username")
        .unwrap_or(None)
        .unwrap_or_default();
    let password = db::get_setting(pool, "smtp_password")
        .unwrap_or(None)
        .unwrap_or_default();

    if host.is_empty() {
        return Err(
            "SMTP host is not configured. Please fill in the SMTP settings in System Configuration.".to_string(),
        );
    }
    if username.is_empty() {
        return Err(
            "SMTP username is not configured. Please fill in the SMTP settings in System Configuration.".to_string(),
        );
    }

    let port: u16 = port_str.parse().unwrap_or(587);

    // Build the From / To header addresses
    let from_addr = format!("{} <{}>", payload.from_name, payload.from_email)
        .parse::<lettre::message::Mailbox>()
        .map_err(|e| format!("Invalid sender address: {}", e))?;

    let to_addr = format!("{} <{}>", payload.to_name, payload.to_email)
        .parse::<lettre::message::Mailbox>()
        .map_err(|e| format!("Invalid recipient address: {}", e))?;

    // Build email – plain HTML or multipart/related (when inline images are present)
    let email = if payload.inline_images.is_empty() {
        // Simple single-part HTML email
        Message::builder()
            .from(from_addr)
            .to(to_addr)
            .subject(&payload.subject)
            .header(ContentType::TEXT_HTML)
            .body(payload.html_content.clone())
            .map_err(|e| format!("Failed to build email: {}", e))?
    } else {
        // multipart/related: HTML body + CID-referenced inline images
        let html_part = SinglePart::builder()
            .header(ContentType::TEXT_HTML)
            .body(payload.html_content.clone());

        let mut related = MultiPart::related().singlepart(html_part);

        for img in &payload.inline_images {
            let img_ct = img.mime_type
                .parse::<ContentType>()
                .unwrap_or(ContentType::parse("image/png").unwrap());

            // Content-ID must be wrapped in angle brackets per RFC 2392
            let cid_header = lettre::message::header::ContentId::from(
                format!("<{}>", img.cid)
            );

            let img_part = SinglePart::builder()
                .header(img_ct)
                .header(cid_header)
                .body(img.data.clone());

            related = related.singlepart(img_part);
        }

        Message::builder()
            .from(from_addr)
            .to(to_addr)
            .subject(&payload.subject)
            .multipart(related)
            .map_err(|e| format!("Failed to build multipart email: {}", e))?
    };

    let creds = Credentials::new(username, password);

    // Port 465 → implicit TLS (relay); anything else → STARTTLS
    if port == 465 {
        let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(port)
            .credentials(creds)
            .build();
        mailer
            .send(email)
            .await
            .map_err(|e| format!("SMTP send failed: {}", e))?;
    } else {
        let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
            .map_err(|e| format!("SMTP STARTTLS error: {}", e))?
            .port(port)
            .credentials(creds)
            .build();
        mailer
            .send(email)
            .await
            .map_err(|e| format!("SMTP send failed: {}", e))?;
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified dispatcher – routes to SMTP or Brevo based on the DB setting
// ─────────────────────────────────────────────────────────────────────────────

async fn send_email(pool: &DbPool, payload: EmailPayload) -> Result<(), String> {
    let provider = db::get_setting(pool, "email_provider")
        .unwrap_or(None)
        .unwrap_or_else(|| "smtp".to_string());

    match provider.to_lowercase().as_str() {
        "brevo" => send_via_brevo(pool, &payload).await,
        _ => send_via_smtp(pool, &payload).await, // "smtp" is the default
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public email functions (same API as before, now provider-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

pub async fn send_verification_otp_email(
    pool: &DbPool,
    email: &str,
    full_name: &str,
    otp_code: &str,
) -> Result<(), String> {
    let requested_at = Local::now();
    let requested_at_display = requested_at.format("%B %d, %Y at %I:%M:%S %p").to_string();
    let requested_at_subject = requested_at.format("%I:%M %p").to_string();
    let transaction_id = format!("OTP-{}", requested_at.format("%Y%m%d%H%M%S"));

    let html_content = format!(
        "<html>\
        <body style=\"margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, sans-serif; color: #0f172a;\">\
            <div style=\"max-width: 640px; margin: 0 auto; padding: 24px 16px;\">\
                <div style=\"background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;\">\
                    <div style=\"background-color: #0f172a; padding: 24px 28px; text-align: center;\">\
                        <div style=\"font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 6px;\">Smart Gate - Security Verification</div>\
                        <div style=\"font-size: 13px; color: #cbd5e1; letter-spacing: 0.06em; text-transform: uppercase;\">Account Activation Notice</div>\
                    </div>\
                    <div style=\"padding: 28px;\">\
                        <p style=\"margin: 0 0 16px; font-size: 18px; font-weight: 700; color: #0f172a;\">Hello {},</p>\
                        <p style=\"margin: 0 0 18px; font-size: 15px; line-height: 1.7; color: #334155;\">Your account has been created. Use the verification code below to secure your identity and set your permanent password.</p>\
                        <div style=\"margin: 0 0 22px; border-radius: 16px; background-color: #1e293b; border: 1px solid #0f172a; padding: 22px; text-align: center;\">\
                            <div style=\"margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #cbd5e1;\">6-Digit Verification Code</div>\
                            <div style=\"font-size: 34px; font-weight: 700; letter-spacing: 0.22em; color: #ffffff;\">{}</div>\
                        </div>\
                        <div style=\"margin: 0 0 18px; padding: 16px 18px; border-radius: 14px; background-color: #f8fafc; border: 1px solid #cbd5e1;\">\
                            <p style=\"margin: 0; font-size: 14px; line-height: 1.7; color: #334155;\">For security, this code was requested at <span style=\"font-weight: 700; color: #0f172a;\">{}</span> and will expire in <span style=\"font-weight: 700; color: #0f172a;\">15 minutes</span>.</p>\
                        </div>\
                        <p style=\"margin: 0 0 18px; font-size: 14px; line-height: 1.7; color: #475569;\">Enter the code together with your new permanent password to complete account activation. If you did not request this security verification, please contact your System Administrator immediately.</p>\
                        <div style=\"margin-top: 22px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.6; color: #64748b; text-align: center;\">\
                            Transaction ID: {} | Processed at: {}\
                        </div>\
                    </div>\
                </div>\
            </div>\
        </body>\
        </html>",
        full_name, otp_code, requested_at_display, transaction_id, requested_at_display
    );

    // Resolve the "from" address: prefer smtp_from_name/smtp_username if SMTP is active
    let from_email = resolve_from_email(pool);
    let from_name = resolve_from_name(pool, "Smart Gate - PLP");

    send_email(
        pool,
        EmailPayload {
            to_email: email.to_string(),
            to_name: full_name.to_string(),
            subject: format!("Smart Gate Verification Code [{}]", requested_at_subject),
            html_content,
            from_email,
            from_name,
            inline_images: vec![],
        },
    )
    .await
}

#[command]
pub async fn send_visitor_qr(
    state: State<'_, DbPool>,
    id_number: String,
) -> Result<String, String> {
    // 1. Get visitor info from DB (joining persons and visitors)
    let conn = state
        .get()
        .map_err(|e| format!("DB connection error: {}", e))?;

    let info_result: Result<(String, String, String, String, Option<String>), _> = conn.query_row(
        "SELECT p.first_name, p.last_name, v.purpose_of_visit, v.person_to_visit,
                (SELECT contact_value FROM person_contacts 
                 WHERE person_id = p.person_id AND contact_type = 'email' 
                 ORDER BY is_primary DESC LIMIT 1) as email
         FROM persons p 
         JOIN visitors v ON p.person_id = v.person_id 
         WHERE p.id_number = ?1",
        params![id_number],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    );

    let (first_name, last_name, purpose, person_to_visit, email_opt) = match info_result {
        Ok(res) => res,
        Err(_) => return Err(format!("Visitor with ID {} not found", id_number)),
    };

    // If no email, gracefully return without error.
    let email = match email_opt {
        Some(e) if !e.trim().is_empty() => e.trim().to_string(),
        _ => return Ok("No email provided. Skipped sending.".to_string()),
    };

    let visitor_name = format!("{} {}", first_name, last_name);

    let provider = db::get_setting(&state, "email_provider")
        .unwrap_or(None)
        .unwrap_or_else(|| "smtp".to_string());

    let is_brevo = provider.to_lowercase() == "brevo";

    // 2. Setup the image source and inline image array based on active provider.
    // Brevo does not support CID inline images (refuses to render them), but since Brevo
    // has extremely high sender trust, external URLs (api.qrserver.com) work flawlessly without blocking.
    // SMTP has no sender reputation, so Gmail blocks external URLs. We must use CID (inline) for SMTP.
    let (qr_src, inline_images) = if is_brevo {
        let qr_url = format!(
            "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={}",
            id_number
        );
        (qr_url, vec![])
    } else {
        let qr_bytes = qrcode_generator::to_png_to_vec(
            &id_number,
            qrcode_generator::QrCodeEcc::Medium,
            300,
        )
        .map_err(|e| format!("QR code generation failed: {}", e))?;

        let qr_cid = "qr@smartgate";
        (format!("cid:{}", qr_cid), vec![InlineImage {
            cid: qr_cid.to_string(),
            data: qr_bytes,
            mime_type: "image/png".to_string(),
        }])
    };

    let processed_at = Local::now();
    let processed_at_display = processed_at.format("%B %d, %Y at %I:%M:%S %p").to_string();

    let html_content = format!(
        "<html>\
        <body style=\"margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, sans-serif; color: #0f172a;\">\
            <div style=\"max-width: 640px; margin: 0 auto; padding: 24px 16px;\">\
                <div style=\"background-color: #ffffff; border: 1px solid #dbeafe; border-radius: 18px; overflow: hidden;\">\
                    <div style=\"background-color: #0f766e; padding: 24px 28px; text-align: center;\">\
                        <div style=\"font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 6px;\">Pamantasan ng Lungsod ng Pasig | Smart Gate</div>\
                        <div style=\"font-size: 13px; color: #ccfbf1; letter-spacing: 0.08em; text-transform: uppercase;\">Digital Visitor Pass</div>\
                    </div>\
                    <div style=\"padding: 28px;\">\
                        <div style=\"margin-bottom: 16px; text-align: center; font-size: 15px; line-height: 1.7; color: #334155;\">\
                            Welcome to Smart Gate. Your visitor registration has been completed successfully.\
                        </div>\
                        <div style=\"margin-bottom: 20px; text-align: center;\">\
                            <div style=\"font-size: 28px; font-weight: 700; color: #0f172a; line-height: 1.25;\">{}</div>\
                            <div style=\"margin-top: 8px; font-size: 22px; font-weight: 700; color: #0f766e; letter-spacing: 0.04em;\">VIS-ID: {}</div>\
                        </div>\
                        <div style=\"margin: 0 0 18px; padding: 16px 18px; border-radius: 14px; background-color: #ecfeff; border: 1px solid #99f6e4; text-align: center; font-size: 15px; font-weight: 700; line-height: 1.7; color: #115e59;\">\
                            Present this QR code at the scanner upon exit. A digital copy has been delivered to this email for your convenience.\
                        </div>\
                        <div style=\"margin: 0 0 20px; padding: 18px; border-radius: 14px; background-color: #f8fafc; border: 1px solid #cbd5e1;\">\
                            <table style=\"width: 100%; border-collapse: collapse;\">\
                                <tr>\
                                    <td style=\"padding: 8px 0; font-size: 14px; color: #64748b;\">Person to Visit</td>\
                                    <td style=\"padding: 8px 0; font-size: 14px; font-weight: 700; color: #0f172a; text-align: right;\">{}</td>\
                                </tr>\
                                <tr>\
                                    <td style=\"padding: 8px 0; font-size: 14px; color: #64748b;\">Purpose</td>\
                                    <td style=\"padding: 8px 0; font-size: 14px; font-weight: 700; color: #0f172a; text-align: right;\">{}</td>\
                                </tr>\
                            </table>\
                        </div>\
                        <div style=\"text-align: center; margin: 26px 0 22px;\">\
                            <div style=\"margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #475569;\">Scan This Visitor Pass</div>\
                            <img src=\"{}\" alt=\"Visitor QR Code\" style=\"display: inline-block; width: 250px; height: 250px; border: 4px solid #14b8a6; border-radius: 18px; padding: 10px; background-color: #ffffff;\" />\
                        </div>\
                        <div style=\"margin: 0 0 18px; padding: 16px 18px; border-radius: 14px; background-color: #7f1d1d; color: #ffffff; text-align: center; font-size: 16px; font-weight: 700; line-height: 1.6;\">\
                            This pass is valid for today ONLY and will expire at 11:59 PM.\
                        </div>\
                        <div style=\"margin-top: 22px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.6; color: #64748b; text-align: center;\">\
                            Ref ID: {} | Processed at: {}\
                        </div>\
                    </div>\
                </div>\
            </div>\
        </body>\
        </html>",
        visitor_name, id_number, person_to_visit, purpose, qr_src, id_number, processed_at_display
    );

    let from_email = resolve_from_email(&state);
    let from_name = resolve_from_name(&state, "Smart Gate - PLP");

    send_email(
        &state,
        EmailPayload {
            to_email: email,
            to_name: visitor_name,
            subject: format!("Visitor Pass - {}", id_number),
            html_content,
            from_email,
            from_name,
            inline_images,
        },
    )
    .await?;
    Ok("Email sent successfully!".to_string())
}

#[command]
pub async fn send_verification_otp(
    state: State<'_, DbPool>,
    account_id: i64,
) -> Result<String, String> {
    let challenge = db::create_first_login_challenge(&state, account_id)?;
    send_verification_otp_email(
        &state,
        &challenge.email,
        &challenge.account.full_name,
        &challenge.otp_code,
    )
    .await?;
    Ok(format!(
        "Verification code sent to {}",
        challenge.masked_email
    ))
}

pub async fn send_password_reset_otp_email(
    pool: &DbPool,
    email: &str,
    full_name: &str,
    otp_code: &str,
) -> Result<(), String> {
    let requested_at = Local::now();
    let requested_at_display = requested_at.format("%B %d, %Y at %I:%M:%S %p").to_string();
    let requested_at_subject = requested_at.format("%I:%M %p").to_string();
    let transaction_id = format!("RESET-{}-OTP", requested_at.format("%Y%m%d%H%M%S"));

    let html_content = format!(
        "<html>\
        <body style=\"margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, sans-serif; color: #0f172a;\">\
            <div style=\"max-width: 640px; margin: 0 auto; padding: 24px 16px;\">\
                <div style=\"background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;\">\
                    <div style=\"background-color: #0f172a; padding: 24px 28px; text-align: center;\">\
                        <div style=\"font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 6px;\">Smart Gate - Password Reset</div>\
                        <div style=\"font-size: 13px; color: #cbd5e1; letter-spacing: 0.06em; text-transform: uppercase;\">Password Recovery</div>\
                    </div>\
                    <div style=\"padding: 28px;\">\
                        <p style=\"margin: 0 0 16px; font-size: 18px; font-weight: 700; color: #0f172a;\">Hello {},</p>\
                        <p style=\"margin: 0 0 18px; font-size: 15px; line-height: 1.7; color: #334155;\">You requested a password reset. Use the verification code below to reset your password.</p>\
                        <div style=\"margin: 0 0 22px; border-radius: 16px; background-color: #1e293b; border: 1px solid #0f172a; padding: 22px; text-align: center;\">\
                            <div style=\"margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #cbd5e1;\">6-Digit Verification Code</div>\
                            <div style=\"font-size: 34px; font-weight: 700; letter-spacing: 0.22em; color: #ffffff;\">{}</div>\
                        </div>\
                        <div style=\"margin: 0 0 18px; padding: 16px 18px; border-radius: 14px; background-color: #f8fafc; border: 1px solid #cbd5e1;\">\
                            <p style=\"margin: 0; font-size: 14px; line-height: 1.7; color: #334155;\">This code was requested at <span style=\"font-weight: 700; color: #0f172a;\">{}</span> and will expire in <span style=\"font-weight: 700; color: #0f172a;\">15 minutes</span>.</p>\
                        </div>\
                        <p style=\"margin: 0 0 18px; font-size: 14px; line-height: 1.7; color: #475569;\">If you did not request this password reset, please contact your System Administrator immediately.</p>\
                        <div style=\"margin-top: 22px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.6; color: #64748b; text-align: center;\">\
                            Transaction ID: {} | Processed at: {}\
                        </div>\
                    </div>\
                </div>\
            </div>\
        </body>\
        </html>",
        full_name, otp_code, requested_at_display, transaction_id, requested_at_display
    );

    let from_email = resolve_from_email(pool);
    let from_name = resolve_from_name(pool, "Smart Gate - PLP");

    send_email(
        pool,
        EmailPayload {
            to_email: email.to_string(),
            to_name: full_name.to_string(),
            subject: format!("Password Reset Code [{}]", requested_at_subject),
            html_content,
            from_email,
            from_name,
            inline_images: vec![],
        },
    )
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: resolve From address dynamically based on provider settings
// ─────────────────────────────────────────────────────────────────────────────

fn resolve_from_email(pool: &DbPool) -> String {
    let provider = db::get_setting(pool, "email_provider")
        .unwrap_or(None)
        .unwrap_or_else(|| "smtp".to_string());

    if provider.to_lowercase() == "brevo" {
        // For Brevo the sender must be a verified email in the Brevo dashboard.
        // We strictly use your verified sender roicambe02@gmail.com.
        "roicambe02@gmail.com".to_string()
    } else {
        // For SMTP the username IS the sending address
        db::get_setting(pool, "smtp_username")
            .unwrap_or(None)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "noreply@smartgate.app".to_string())
    }
}

fn resolve_from_name(pool: &DbPool, fallback: &str) -> String {
    let provider = db::get_setting(pool, "email_provider")
        .unwrap_or(None)
        .unwrap_or_else(|| "smtp".to_string());

    let setting_key = if provider.to_lowercase() == "brevo" {
        "brevo_from_name"
    } else {
        "smtp_from_name"
    };

    db::get_setting(pool, setting_key)
        .unwrap_or(None)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

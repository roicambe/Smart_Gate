use crate::db::{self, DbPool};
use chrono::Local;
use reqwest::Client;
use rusqlite::params;
use serde_json::json;
use tauri::{command, State};

async fn send_brevo_email(payload: serde_json::Value) -> Result<(), String> {
    let api_key = std::env::var("BREVO_API_KEY").unwrap_or_else(|_| "".to_string());
    if api_key.is_empty() {
        return Err("BREVO_API_KEY not found in environment variables".to_string());
    }

    let client = Client::new();
    let resp = client
        .post("https://api.brevo.com/v3/smtp/email")
        .header("api-key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
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
                    "Failed to send email. Status: {}, Response: {}",
                    status, text
                ))
            }
        }
        Err(e) => Err(format!("Request to Brevo failed: {}", e)),
    }
}

pub async fn send_verification_otp_email(
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

    let payload = json!({
        "sender": {
            "name": "Smart Gate Security",
            "email": "roicambe02@gmail.com"
        },
        "to": [
            {
                "email": email,
                "name": full_name
            }
        ],
        "subject": format!("Smart Gate Verification Code [{}]", requested_at_subject),
        "htmlContent": html_content
    });

    send_brevo_email(payload).await
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

    let info_result: Result<(String, String, Option<String>, String, String), _> = conn.query_row(
        "SELECT p.first_name, p.last_name, p.email, v.purpose_of_visit, v.person_to_visit 
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

    let (first_name, last_name, email_opt, purpose, person_to_visit) = match info_result {
        Ok(res) => res,
        Err(_) => return Err(format!("Visitor with ID {} not found", id_number)),
    };

    // If no email, gracefully return without error.
    let email = match email_opt {
        Some(e) if !e.trim().is_empty() => e.trim().to_string(),
        _ => return Ok("No email provided. Skipped sending.".to_string()),
    };

    let visitor_name = format!("{} {}", first_name, last_name);

    // 2. Generate the QR code URL using a public API.
    // This perfectly avoids email clients treating the image as an attachment,
    // embedding it purely in the email HTML itself.
    let qr_url = format!(
        "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={}",
        id_number
    );

    let processed_at = Local::now();
    let processed_at_display = processed_at.format("%B %d, %Y at %I:%M:%S %p").to_string();

    // The HTML email body using the direct URL for the image.
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
        visitor_name, id_number, person_to_visit, purpose, qr_url, id_number, processed_at_display
    );

    let payload = json!({
        "sender": {
            "name": "Smart Gate - Pamantansan ng Lungsod ng Pasig",
            "email": "roicambe02@gmail.com"
        },
        "to": [
            {
                "email": email,
                "name": visitor_name
            }
        ],
        "subject": format!("Visitor Pass - {}", id_number),
        "htmlContent": html_content
    });

    send_brevo_email(payload).await?;
    Ok("Email sent successfully!".to_string())
}

#[command]
pub async fn send_verification_otp(
    state: State<'_, DbPool>,
    account_id: i64,
) -> Result<String, String> {
    let challenge = db::create_first_login_challenge(&state, account_id)?;
    send_verification_otp_email(
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

    let payload = json!({
        "sender": {
            "name": "Smart Gate Security",
            "email": "roicambe02@gmail.com"
        },
        "to": [
            {
                "email": email,
                "name": full_name
            }
        ],
        "subject": format!("Password Reset Code [{}]", requested_at_subject),
        "htmlContent": html_content
    });

    send_brevo_email(payload).await
}

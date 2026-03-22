use tauri::{command, State};
use reqwest::Client;
use serde_json::json;
use crate::db::DbPool;
use rusqlite::params;

#[command]
pub async fn send_visitor_qr(
    state: State<'_, DbPool>,
    id_number: String,
) -> Result<String, String> {
    // 1. Get visitor info from DB (joining persons and visitors)
    let conn = state.get().map_err(|e| format!("DB connection error: {}", e))?;
    
    let info_result: Result<(String, String, Option<String>, String, String), _> = conn.query_row(
        "SELECT p.first_name, p.last_name, p.email, v.purpose_of_visit, v.person_to_visit 
         FROM persons p 
         JOIN visitors v ON p.person_id = v.person_id 
         WHERE p.id_number = ?1",
        params![id_number],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
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
    let qr_url = format!("https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={}", id_number);

    // 3. Create the reqwest client
    let client = Client::new();

    // The HTML email body using the direct URL for the image.
    let html_content = format!(
        "<html>\
        <body style=\"font-family: Arial, sans-serif; color: #333; margin: 0; padding: 0;\">\
            <div style=\"max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 15px;\">\
                <div style=\"text-align: center; margin-bottom: 20px;\">\
                    <h1 style=\"color: #10b981; margin-bottom: 5px;\">Pamantasan ng Lungsod ng Pasig | Smart Gate</h1>\
                    <p style=\"color: #666; margin-top: 0;\">Digital Visitor Pass</p>\
                </div>\
                <div style=\"background-color: #f9f9f9; padding: 20px; border-radius: 10px; margin-bottom: 20px;\">\
                    <h2 style=\"margin-top: 0;\">Welcome, {}!</h2>\
                    <p>Your visitor registration is successful. Please find your digital visitor pass below.</p>\
                    <table style=\"width: 100%; border-collapse: collapse; margin: 20px 0;\">\
                        <tr>\
                            <td style=\"padding: 8px 0; color: #666;\">Visitor ID:</td>\
                            <td style=\"padding: 8px 0; font-weight: bold; font-family: monospace; font-size: 18px;\">{}</td>\
                        </tr>\
                        <tr>\
                            <td style=\"padding: 8px 0; color: #666;\">Person to Visit:</td>\
                            <td style=\"padding: 8px 0; font-weight: bold;\">{}</td>\
                        </tr>\
                        <tr>\
                            <td style=\"padding: 8px 0; color: #666;\">Purpose:</td>\
                            <td style=\"padding: 8px 0; font-weight: bold;\">{}</td>\
                        </tr>\
                    </table>\
                </div>\
                <div style=\"text-align: center; margin: 30px 0;\">\
                    <img src=\"{}\" alt=\"Visitor QR Code\" style=\"width: 250px; height: 250px; border: 3px solid #10b981; border-radius: 15px; padding: 10px;\" />\
                </div>\
                <p style=\"text-align: center; color: #666; font-size: 14px; line-height: 1.6;\">\
                    Please present this QR code at the scanner when exiting the premises.<br/>\
                    A digital copy has been sent to this email address for your convenience.\
                </p>\
                <div style=\"text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999;\">\
                    &copy; Smart Gate System - Academic Campus Entry Management\
                </div>\
            </div>\
        </body>\
        </html>",
        visitor_name, id_number, person_to_visit, purpose, qr_url
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
        "subject": "Your Smart Gate Visitor QR Code",
        "htmlContent": html_content
    });

    // 5. Send POST request to Brevo API
    let api_key = std::env::var("BREVO_API_KEY").unwrap_or_else(|_| "".to_string());
    if api_key.is_empty() {
        return Err("BREVO_API_KEY not found in environment variables".to_string());
    }

    let resp = client.post("https://api.brevo.com/v3/smtp/email")
        .header("api-key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await;

    // 6. Handle the response and pass the result back to Tauri
    match resp {
        Ok(response) => {
            if response.status().is_success() {
                Ok("Email sent successfully!".to_string())
            } else {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                Err(format!("Failed to send email. Status: {}, Response: {}", status, text))
            }
        }
        Err(e) => Err(format!("Request to Brevo failed: {}", e)),
    }
}

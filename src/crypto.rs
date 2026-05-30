//! AES-256-GCM at rest for client secrets (HMAC needs plaintext on verify).
//! Argon2 is for passwords only — one-way hash cannot recompute HMAC.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const NONCE_LEN: usize = 12;

/// AES key for OAuth tokens (`INTEGRATION_MASTER_KEY`, else `CLIENT_KEY_MASTER_KEY`).
pub fn integration_master_key_32() -> [u8; 32] {
    let raw = std::env::var("INTEGRATION_MASTER_KEY").or_else(|_| {
        std::env::var("CLIENT_KEY_MASTER_KEY")
    }).unwrap_or_else(|_| {
        tracing::warn!(
            "INTEGRATION_MASTER_KEY unset — using dev default; set in production"
        );
        "dev-only-integration-master-change-me".into()
    });
    if raw.len() == 64 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(bytes) = hex::decode(&raw) {
            if bytes.len() == 32 {
                let mut out = [0u8; 32];
                out.copy_from_slice(&bytes);
                return out;
            }
        }
    }
    let d = Sha256::digest(raw.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&d);
    out
}

pub fn encrypt_integration_config(json: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(&integration_master_key_32())
        .map_err(|e| format!("cipher init: {e}"))?;
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), json.as_bytes())
        .map_err(|e| format!("encrypt: {e}"))?;
    let mut blob = Vec::with_capacity(NONCE_LEN + ct.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    Ok(B64.encode(blob))
}

pub fn decrypt_integration_config(blob_b64: &str) -> Result<String, String> {
    let blob = B64
        .decode(blob_b64.trim())
        .map_err(|e| format!("base64: {e}"))?;
    if blob.len() <= NONCE_LEN {
        return Err("ciphertext too short".into());
    }
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(&integration_master_key_32())
        .map_err(|e| format!("cipher init: {e}"))?;
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| format!("decrypt: {e}"))?;
    String::from_utf8(pt).map_err(|e| format!("utf8: {e}"))
}

pub fn master_key_32() -> [u8; 32] {
    let raw = std::env::var("CLIENT_KEY_MASTER_KEY").unwrap_or_else(|_| {
        tracing::warn!(
            "CLIENT_KEY_MASTER_KEY unset — using dev default; set in production"
        );
        "dev-only-client-key-master-change-me".into()
    });
    if raw.len() == 64 && raw.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(bytes) = hex::decode(&raw) {
            if bytes.len() == 32 {
                let mut out = [0u8; 32];
                out.copy_from_slice(&bytes);
                return out;
            }
        }
    }
    let d = Sha256::digest(raw.as_bytes());
    let mut out = [0u8; 32];
    out.copy_from_slice(&d);
    out
}

pub fn encrypt_secret(plain: &str) -> Result<String, String> {
    let cipher =
        Aes256Gcm::new_from_slice(&master_key_32()).map_err(|e| format!("cipher init: {e}"))?;
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
        .map_err(|e| format!("encrypt: {e}"))?;
    let mut blob = Vec::with_capacity(NONCE_LEN + ct.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    Ok(B64.encode(blob))
}

pub fn decrypt_secret(blob_b64: &str) -> Result<String, String> {
    let blob = B64
        .decode(blob_b64.trim())
        .map_err(|e| format!("base64: {e}"))?;
    if blob.len() <= NONCE_LEN {
        return Err("ciphertext too short".into());
    }
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    let cipher =
        Aes256Gcm::new_from_slice(&master_key_32()).map_err(|e| format!("cipher init: {e}"))?;
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| format!("decrypt: {e}"))?;
    String::from_utf8(pt).map_err(|e| format!("utf8: {e}"))
}

/// Canonical payload for HMAC (must match client SDK).
/// - `method`: uppercase GET, POST, …
/// - `path`: raw path **including** query string (`/v1/api/get?user_id=1`)
/// - `body`: empty string when no body (not omitted)
pub fn signing_string(
    api_key: &str,
    timestamp: &str,
    method: &str,
    path: &str,
    body: &[u8],
) -> String {
    let method = method.trim().to_ascii_uppercase();
    let body_part = if body.is_empty() {
        String::new()
    } else {
        String::from_utf8_lossy(body).into_owned()
    };
    format!("{api_key}\n{timestamp}\n{method}\n{path}\n{body_part}")
}

pub fn hmac_sha256_hex(secret: &str, payload: &str) -> String {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes()).expect("hmac key len");
    mac.update(payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn verify_hmac_sha256_hex(secret: &str, payload: &str, sig_hex: &str) -> bool {
    let Ok(sig_bytes) = hex::decode(sig_hex.trim()) else {
        return false;
    };
    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes()).expect("hmac key len");
    mac.update(payload.as_bytes());
    let expected = mac.finalize().into_bytes();
    if expected.len() != sig_bytes.len() {
        return false;
    }
    expected.ct_eq(&sig_bytes).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signing_string_format() {
        let s = signing_string("pk1", "1700000000", "get", "/v1/api/x", b"");
        assert_eq!(s, "pk1\n1700000000\nGET\n/v1/api/x\n");
        let s2 = signing_string("pk1", "1", "POST", "/p", b"body");
        assert_eq!(s2, "pk1\n1\nPOST\n/p\nbody");
    }

    #[test]
    fn hmac_verify_roundtrip() {
        let secret = "avaso_sk_test_secret";
        let payload = signing_string("avaso_pk_test", "1700000000", "GET", "/v1/api/get", b"");
        let sig = hmac_sha256_hex(secret, &payload);
        assert!(verify_hmac_sha256_hex(secret, &payload, &sig));
        assert!(!verify_hmac_sha256_hex(secret, &payload, "00".repeat(64).as_str()));
        assert!(!verify_hmac_sha256_hex("wrong", &payload, &sig));
    }

    #[test]
    fn hmac_tampered_body_fails() {
        let secret = "sk";
        let payload = signing_string("pk", "1", "POST", "/p", b"original");
        let sig = hmac_sha256_hex(secret, &payload);
        let tampered = signing_string("pk", "1", "POST", "/p", b"tampered");
        assert!(!verify_hmac_sha256_hex(secret, &tampered, &sig));
    }

    #[test]
    fn encrypt_decrypt_secret_roundtrip() {
        let plain = "avaso_sk_super_secret_value";
        let enc = encrypt_secret(plain).expect("encrypt");
        assert_ne!(enc, plain);
        assert_eq!(decrypt_secret(&enc).expect("decrypt"), plain);
    }

    #[test]
    fn encrypt_decrypt_integration_config_roundtrip() {
        let json = r#"{"client_id":"abc","client_secret":"xyz"}"#;
        let enc = encrypt_integration_config(json).expect("enc");
        assert_eq!(decrypt_integration_config(&enc).expect("dec"), json);
    }
}

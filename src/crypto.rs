//! AES-256-GCM at rest for integration configs.
//! OAuth2 client_secret uses Argon2id one-way hash in `db::hash_client_secret`.

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use rand::RngCore;
use sha2::{Digest, Sha256};

const NONCE_LEN: usize = 12;

/// AES key for OAuth tokens (`INTEGRATION_MASTER_KEY`, else `CLIENT_KEY_MASTER_KEY`).
pub fn integration_master_key_32() -> [u8; 32] {
    let raw = std::env::var("INTEGRATION_MASTER_KEY")
        .or_else(|_| std::env::var("CLIENT_KEY_MASTER_KEY"))
        .unwrap_or_else(|_| {
            tracing::warn!("INTEGRATION_MASTER_KEY unset — using dev default; set in production");
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
        tracing::warn!("CLIENT_KEY_MASTER_KEY unset — using dev default; set in production");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_secret_roundtrip() {
        let plain = "avaso_csec_super_secret_value";
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

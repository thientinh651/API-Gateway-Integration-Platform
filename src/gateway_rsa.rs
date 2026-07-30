//! WSO2-style asymmetric encryption: client encrypts with gateway **public** key,
//! only gateway **private** key can decrypt (hybrid RSA-OAEP-256 + AES-256-GCM).
#![allow(dead_code)]

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use rand::RngCore;
use rsa::{
    Oaep, RsaPrivateKey, RsaPublicKey,
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding},
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::PgPool;
use std::sync::OnceLock;

const SETTING_PRIVATE: &str = "gateway_rsa_private_pkcs8";
const SETTING_PUBLIC: &str = "gateway_rsa_public_spki";
const SETTING_KEY_ID: &str = "gateway_rsa_key_id";

static RSA_PRIVATE: OnceLock<RsaPrivateKey> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct GatewayPublicKeyResponse {
    pub key_id: String,
    pub algorithm: &'static str,
    pub rsa_padding: &'static str,
    pub aes: &'static str,
    pub public_key_pem: String,
    pub usage: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct CryptoEnvelope {
    pub encrypted_aes_key: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Deserialize)]
pub struct EncryptedCreateKeyPlain {
    pub name: String,
    #[serde(default = "default_integration_type_plain")]
    pub integration_type: String,
    /// Partner may send their own secret inside encrypted envelope (optional).
    pub secret_key: Option<String>,
    #[serde(default)]
    pub rate_limit_per_min: i32,
    #[serde(default)]
    pub route_ids: Vec<i64>,
}

fn default_integration_type_plain() -> String {
    "app".into()
}

pub fn decrypt_envelope(envelope: &CryptoEnvelope) -> Result<Vec<u8>, String> {
    let private = private_key()?;
    let enc_key = B64
        .decode(envelope.encrypted_aes_key.trim())
        .map_err(|e| format!("encrypted_aes_key base64: {e}"))?;
    let nonce_bytes = B64
        .decode(envelope.nonce.trim())
        .map_err(|e| format!("nonce base64: {e}"))?;
    let ciphertext = B64
        .decode(envelope.ciphertext.trim())
        .map_err(|e| format!("ciphertext base64: {e}"))?;
    if nonce_bytes.len() != 12 {
        return Err(format!("nonce must be 12 bytes, got {}", nonce_bytes.len()));
    }

    let padding = Oaep::new::<Sha256>();
    let aes_key = private
        .decrypt(padding, &enc_key)
        .map_err(|e| format!("rsa decrypt: {e}"))?;
    if aes_key.len() != 32 {
        return Err(format!("aes key must be 32 bytes, got {}", aes_key.len()));
    }

    let cipher = Aes256Gcm::new_from_slice(&aes_key).map_err(|e| format!("aes init: {e}"))?;
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|e| format!("aes decrypt: {e}"))?;
    Ok(pt)
}

/// Build envelope JSON fields (for docs/tests). Server-side helper.
pub fn encrypt_for_gateway_public(plaintext: &[u8]) -> Result<CryptoEnvelope, String> {
    let public_pem = public_key_pem()?;
    let public = RsaPublicKey::from_public_key_pem(&public_pem)
        .map_err(|e| format!("parse public pem: {e}"))?;

    let mut aes_key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut aes_key);
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);

    let cipher = Aes256Gcm::new_from_slice(&aes_key).map_err(|e| format!("aes init: {e}"))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|e| format!("aes encrypt: {e}"))?;

    let padding = Oaep::new::<Sha256>();
    let enc_key = public
        .encrypt(&mut rand::thread_rng(), padding, &aes_key)
        .map_err(|e| format!("rsa encrypt: {e}"))?;

    Ok(CryptoEnvelope {
        encrypted_aes_key: B64.encode(enc_key),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
}

pub async fn ensure_gateway_rsa_keys(pool: &PgPool) -> Result<(), sqlx::Error> {
    let exists: Option<String> =
        sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = $1 LIMIT 1")
            .bind(SETTING_PRIVATE)
            .fetch_optional(pool)
            .await?;

    if exists.is_some() {
        return Ok(());
    }

    if let Ok(pem) = std::env::var("GATEWAY_RSA_PRIVATE_KEY_PEM") {
        let pem = pem.trim();
        if !pem.is_empty() {
            let private = RsaPrivateKey::from_pkcs8_pem(pem).map_err(|e| {
                sqlx::Error::Configuration(
                    format!("invalid GATEWAY_RSA_PRIVATE_KEY_PEM: {e}").into(),
                )
            })?;
            let public = RsaPublicKey::from(&private);
            store_keypair(pool, &private, &public).await?;
            return Ok(());
        }
    }

    let mut rng = rand::thread_rng();
    let private = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|e| sqlx::Error::Configuration(format!("rsa generate: {e}").into()))?;
    let public = RsaPublicKey::from(&private);
    store_keypair(pool, &private, &public).await?;
    tracing::info!("generated gateway RSA-2048 keypair (WSO2-style decrypt at rest on wire)");
    Ok(())
}

async fn store_keypair(
    pool: &PgPool,
    private: &RsaPrivateKey,
    public: &RsaPublicKey,
) -> Result<(), sqlx::Error> {
    let priv_pem = private
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| sqlx::Error::Configuration(format!("priv pem: {e}").into()))?;
    let pub_pem = public
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| sqlx::Error::Configuration(format!("pub pem: {e}").into()))?;
    let key_id = uuid::Uuid::new_v4().to_string();

    for (k, v) in [
        (SETTING_PRIVATE, priv_pem.as_str()),
        (SETTING_PUBLIC, pub_pem.as_str()),
        (SETTING_KEY_ID, key_id.as_str()),
    ] {
        sqlx::query(
            "INSERT INTO gateway_settings (k, v) VALUES ($1, $2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        )
        .bind(k)
        .bind(v)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn init_rsa_from_db(pool: &PgPool) -> Result<(), sqlx::Error> {
    ensure_gateway_rsa_keys(pool).await?;
    let pem: String = sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = $1 LIMIT 1")
        .bind(SETTING_PRIVATE)
        .fetch_one(pool)
        .await?;
    let private = RsaPrivateKey::from_pkcs8_pem(&pem)
        .map_err(|e| sqlx::Error::Configuration(format!("load rsa private: {e}").into()))?;
    let _ = RSA_PRIVATE.set(private);
    Ok(())
}

fn private_key() -> Result<&'static RsaPrivateKey, String> {
    RSA_PRIVATE
        .get()
        .ok_or_else(|| "gateway RSA private key not loaded".into())
}

pub async fn public_key_response(pool: &PgPool) -> Result<GatewayPublicKeyResponse, String> {
    let key_id: String = sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = $1 LIMIT 1")
        .bind(SETTING_KEY_ID)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("db: {e}"))?
        .unwrap_or_else(|| "default".into());
    let public_pem: String =
        sqlx::query_scalar("SELECT v FROM gateway_settings WHERE k = $1 LIMIT 1")
            .bind(SETTING_PUBLIC)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("db: {e}"))?
            .ok_or_else(|| "public key not configured".to_string())?;

    Ok(GatewayPublicKeyResponse {
        key_id,
        algorithm: "RSA-OAEP-256",
        rsa_padding: "OAEP-SHA256",
        aes: "AES-256-GCM",
        public_key_pem: public_pem,
        usage: "Client encrypts sensitive payload; gateway decrypts with private key. Data-plane uses OAuth2 Bearer JWT.",
    })
}

fn public_key_pem() -> Result<String, String> {
    if let Some(private) = RSA_PRIVATE.get() {
        let public = RsaPublicKey::from(private);
        return public
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| format!("pub pem: {e}"));
    }
    Err("RSA not initialized".into())
}

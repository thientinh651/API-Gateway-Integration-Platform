//! PKCE helpers (RFC 7636) — shared by third-party OAuth and CRM connectors.
#![allow(dead_code)]

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

pub const METHOD_S256: &str = "S256";

/// 43–128 unreserved chars per RFC 7636.
pub fn valid_verifier(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'))
}

/// S256 challenge is 43-char base64url (32-byte digest).
pub fn valid_challenge(challenge: &str) -> bool {
    challenge.len() == 43
        && challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

pub fn generate_verifier() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn challenge_s256(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

pub fn verify_s256(verifier: &str, challenge: &str) -> bool {
    valid_verifier(verifier) && valid_challenge(challenge) && challenge_s256(verifier) == challenge
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_roundtrip() {
        let verifier = generate_verifier();
        assert!(valid_verifier(&verifier));
        let challenge = challenge_s256(&verifier);
        assert!(valid_challenge(&challenge));
        assert!(verify_s256(&verifier, &challenge));
        assert!(!verify_s256(
            "wrong-verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            &challenge
        ));
    }
}

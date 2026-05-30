# Luồng RSA (WSO2-style simplified)

## Sơ đồ

```
Partner / Browser                    Gateway (Key Manager)
      |                                      |
      |  GET /api/crypto/public-key          |
      |<-------------------------------------|
      |  PEM RSA public                      |
      |                                      |
      |  envelope = RSA(AESkey) + AES(JSON)  |
      |  POST /api/client-keys/encrypted     |
      |------------------------------------->|
      |                                      | private decrypt
      |                                      | tạo pk/sk, AES at rest
      |<-------------------------------------|
      |  api_key + secret_key (HTTPS)        |
      |                                      |
      |  Gọi /v1/... + HMAC mỗi request      |
      |------------------------------------->|
```

## Test UI

1. `cargo run` + `npm run dev` (ExampleWeb)
2. Login admin → **Bảo mật & Auth**
3. **Tạo key (RSA / WSO2)** → nhập tên → **Mã hóa & tạo key**
4. Copy pk/sk → **Thử gọi Proxy**

## Test curl (public key)

```bash
curl -sS http://127.0.0.1:3000/api/crypto/public-key | python3 -m json.tool
```

## Key lưu ở đâu

- Private/public PEM: bảng `gateway_settings` (`gateway_rsa_private_pkcs8`, `gateway_rsa_public_spki`)
- Hoặc env `GATEWAY_RSA_PRIVATE_KEY_PEM` (production import key có sẵn)

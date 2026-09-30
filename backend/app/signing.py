"""
WeighGuard Cryptographic Signing Service.
Central-only Ed25519 signing with canonical CBOR (RFC 8949) serialization.
The private key is strictly isolated on the backend and never exposed to clients.
"""

from __future__ import annotations
import base64
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import cbor2
import nacl.signing
import nacl.exceptions

KEY_VERSION = "v1-ed25519-2026"
ALGORITHM = "Ed25519"

# Directory where key files are stored
KEYS_DIR = Path(__file__).resolve().parent.parent / "keys"
PRIVATE_KEY_PATH = KEYS_DIR / "ed25519_private.key"
PUBLIC_KEY_PATH = KEYS_DIR / "ed25519_public.key"

_signing_key: Optional[nacl.signing.SigningKey] = None
_verify_key: Optional[nacl.signing.VerifyKey] = None


def init_keys() -> Tuple[nacl.signing.SigningKey, nacl.signing.VerifyKey]:
    """
    Initialize or load the Ed25519 keypair from backend/keys/.
    Generates a new keypair if keys do not already exist.
    """
    global _signing_key, _verify_key

    KEYS_DIR.mkdir(parents=True, exist_ok=True)

    if PRIVATE_KEY_PATH.exists() and PUBLIC_KEY_PATH.exists():
        with open(PRIVATE_KEY_PATH, "rb") as f:
            seed = f.read()
        _signing_key = nacl.signing.SigningKey(seed)
        _verify_key = _signing_key.verify_key
    else:
        # Generate new 32-byte Ed25519 seed
        _signing_key = nacl.signing.SigningKey.generate()
        _verify_key = _signing_key.verify_key

        # Persist private key seed
        with open(PRIVATE_KEY_PATH, "wb") as f:
            f.write(_signing_key.encode())

        # Persist public key bytes
        with open(PUBLIC_KEY_PATH, "wb") as f:
            f.write(_verify_key.encode())

    return _signing_key, _verify_key


def get_signing_key() -> nacl.signing.SigningKey:
    """Get the active backend signing key (private)."""
    global _signing_key
    if _signing_key is None:
        init_keys()
    assert _signing_key is not None
    return _signing_key


def get_verify_key() -> nacl.signing.VerifyKey:
    """Get the active public verify key."""
    global _verify_key
    if _verify_key is None:
        init_keys()
    assert _verify_key is not None
    return _verify_key


def get_public_key_base64() -> str:
    """Return the Ed25519 public key encoded as Base64."""
    vk = get_verify_key()
    return base64.b64encode(vk.encode()).decode("ascii")


def get_public_key_hex() -> str:
    """Return the Ed25519 public key encoded as hex."""
    vk = get_verify_key()
    return vk.encode().hex()


def get_key_metadata() -> Dict[str, str]:
    """Public key metadata bundle for static export and API delivery."""
    return {
        "key_version": KEY_VERSION,
        "algorithm": ALGORITHM,
        "public_key_base64": get_public_key_base64(),
        "public_key_hex": get_public_key_hex(),
        "issuer": "Ministry of Consumer Affairs, Food & Public Distribution | Legal Metrology Division",
        "description": "WeighGuard Central Statutory Certification Authority"
    }


def serialize_canonical_cbor(data: Any) -> bytes:
    """
    Serialize data to deterministic canonical CBOR bytes per RFC 8949 §4.2.
    Keys are sorted lexicographically by length then bytes.
    """
    return cbor2.dumps(data, canonical=True)


def sign_certificate_payload(payload_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Takes certificate data, canonicalizes it to CBOR bytes, signs with Ed25519,
    and constructs the complete signed certificate record with CBOR envelope.
    """
    sk = get_signing_key()

    # Filter out signature, cbor_base64, or other envelope artifacts before signing
    clean_data = {
        k: v for k, v in payload_data.items()
        if k not in ("signature", "cbor_base64", "created_at") and v is not None
    }
    clean_data["key_version"] = KEY_VERSION

    # 1. Canonical CBOR serialization of the certificate metadata
    payload_bytes = serialize_canonical_cbor(clean_data)

    # 2. Ed25519 cryptographic signature
    signed = sk.sign(payload_bytes)
    sig_bytes = signed.signature
    sig_base64 = base64.b64encode(sig_bytes).decode("ascii")

    # 3. Create canonical CBOR envelope for QR encoding:
    # {"p": raw_payload_bytes, "s": signature_bytes, "v": key_version}
    envelope = {
        "p": payload_bytes,
        "s": sig_bytes,
        "v": KEY_VERSION
    }
    envelope_cbor_bytes = serialize_canonical_cbor(envelope)
    envelope_base64 = base64.b64encode(envelope_cbor_bytes).decode("ascii")

    # Return full certificate dictionary matching EnrichedCertificatePayload
    return {
        **clean_data,
        "signature": sig_base64,
        "cbor_base64": envelope_base64
    }


def verify_certificate(payload_bytes: bytes, signature_bytes: bytes) -> bool:
    """Verify an Ed25519 signature over canonical payload bytes using backend public key."""
    vk = get_verify_key()
    try:
        vk.verify(payload_bytes, signature_bytes)
        return True
    except (nacl.exceptions.BadSignatureError, Exception):
        return False


def sign_revocation_list(revoked_entries: List[Dict[str, Any]], updated_at: str) -> Dict[str, Any]:
    """
    Signs the statutory revocation list with the central Ed25519 private key.
    """
    sk = get_signing_key()
    revocation_payload = {
        "key_version": KEY_VERSION,
        "updated_at": updated_at,
        "revoked": revoked_entries
    }
    raw_bytes = serialize_canonical_cbor(revocation_payload)
    sig_bytes = sk.sign(raw_bytes).signature
    sig_base64 = base64.b64encode(sig_bytes).decode("ascii")

    return {
        **revocation_payload,
        "signature": sig_base64
    }


def create_tampered_envelope(envelope_base64: str) -> str:
    """
    Deliberately tamper with the payload bytes inside the envelope
    while leaving the signature intact, demonstrating cryptographic failure.
    """
    env_bytes = base64.b64decode(envelope_base64)
    envelope = cbor2.loads(env_bytes)

    # Mutate a byte in the payload 'p'
    p_bytes = bytearray(envelope["p"])
    if len(p_bytes) > 10:
        # Flip a bit in the instrument ID or date byte
        p_bytes[8] ^= 0xFF
    else:
        p_bytes.append(0x99)

    tampered_envelope = {
        "p": bytes(p_bytes),
        "s": envelope["s"],
        "v": envelope.get("v", KEY_VERSION)
    }
    tampered_bytes = serialize_canonical_cbor(tampered_envelope)
    return base64.b64encode(tampered_bytes).decode("ascii")
